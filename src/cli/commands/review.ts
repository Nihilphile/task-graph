import type { CommandSpec } from '../context.js';
import type { ParsedArgs } from '../args.js';
import { resolveCwd } from '../paths.js';
import { usageError } from '../../core/errors.js';
import { configureGraphReview, configureReview, finishReview, recoverReviews, removeReviewRequirement, restartReview, startReview } from '../../core/review.js';
import { currentReview, readReviewState, reviewView, validateConfig, type ReviewConfig } from '../../core/review-state.js';
import { loadTaskRepository } from '../../core/repo.js';
import { emitResult, fileView, reviewSummary } from '../output.js';

function config(args: ParsedArgs): Partial<ReviewConfig> {
  const value: Record<string, string | number> = {};
  for (const name of ['model', 'reasoning', 'mode', 'executable']) if (args.has(name)) value[name] = args.opt(name)!;
  if (args.has('timeout-minutes')) value['timeoutMinutes'] = Number(args.opt('timeout-minutes'));
  validateConfig(value as Partial<ReviewConfig>); return value as Partial<ReviewConfig>;
}
const RUN_FLAGS = '[--model <model>] [--reasoning low|medium|high|xhigh] [--executable <absolute-path>] [--timeout-minutes <number>]';
const CONFIG_FLAGS = `${RUN_FLAGS} [--mode snapshot|live]`;
const REVIEW_NOTES = {
  start: ['Requires a completed task and valid RR. Queues review without enabling auto-review.', 'Configuration priority: call > task > project > built-in defaults.'],
  restart: ['Requires a failed/blocked round and exited prior processes. Preserves delivery and frozen RR; queues a new round.'],
  finish: ['Only the current running round may submit. A non-empty report is required; reject also requires --error-report. Repeated identical submission is idempotent.'],
  status: ['Read-only current review status. --detail adds frozen materials, configuration and prior runs.'],
  recover: ['Reconcile interrupted or dead review workers, or adopt a confirmed live legacy reviewer. Does not resubmit completed work.'],
  configure: ['Set task overrides for future review runs; active review requirements/configuration stay fixed.'],
};
export function reviewCommands(): CommandSpec[] {
  return [
    ...(['start', 'restart', 'finish', 'status', 'recover', 'configure'] as const).map((action): CommandSpec => ({
      name: `task review ${action}`, summary: `${action} an independent task review`,
      usage: `task-graph task review ${action} T-NNNN ${action === 'finish' ? '--review-id <UUID> --result pass|reject|blocked --report <file> [--error-report <Markdown>]' : action === 'restart' ? RUN_FLAGS : ['start', 'configure'].includes(action) ? CONFIG_FLAGS : ''} [--cwd <dir>] [--json]`,
      details: REVIEW_NOTES[action],
      run(ctx, args) {
        const root = resolveCwd(ctx, args), id = args.positionals[0];
        if (!id || !loadTaskRepository(root).taskById(id)) throw usageError('Pass an existing task ID');
        const beforeStatus = loadTaskRepository(root).taskById(id)!.status;
        let recovered: string[] | undefined;
        if (action === 'start') startReview(root, { id, config: config(args), actor: args.opt('actor') });
        if (action === 'restart') {
          const overrides = config(args);
          if (overrides.mode) throw usageError('Restart preserves the delivery mode');
          restartReview(root, id, overrides);
        }
        if (action === 'configure') configureReview(root, id, undefined, config(args));
        if (action === 'recover') recovered = recoverReviews(root, id);
        if (action === 'finish') {
          const reviewId = args.opt('review-id'), result = args.opt('result'), report = args.opt('report');
          if (!reviewId || !report || !['pass', 'reject', 'blocked'].includes(result ?? '')) throw usageError('Pass --review-id, --result pass|reject|blocked and --report');
          finishReview(root, { id, reviewId, report, result: result as 'pass' | 'reject' | 'blocked', errorReport: args.opt('error-report') });
        }
        const state = readReviewState(root), review = reviewView(root, id);
        const status = loadTaskRepository(root).taskById(id)!.status, run = currentReview(state, id);
        const selected = args.flag('detail') ? review : action === 'configure' ? { config: Object.fromEntries(Object.keys(config(args)).map(k => [k, review.config[k as keyof ReviewConfig]])) }
          : action === 'finish' ? { id: run!.id, result: run!.state, report: fileView({ ...run!.report!, mode: 'snapshot' }), ...(run!.errorReport ? { error_report: fileView({ ...run!.errorReport, mode: 'snapshot' }) } : {}) }
          : reviewSummary(root, id);
        emitResult(ctx, args, { ok: true, task: { id, status }, review: selected,
          ...(action === 'recover' ? { recovery: { outcome: recovered?.length ? 'recovered' : status !== beforeStatus ? 'adopted' : 'unchanged', ...(recovered?.length ? { runs: recovered } : {}) } } : {}),
          ...(args.flag('detail') && action === 'status' ? { runs: state.runs.filter(r => r.task === id).map(r => ({ id: r.id, state: r.state, submission: r.submission, report: r.report, log: r.log, worker_pid: r.workerPid, child_pid: r.childPid, error: r.error })) } : {}) });
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
        const view = reviewView(root, id), overrides = action === 'enable' ? config(args) : {};
        emitResult(ctx, args, { ok: true, task: { id }, review: args.flag('detail') ? view : { enabled: view.enabled,
          ...(view.explicitly_disabled ? { explicitly_disabled: true } : {}),
          ...(Object.keys(overrides).length ? { config: Object.fromEntries(Object.keys(overrides).map(k => [k, view.config[k as keyof ReviewConfig]])) } : {}) } }); return 0;
      },
    })),
    { name: 'graph auto-review enable', summary: 'Scan eligible tasks once; preserve explicit disables',
      usage: `task-graph graph auto-review enable G-NNN [--recursive] ${CONFIG_FLAGS} [--cwd <dir>] [--json]`,
      run(ctx, args) {
        const id = args.positionals[0]; if (!id) throw usageError('Pass a graph ID');
        const result = configureGraphReview(resolveCwd(ctx, args), id, args.flag('recursive'), config(args));
        emitResult(ctx, args, { ok: true, ...result }); return 0;
      } },
    { name: 'graph auto-review status', summary: 'Show automatic review policies for this graph',
      usage: 'task-graph graph auto-review status G-NNN [--cwd <dir>] [--json]',
      run(ctx, args) {
        const root = resolveCwd(ctx, args), id = args.positionals[0], repo = loadTaskRepository(root);
        if (!id || !repo.manifest.graphs.some(g => g.id === id)) throw usageError('Pass an existing graph ID');
        const state = readReviewState(root);
        emitResult(ctx, args, { ok: true, graph: id, tasks: repo.tasks.filter(t => t.graph === id).map(t => ({ id: t.id,
          ...(args.flag('detail') ? reviewView(root, t.id) : { enabled: state.tasks[t.id]?.enabled ?? false, ...(state.tasks[t.id]?.disabled ? { explicitly_disabled: true } : {}) }) })) }); return 0;
      } },
    { name: 'review configure', summary: 'Configure project defaults for future review runs',
      usage: `task-graph review configure ${CONFIG_FLAGS} [--cwd <dir>] [--json]`,
      run(ctx, args) { const root = resolveCwd(ctx, args); configureReview(root, undefined, undefined, config(args)); emitResult(ctx, args, { ok: true, defaults: args.flag('detail') ? readReviewState(root).defaults : config(args) }); return 0; } },
    { name: 'task review-requirement remove', summary: 'Remove an RR binding; enabled tasks must retain valid RR',
      usage: 'task-graph task review-requirement remove T-NNNN --path <file> [--cwd <dir>] [--json]',
      run(ctx, args) { const id = args.positionals[0], file = args.opt('path'); if (!id || !file) throw usageError('Pass task ID and --path'); removeReviewRequirement(resolveCwd(ctx, args), id, file); emitResult(ctx, args, { ok: true, task: { id }, removed: file }); return 0; } },
  ];
}
