import { TaskGraphError } from './errors.js';
import { mutateTaskDocument } from './mutate.js';
import { loadTaskRepository } from './repo.js';
import type { CompletionPoint, TaskDocument, TaskSubgraph } from './task.js';

export interface AttachSubgraphOptions {
  /** Composite task that will own the child graph. */
  readonly task: string;
  /** Registered, non-entry graph to attach. */
  readonly graph: string;
  /** Tasks of the child graph that define completion; validated for membership. */
  readonly completionRequires?: readonly string[] | undefined;
}

export interface SetCompletionOptions {
  readonly task: string;
  /** Replacement completion targets; every one must belong to the child graph. */
  readonly requires: readonly string[];
}

export interface ExposeGateOptions {
  /** Composite task that publishes the completion point. */
  readonly task: string;
  /** Unique completion point name, used by partial dependencies. */
  readonly name: string;
  /** One or more tasks of the child graph the point waits for. */
  readonly requires: readonly string[];
}

/**
 * Attaches a registered non-entry graph as the subgraph of one composite task.
 *
 * A child graph has exactly one parent, so attaching a graph that another task
 * already owns is refused. The completion targets are validated to come from the
 * child graph before anything is written.
 */
export function attachSubgraph(root: string, options: AttachSubgraphOptions): TaskDocument {
  const graphId = options.graph.trim();
  if (graphId.length === 0) {
    throw new TaskGraphError('E_UNKNOWN_GRAPH_REF', 'A subgraph ID is required');
  }
  const requested = dedupe(options.completionRequires ?? []);

  return mutateTaskDocument(root, options.task.trim(), (current) => {
    const repository = loadTaskRepository(root);
    if (!repository.manifest.graphs.some((graph) => graph.id === graphId)) {
      throw new TaskGraphError('E_UNKNOWN_GRAPH_REF', `Graph "${graphId}" is not registered`, [
        `Registered graphs: ${repository.manifest.graphs.map((graph) => graph.id).join(', ') || '(none)'}`,
      ]);
    }
    if (repository.manifest.entryGraphs.includes(graphId)) {
      throw new TaskGraphError(
        'E_ENTRY_IS_SUBGRAPH',
        `Graph "${graphId}" is an entry graph and cannot be used as a subgraph`,
        ['Only a non-entry graph can be attached to a composite task.'],
      );
    }
    const currentParent = repository.tasks.find((task) => task.subgraph?.graph === graphId);
    if (currentParent && currentParent.id !== current.id) {
      throw new TaskGraphError(
        'E_SUBGRAPH_MULTI_PARENT',
        `Graph "${graphId}" is already entered by composite task "${currentParent.id}"`,
        ['A child graph has exactly one parent composite task.'],
      );
    }
    if (current.subgraph && current.subgraph.graph !== graphId) {
      throw new TaskGraphError(
        'E_TASK_SUBGRAPH',
        `Task "${current.id}" already owns subgraph "${current.subgraph.graph}"`,
        ['A task can enter at most one child graph.'],
      );
    }

    const requires = requested.length > 0 ? requested : [...(current.subgraph?.completionRequires ?? [])];
    assertCompletionTargets(current.id, graphId, requires, repository);

    const subgraph: TaskSubgraph = {
      graph: graphId,
      completionRequires: requires,
      exposes: current.subgraph?.graph === graphId ? [...current.subgraph.exposes] : [],
    };
    return { ...current, subgraph };
  });
}

/**
 * Replaces the `completion_requires` list of an existing composite task.
 *
 * Targets outside the referenced child graph are rejected, so the completion
 * contract always stays inside the subgraph it belongs to.
 */
