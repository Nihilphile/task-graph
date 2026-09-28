import { documentPath } from '../../core/documents.js';
import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import {
  cancelTask,
  completeTask,
  reopenTask,
  rejectTask,
  startTask,
  type TransitionOptions,
} from '../../core/lifecycle.js';
import type { TaskDocument } from '../../core/task.js';
import { resolveCwd } from '../paths.js';
import { taskContext } from '../../core/task-context.js';
import { executionGuidance } from '../execution-guidance.js';
import { attachmentView, contextView, emitResult, reviewSummary } from '../output.js';
import { repairReceipt } from '../../core/repair.js';

interface StatusCommandConfig {
  /** Command action word after `task`, e.g. `start`. */
  readonly action: string;
  readonly summary: string;
  /** Past-tense verb used in the success message. */
  readonly verb: string;
  readonly usage: string;
  readonly details: readonly string[];
  readonly run: (root: string, options: TransitionOptions) => TaskDocument;
}

const COMMANDS: readonly StatusCommandConfig[] = [
  {
    action: 'reject', summary: 'Record a failed result, release claim and keep successors blocked', verb: 'Rejected',
    usage: 'task-graph task reject T-NNNN --error-report <file.md> --report <file> [--log <text>] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: ['Every rejection requires a non-empty Markdown --error-report for the error-book. Acceptance tasks also require a report. Reopen explicitly for another attempt; previous results stay in history. Reject does not satisfy dependencies or parent completion.'],
    run: (root, options) => rejectTask(root, options),
  },
  {
    action: 'start',
    summary: 'Start ready work or accept a blocked task for repair',
    verb: 'Started',
    usage:
      'task-graph task start T-NNNN [--role <role> --session-id <session>] [--reopen] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Dependencies and refinement must be satisfied; accepting blocked work archives prior waiting reasons and enters in_progress. A handoff snapshot is saved.',
      'Pass --role and --session-id to claim and start in one transaction.',
      'Returns the task-take skill path: read context, log readiness, then work without a second approval.',
      'A done or reject task only moves back with --reopen. Dynamic tasks also require a current refinement.',
      'A cancelled task is terminal and cannot be started.',
    ],
    run: (root, options) => startTask(root, options),
  },
  {
    action: 'complete',
    summary: 'Submit work: queue enabled auto-review, otherwise record completion',
    verb: 'Completed',
    usage:
      'task-graph task complete T-NNNN [--result pass|reject] [--report <file>]... [--error-report <file.md>] [--log <text>] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Only a running task can be completed; todo -> done is not a supported transition.',
      'A composite task is refused until every completion_requires target is done.',
      'Reports, log, completion and claim release are saved atomically. Reports are snapshotted.',
      'Acceptance tasks require an explicit --result and report. --result reject also requires --error-report <file.md>. Reject keeps consumers and parent completion blocked.',
    ],
    run: (root, options) => completeTask(root, options),
  },
  {
    action: 'cancel',
    summary: 'Cancel a todo, in_progress or manually blocked task (terminal)',
    verb: 'Cancelled',
    usage:
      'task-graph task cancel T-NNNN [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'cancelled is terminal: no further status transition is accepted.',
      'To revive the goal, create a new task and link it with `task revise --replace`.',
    ],
    run: (root, options) => cancelTask(root, options),
  },
  {
    action: 'reopen',
    summary: 'Explicitly reopen a done or rejected task as in_progress',
    verb: 'Reopened',
    usage:
      'task-graph task reopen T-NNNN [--role <role> --session-id <session>] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Reopen done/reject work or accept blocked work for repair; cancelled work is never reopened.',
      'The reopen is recorded in history with the actor and timestamp.',
    ],
    run: (root, options) => reopenTask(root, options),
  },
];

/** The `task start|complete|cancel|reopen` commands. */
export function taskStatusCommands(): readonly CommandSpec[] {
  return COMMANDS.map(statusCommand);
}

function statusCommand(config: StatusCommandConfig): CommandSpec {
  return {
    name: `task ${config.action}`,
    summary: config.summary,
    usage: config.usage,
    details: config.details,
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = args.positionals[0];
      if (id === undefined) {
        throw usageError('A task ID is required', [`Usage: ${config.usage}`]);
      }
      if (!['start', 'reopen'].includes(config.action) && (args.has('role') || args.has('session-id'))) throw usageError('--role and --session-id are supported by task start/reopen.');
      if (!['complete', 'reject'].includes(config.action) && (args.has('report') || args.has('log') || args.has('result'))) throw usageError('--report, --log and --result are supported by task complete/reject.');
      const result = args.opt('result');
      if (result !== undefined && result !== 'pass' && result !== 'reject') throw usageError('--result must be pass or reject');
      if (config.action === 'reject' && result === 'pass') throw usageError('task reject cannot use --result pass');
      const guidance = config.action === 'start' || config.action === 'reopen' ? executionGuidance() : undefined;
      const task = config.run(root, {
        id,
        reason: args.opt('reason'),
        reopen: args.flag('reopen') || config.action === 'reopen',
        actor: args.opt('actor'),
        now: () => ctx.now(),
        role: args.opt('role'),
        sessionId: args.opt('session-id'),
        reports: args.all('report'),
        log: args.opt('log'),
        result,
        errorReport: args.opt('error-report'),
      });
      const context = config.action === 'start' || config.action === 'reopen' ? taskContext(root, task) : undefined;
      const repair = repairReceipt(task);

      const reports = args.all('report').map(file => task.outputs.filter(o => o.kind === 'report' && o.path === documentPath(file)).at(-1)).filter(o => o !== undefined);
      const last = task.history.at(-1);
      const errorReport = last?.extra['error_snapshot'];
      if (!args.flag('detail')) {
        emitResult(ctx, args, { ok: true, task: { id: task.id, status: task.status,
          ...(context ? { title: task.title, claim: task.claim ? { role: task.claim.role, sessionId: task.claim.sessionId } : null } : {}) },
          ...(context ? { context: contextView(context), guidance: { skill_path: guidance!.skill_path, message: 'Read task-take, requirements and references; log context readiness, then work.' } } : {}),
          ...(repair ? { repair } : {}),
          ...(reports.length ? { reports: reports.map(o => attachmentView(o!)) } : {}),
          ...(errorReport ? { error_report: { read_path: errorReport } } : {}),
          ...(task.status === 'pending_review' ? { review: reviewSummary(root, task.id) } : {}) });
        return EXIT_OK;
      }

      emitResult(ctx, args, { ok: true, task: { id: task.id, status: task.status, title: task.title, claim: task.claim },
        ...(context ? { context, guidance } : {}), ...(repair ? { repair } : {}),
        ...(reports.length ? { reports: reports.map(o => attachmentView(o!, true)) } : {}),
        ...(errorReport ? { error_report: { read_path: errorReport } } : {}), ...(task.status === 'pending_review' ? { review: reviewSummary(root, task.id, true) } : {}) });
      return EXIT_OK;
    },
  };
}
