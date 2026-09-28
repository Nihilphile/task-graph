import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { attachSubgraph, exposeCompletionPoint, setCompletionRequires } from '../../core/composites.js';
import type { TaskDocument } from '../../core/task.js';
import { emitResult } from '../output.js';
import type { ParsedArgs } from '../args.js';
import { resolveCwd } from '../paths.js';

/** The `task attach-subgraph`, `task set-completion` and `task expose-gate` commands. */
export function taskCompositeCommands(): readonly CommandSpec[] {
  return [attachCommand(), completionCommand(), exposeGateCommand()];
}

function attachCommand(): CommandSpec {
  return {
    name: 'task attach-subgraph',
    summary: 'Attach a registered non-entry graph as a composite task subgraph',
    usage:
      'task-graph task attach-subgraph T-NNNN --graph G-NNN [--requires T-NNNN]... [--cwd <dir>] [--json]',
    details: [
      'A child graph has exactly one parent composite task, so a graph already owned elsewhere is refused.',
      '--requires lists tasks of the child graph that define the completion contract.',
      'The usual path is `graph add --title <title> --parent-task T-NNNN`, which registers and attaches at once.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const task = requireTaskId(args, 'task attach-subgraph T-NNNN --graph G-NNN');
      const graph = args.opt('graph');
      if (graph === undefined || graph.trim().length === 0) {
        throw usageError('A subgraph ID is required', ['Pass --graph G-NNN.']);
      }
      const attached = attachSubgraph(root, {
        task,
        graph,
        completionRequires: args.all('requires'),
      });
      report(ctx, args, attachMessage(attached), attached);
      return EXIT_OK;
    },
  };
}

function completionCommand(): CommandSpec {
  return {
    name: 'task set-completion',
    summary: 'Replace the completion targets of a composite task',
    usage: 'task-graph task set-completion T-NNNN --requires T-NNNN [--requires T-NNNN]... [--cwd <dir>] [--json]',
    details: [
      'Every target must belong to the composite task child graph.',
      'A composite task cannot be completed until all of its completion targets are done.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const task = requireTaskId(args, 'task set-completion T-NNNN --requires T-NNNN');
      const requires = args.all('requires');
      if (requires.length === 0) {
        throw usageError('At least one completion target is required', [
          'Pass --requires T-NNNN (repeat for each target).',
        ]);
      }
      const updated = setCompletionRequires(root, { task, requires });
      report(
        ctx,
        args,
        `Completion targets for ${updated.id}: ${updated.subgraph?.completionRequires.join(', ') ?? '(none)'}`,
        updated,
      );
      return EXIT_OK;
    },
  };
}

function exposeGateCommand(): CommandSpec {
  return {
    name: 'task expose-gate',
    summary: 'Publish a named completion point on a composite task',
    usage:
      'task-graph task expose-gate T-NNNN --name <name> --requires T-NNNN [--requires T-NNNN]... [--cwd <dir>] [--json]',
    details: [
      'Names must be unique per composite task; every required task must belong to its child graph.',
      'Outer tasks then depend on the composite task plus the gate name, never on a nested task directly.',
      'A partial dependency is satisfied only when every task required by the gate is done.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const task = requireTaskId(args, 'task expose-gate T-NNNN --name <name> --requires T-NNNN');
      const name = args.opt('name');
      if (name === undefined || name.trim().length === 0) {
        throw usageError('A completion point name is required', ['Pass --name <name>.']);
      }
      const requires = args.all('requires');
      if (requires.length === 0) {
        throw usageError('At least one required task is needed', [
          'Pass --requires T-NNNN (repeat for each task of the child graph).',
        ]);
      }
      const updated = exposeCompletionPoint(root, { task, name, requires });
      report(
        ctx,
        args,
        `Exposed ${name.trim()} on ${updated.id} (requires: ${requires.join(', ')})`,
        updated,
      );
      return EXIT_OK;
    },
  };
}

function attachMessage(task: TaskDocument): string {
  const subgraph = task.subgraph;
  const targets = subgraph?.completionRequires ?? [];
  return `Attached ${subgraph?.graph ?? '?'} to ${task.id}${
    targets.length === 0 ? '' : ` (completion: ${targets.join(', ')})`
  }`;
}

function requireTaskId(args: { positionals: readonly string[] }, usage: string): string {
  const id = args.positionals[0];
  if (id === undefined) {
    throw usageError('A task ID is required', [`Usage: task-graph ${usage}`]);
  }
  return id;
}

function report(
  ctx: CliContext,
  args: ParsedArgs,
  message: string,
  task: TaskDocument,
): void {
  const subgraph = task.subgraph!;
  emitResult(ctx, args, { ok: true, task: { id: task.id, subgraph: args.flag('detail') ? subgraph : {
    graph: subgraph.graph,
    ...(args.has('name') ? { exposes: subgraph.exposes.filter(point => point.name === args.opt('name')?.trim()) } : { completionRequires: subgraph.completionRequires })
  } } });
}