export function setCompletionRequires(root: string, options: SetCompletionOptions): TaskDocument {
  const requires = dedupe(options.requires);
  return mutateTaskDocument(root, options.task.trim(), (current) => {
    if (!current.subgraph) {
      throw new TaskGraphError(
        'E_NO_SUBGRAPH',
        `Task "${current.id}" has no subgraph`,
        ['Attach a child graph first, for example `task-graph graph add --title <title> --parent-task T-NNNN`.'],
      );
    }
    const repository = loadTaskRepository(root);
    assertCompletionTargets(current.id, current.subgraph.graph, requires, repository);
    return {
      ...current,
      subgraph: { ...current.subgraph, completionRequires: requires },
    };
  });
}

/** Completion points exposed by a composite task, in stored order. */
export function completionPoints(task: TaskDocument): readonly CompletionPoint[] {
  return task.subgraph?.exposes ?? [];
}

/**
 * Creates one unique named completion point on a composite task.
 *
 * The point must require at least one task, and every required task must belong
 * to the composite task child graph, so an outer task can depend on a stable
 * named portion without ever referencing a nested task directly.
 */
export function exposeCompletionPoint(root: string, options: ExposeGateOptions): TaskDocument {
  const name = options.name.trim();
  if (name.length === 0) {
    throw new TaskGraphError('E_GATE_NAME', 'A completion point needs a name', [
      'Pass --name <name>.',
    ]);
  }
  if (options.requires.length === 0) {
    throw new TaskGraphError(
      'E_EMPTY_GATE',
      `Completion point "${name}" requires no tasks`,
      ['Pass at least one --requires T-NNNN from the child graph.'],
    );
  }
  const requires = dedupe(options.requires);

  return mutateTaskDocument(root, options.task.trim(), (current) => {
    if (!current.subgraph) {
      throw new TaskGraphError(
        'E_NO_SUBGRAPH',
        `Task "${current.id}" has no subgraph`,
        ['Attach a child graph before exposing a completion point.'],
      );
    }
    if (current.subgraph.exposes.some((point) => point.name === name)) {
      throw new TaskGraphError(
        'E_DUP_GATE',
        `Task "${current.id}" already exposes completion point "${name}"`,
        [describeGates(current)],
      );
    }
    const repository = loadTaskRepository(root);
    assertCompletionTargets(current.id, current.subgraph.graph, requires, repository);
    return {
      ...current,
      subgraph: {
        ...current.subgraph,
        exposes: [...current.subgraph.exposes, { name, requires }],
      },
    };
  });
}

/** Finds a published completion point by name. */
export function findCompletionPoint(
  composite: TaskDocument,
  name: string,
): CompletionPoint | undefined {
  return composite.subgraph?.exposes.find((point) => point.name === name);
}

function describeGates(task: TaskDocument): string {
  const names = (task.subgraph?.exposes ?? []).map((point) => point.name);
  return names.length === 0
    ? `Task "${task.id}" exposes no completion points yet.`
    : `Existing completion points: ${names.join(', ')}`;
}

function assertCompletionTargets(
  compositeId: string,
  childGraph: string,
  requires: readonly string[],
  repository: ReturnType<typeof loadTaskRepository>,
): void {
  for (const target of requires) {
    const document = repository.taskById(target);
    if (!document) {
      throw new TaskGraphError(
        'E_UNKNOWN_TASK_REF',
        `Task "${compositeId}" lists completion target "${target}" which does not exist`,
      );
    }
    if (document.graph !== childGraph) {
      throw new TaskGraphError(
        'E_COMPLETION_OUTSIDE_SUBGRAPH',
        `Task "${compositeId}" lists completion target "${target}" outside child graph "${childGraph}"`,
        [`Task "${target}" belongs to graph "${document.graph}".`],
      );
    }
  }
}

function dedupe(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new TaskGraphError('E_UNKNOWN_TASK_REF', 'A completion target must not be empty');
    }
    if (result.includes(trimmed)) {
      throw new TaskGraphError('E_DUP_COMPLETION', `Duplicate completion target "${trimmed}"`);
    }
    result.push(trimmed);
  }
  return result;
}
