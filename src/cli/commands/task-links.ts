import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { linkTask, unlinkTask } from '../../core/deps.js';
import type { DependencyMode } from '../../core/task.js';
import { emitResult } from '../output.js';
import { computeReadiness } from '../../core/readiness.js';
import { loadTaskRepository } from '../../core/repo.js';
import { resolveCwd } from '../paths.js';

/** The `task link` and `task unlink` commands. */
export function taskLinkCommands(): readonly CommandSpec[] {
  return [linkCommand(), unlinkCommand()];
}

function linkCommand(): CommandSpec {
  return {
    name: 'task link',
    summary: 'Add a dependency to the successor task',
    usage:
      'task-graph task link T-NNNN --depends-on T-NNNN [--gate <name>] [--mode full|partial] [--cwd <dir>] [--json]',
    details: [
      'The successor is the positional task; the edge is stored only in its depends_on field.',
      'A full dependency waits for the predecessor to be done; --gate creates a partial dependency on a named completion point.',
      'Missing references, self dependencies, duplicates, cross-entry-graph edges and DAG cycles are rejected before anything is written.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const successor = requireTaskId(args, 'task link T-NNNN --depends-on T-NNNN');
      const predecessor = args.opt('depends-on');
      if (predecessor === undefined || predecessor.trim().length === 0) {
        throw usageError('A predecessor task ID is required', ['Pass --depends-on T-NNNN.']);
      }
      const gate = args.opt('gate');
      const mode = readMode(args.opt('mode'));
      const task = linkTask(root, { successor, predecessor, mode, gate });

      const state = computeReadiness(loadTaskRepository(root)).get(task.id)!;
      emitResult(ctx, args, { ok: true, task: { id: task.id, readiness: state.readiness,
        ...(state.blockedBy.length ? { blockedBy: state.blockedBy } : {}),
        ...(args.flag('detail') ? { dependsOn: task.dependsOn } : {}) },
        dependency: { action: 'added', task: predecessor, mode: args.opt('gate') ? 'partial' : 'full', ...(args.opt('gate') ? { gate: args.opt('gate') } : {}) } });
      return EXIT_OK;
    },
  };
}

function unlinkCommand(): CommandSpec {
  return {
    name: 'task unlink',
    summary: 'Remove a dependency from the successor task',
    usage:
      'task-graph task unlink T-NNNN --depends-on T-NNNN [--gate <name>] [--cwd <dir>] [--json]',
    details: [
      'Without --gate the full dependency is removed; --gate removes the matching partial dependency.',
      'Removing a dependency that is not stored fails without touching any file.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const successor = requireTaskId(args, 'task unlink T-NNNN --depends-on T-NNNN');
      const predecessor = args.opt('depends-on');
      if (predecessor === undefined || predecessor.trim().length === 0) {
        throw usageError('A predecessor task ID is required', ['Pass --depends-on T-NNNN.']);
      }
      const task = unlinkTask(root, { successor, predecessor, gate: args.opt('gate') });

      const state = computeReadiness(loadTaskRepository(root)).get(task.id)!;
      emitResult(ctx, args, { ok: true, task: { id: task.id, readiness: state.readiness,
        ...(state.blockedBy.length ? { blockedBy: state.blockedBy } : {}),
        ...(args.flag('detail') ? { dependsOn: task.dependsOn } : {}) },
        dependency: { action: 'removed', task: predecessor, mode: args.opt('gate') ? 'partial' : 'full', ...(args.opt('gate') ? { gate: args.opt('gate') } : {}) } });
      return EXIT_OK;
    },
  };
}

function readMode(raw: string | undefined): DependencyMode | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const mode = raw.trim().toLowerCase();
  if (mode !== 'full' && mode !== 'partial') {
    throw usageError(`Unsupported dependency mode "${raw}"`, ['Supported modes: full, partial.']);
  }
  return mode;
}

function requireTaskId(
  args: { positionals: readonly string[] },
  usage: string,
): string {
  const id = args.positionals[0];
  if (id === undefined) {
    throw usageError('A task ID is required', [`Usage: task-graph ${usage}`]);
  }
  return id;
}
