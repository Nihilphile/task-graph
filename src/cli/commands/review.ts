import type { CommandSpec } from '../context.js';
import type { ParsedArgs } from '../args.js';
import { resolveCwd } from '../paths.js';
import { usageError } from '../../core/errors.js';
import { configureGraphReview, configureReview, finishReview, recoverReviews, removeReviewRequirement, restartReview, startReview } from '../../core/review.js';
import { readReviewState, reviewView, validateConfig, type ReviewConfig } from '../../core/review-state.js';
import { loadTaskRepository } from '../../core/repo.js';

function config(args: ParsedArgs): Partial<ReviewConfig> {
  const value: Record<string, string | number> = {};
  for (const name of ['model', 'reasoning', 'mode', 'executable']) if (args.has(name)) value[name] = args.opt(name)!;
  if (args.has('timeout-minutes')) value['timeoutMinutes'] = Number(args.opt('timeout-minutes'));
  validateConfig(value as Partial<ReviewConfig>); return value as Partial<ReviewConfig>;
}
const CONFIG_FLAGS = '[--model <model>] [--reasoning low|medium|high|xhigh] [--mode snapshot|live] [--executable <absolute-path>] [--timeout-minutes <number>]';
export function reviewCommands(): CommandSpec[] {
  return [
    ...(['start', 'restart', 'finish', 'status', 'recover', 'configure'] as const).map((action): CommandSpec => ({
      name: `task review ${action}`, summary: `${action} an independent task review`,
      usage: `task-graph task review ${action} T-NNNN ${action === 'finish' ? '--review-id <UUID> --result pass|reject|blocked --report <file>' : ['start', 'restart', 'configure'].includes(action) ? CONFIG_FLAGS : ''} [--cwd <dir>] [--json]`,
      details: ['Manual start requires a completed task and valid review-requirement files; it reopens the acceptance gate.', 'Configuration priority: this invocation > task > project defaults > gpt-6-sol/xhigh. Different tasks run independently.', 'Restart only failed/blocked runs after old processes exit; it preserves delivery and requirement snapshots. finish is round-checked and idempotent.'],
      run(ctx, args) {
        const root = resolveCwd(ctx, args), id = args.positionals[0];
        if (!id || !loadTaskRepository(root).taskById(id)) throw usageError('Pass an existing task ID');
        if (action === 'start') startReview(root, { id, config: config(args), actor: args.opt('actor') });
        if (action === 'restart') {
          const overrides = config(args);
          if (overrides.mode) throw usageError('Restart preserves the delivery mode');
          restartReview(root, id, overrides);
        }
        if (action === 'configure') configureReview(root, id, undefined, config(args));
        if (action === 'recover') recoverReviews(root, id);
        if (action === 'finish') {
          const reviewId = args.opt('review-id'), result = args.opt('result'), report = args.opt('report');
          if (!reviewId || !report || !['pass', 'reject', 'blocked'].includes(result ?? '')) throw usageError('Pass --review-id, --result pass|reject|blocked and --report');
          finishReview(root, { id, reviewId, report, result: result as 'pass' | 'reject' | 'blocked' });
        }
        const state = readReviewState(root), review = reviewView(root, id);
        ctx.io.out(JSON.stringify({ ok: true, task: { id, status: loadTaskRepository(root).taskById(id)!.status }, review,
          ...(action === 'status' ? { runs: state.runs.filter(r => r.task === id).map(r => ({ id: r.id, state: r.state, submission: r.submission, report: r.report, log: r.log, worker_pid: r.workerPid, child_pid: r.childPid, error: r.error })) } : {}) }, null, 2));
        return 0;
      },
    })),
    ...(['enable', 'disable', 'status'] as const).map((action): CommandSpec => ({
      name: `task auto-review ${action}`, summary: `${action} automatic review for a task`,
      usage: `task-graph task auto-review ${action} T-NNNN ${action === 'enable' ? CONFIG_FLAGS : ''} [--cwd <dir>] [--json]`,
      run(ctx, args) {
        const root = resolveCwd(ctx, args), id = args.positionals[0];
        if (!id || !loadTaskRepository(root).taskById(id)) throw usageError('Pass an existing task ID');
        if (action !== 'status') configureReview(root, id, action === 'enable', config(args));
        ctx.io.out(JSON.stringify({ ok: true, task: { id }, review: reviewView(root, id) }, null, 2)); return 0;
      },
    })),
    { name: 'graph auto-review enable', summary: 'Scan eligible tasks once; preserve explicit disables',
      usage: `task-graph graph auto-review enable G-NNN [--recursive] ${CONFIG_FLAGS} [--cwd <dir>] [--json]`,
      run(ctx, args) {
        const id = args.positionals[0]; if (!id) throw usageError('Pass a graph ID');
        const result = configureGraphReview(resolveCwd(ctx, args), id, args.flag('recursive'), config(args));
        ctx.io.out(JSON.stringify({ ok: true, ...result }, null, 2)); return 0;
      } },
    { name: 'graph auto-review status', summary: 'Show automatic review policies for this graph',
      usage: 'task-graph graph auto-review status G-NNN [--cwd <dir>] [--json]',
      run(ctx, args) {
        const root = resolveCwd(ctx, args), id = args.positionals[0], repo = loadTaskRepository(root);
        if (!id || !repo.manifest.graphs.some(g => g.id === id)) throw usageError('Pass an existing graph ID');
        ctx.io.out(JSON.stringify({ ok: true, graph: id, tasks: repo.tasks.filter(t => t.graph === id).map(t => ({ id: t.id, ...reviewView(root, t.id) })) }, null, 2)); return 0;
      } },
    { name: 'review configure', summary: 'Configure project defaults for future review runs',
      usage: `task-graph review configure ${CONFIG_FLAGS} [--cwd <dir>] [--json]`,
      run(ctx, args) { const root = resolveCwd(ctx, args); configureReview(root, undefined, undefined, config(args)); ctx.io.out(JSON.stringify({ ok: true, defaults: readReviewState(root).defaults })); return 0; } },
    { name: 'task review-requirement remove', summary: 'Remove an RR binding; enabled tasks must retain valid RR',
      usage: 'task-graph task review-requirement remove T-NNNN --path <file> [--cwd <dir>] [--json]',
      run(ctx, args) { const id = args.positionals[0], file = args.opt('path'); if (!id || !file) throw usageError('Pass task ID and --path'); removeReviewRequirement(resolveCwd(ctx, args), id, file); ctx.io.out(JSON.stringify({ ok: true, task: { id } })); return 0; } },
  ];
}
