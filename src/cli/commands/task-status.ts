import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import {
  cancelTask,
  completeTask,
  reopenTask,
  startTask,
  type TransitionOptions,
} from '../../core/lifecycle.js';
import type { TaskDocument } from '../../core/task.js';
import { resolveCwd } from '../paths.js';

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
    action: 'start',
    summary: 'Move a task from todo to in_progress',
    verb: 'Started',
    usage:
      'task-graph task start T-NNNN [--role <role> --session-id <session>] [--reopen] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Dependencies and manual blockers must be satisfied; a handoff snapshot is saved at start.',
      'Pass --role and --session-id to claim and start in one transaction.',
      'A done task only moves back with --reopen, so finishing is never undone by accident.',
      'A cancelled task is terminal and cannot be started.',
    ],
    run: (root, options) => startTask(root, options),
  },
  {
    action: 'complete',
    summary: 'Move a task from in_progress to done',
    verb: 'Completed',
    usage:
      'task-graph task complete T-NNNN [--report <file>]... [--log <text>] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Only a running task can be completed; todo -> done is not a supported transition.',
      'A composite task is refused until every completion_requires target is done.',
      'Reports, log, completion and claim release are saved atomically. Reports are snapshotted.',
    ],
    run: (root, options) => completeTask(root, options),
  },
  {
    action: 'cancel',
    summary: 'Cancel a todo or in_progress task (terminal)',
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
    summary: 'Explicitly reopen a done task as in_progress',
    verb: 'Reopened',
    usage:
      'task-graph task reopen T-NNNN [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Only a done task can be reopened; cancelled work is never reopened.',
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
      if (config.action !== 'start' && (args.has('role') || args.has('session-id'))) throw usageError('--role and --session-id are supported by task start.');
      if (config.action !== 'complete' && (args.has('report') || args.has('log'))) throw usageError('--report and --log are supported by task complete.');
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
      });

      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            { ok: true, task: { id: task.id, status: task.status, title: task.title } },
            null,
            2,
          ),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(`${config.verb} ${task.id} (${task.status}): ${task.title}`);
      }
      return EXIT_OK;
    },
  };
}
