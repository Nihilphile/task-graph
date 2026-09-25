import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { addManualBlocker, removeManualBlocker } from '../../core/blockers.js';
import type { TaskDocument } from '../../core/task.js';
import { resolveCwd } from '../paths.js';

/** The `task block` and `task unblock` commands. */
export function taskBlockerCommands(): readonly CommandSpec[] {
  return [blockCommand(), unblockCommand()];
}

function blockCommand(): CommandSpec {
  return {
    name: 'task block',
    summary: 'Add a manual blocker that the DAG cannot express',
    usage: 'task-graph task block T-NNNN --reason <text> [--cwd <dir>] [--json]',
    details: [
      'Use manual blockers only for external obstacles such as a pending approval.',
      'Readiness and blocked_by stay computed values and are never written to the task file.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = requireTaskId(args, 'task block T-NNNN --reason <text>');
      const reason = requireReason(args);
      const task = addManualBlocker(root, { id, reason });
      report(ctx, args, `Blocked ${task.id}: ${reason}`, task);
      return EXIT_OK;
    },
  };
}

function unblockCommand(): CommandSpec {
  return {
    name: 'task unblock',
    summary: 'Remove one manual blocker',
    usage: 'task-graph task unblock T-NNNN --reason <text> [--cwd <dir>] [--json]',
    details: [
      'The reason must match a stored blocker exactly.',
      'Removing a blocker is the only way it disappears; nothing expires automatically.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = requireTaskId(args, 'task unblock T-NNNN --reason <text>');
      const reason = requireReason(args);
      const task = removeManualBlocker(root, { id, reason });
      report(ctx, args, `Unblocked ${task.id}: ${reason}`, task);
      return EXIT_OK;
    },
  };
}

function requireTaskId(args: { positionals: readonly string[] }, usage: string): string {
  const id = args.positionals[0];
  if (id === undefined) {
    throw usageError('A task ID is required', [`Usage: task-graph ${usage}`]);
  }
  return id;
}

function requireReason(args: { opt(name: string): string | undefined }): string {
  const reason = args.opt('reason');
  if (reason === undefined) {
    throw usageError('A blocker reason is required', ['Pass --reason <text>.']);
  }
  return reason;
}

function report(
  ctx: CliContext,
  args: { flag(name: string): boolean },
  message: string,
  task: TaskDocument,
): void {
  if (args.flag('json')) {
    ctx.io.out(
      JSON.stringify(
        { ok: true, task: { id: task.id, manualBlockers: task.manualBlockers } },
        null,
        2,
      ),
    );
  } else if (!args.flag('quiet')) {
    ctx.io.out(message);
  }
}
