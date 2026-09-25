import { findDependencyCycle, formatCyclePath } from './dag.js';
import { findCompletionPoint } from './composites.js';
import { TaskGraphError } from './errors.js';
import { mutateTaskDocument } from './mutate.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import type { DependencyMode, TaskDependency, TaskDocument } from './task.js';
import { parentCompositeByGraph, treeRootOf } from './validate.js';

export interface LinkTaskOptions {
  /** Task that holds the new dependency (the successor). */
  readonly successor: string;
  /** Task that must finish first (the predecessor). */
  readonly predecessor: string;
  /** `full` (default) waits for the predecessor to be done. */
  readonly mode?: DependencyMode | undefined;
  /** Completion point name; implies `partial` when `mode` is omitted. */
  readonly gate?: string | undefined;
}

export interface UnlinkTaskOptions {
  readonly successor: string;
  readonly predecessor: string;
  /** Selects the named partial dependency; omitted means the full dependency. */
  readonly gate?: string | undefined;
}

/**
 * Adds one dependency to the successor's own `depends_on` field.
 *
 * Nothing else is written: the predecessor file and the central manifest never
 * carry the edge, and any rejected link (missing reference, self dependency,
 * duplicate, cross-entry-graph edge or DAG cycle) leaves every byte on disk
 * untouched because the check runs before the transaction commits.
 */
export function linkTask(root: string, options: LinkTaskOptions): TaskDocument {
  const successorId = options.successor.trim();
  const predecessorId = options.predecessor.trim();
  const gate = (options.gate ?? '').trim();
  const mode: DependencyMode = options.mode ?? (gate.length > 0 ? 'partial' : 'full');

  if (mode !== 'full' && mode !== 'partial') {
    throw new TaskGraphError('E_TASK_DEP', `Unsupported dependency mode "${String(mode)}"`, [
      'Supported modes: full, partial.',
    ]);
  }
  if (mode === 'partial' && gate.length === 0) {
    throw new TaskGraphError('E_TASK_DEP', 'A partial dependency needs a completion point', [
      'Pass --gate <name>.',
    ]);
  }
  if (mode === 'full' && gate.length > 0) {
    throw new TaskGraphError('E_TASK_DEP', 'A full dependency has no completion point', [
      `Remove --gate "${gate}", or link a partial dependency on a composite task.`,
    ]);
  }
  if (successorId.length === 0 || predecessorId.length === 0) {
    throw new TaskGraphError('E_TASK_DEP', 'A link needs both a successor and a predecessor');
  }
  if (successorId === predecessorId) {
    throw new TaskGraphError('E_TASK_SELF_DEP', `Task "${successorId}" cannot depend on itself`);
  }

  return mutateTaskDocument(root, successorId, (current) => {
    const repository = loadTaskRepository(root);
    const predecessor = repository.taskById(predecessorId);
    if (!predecessor) {
      throw new TaskGraphError(
        'E_UNKNOWN_TASK_REF',
        `Task "${predecessorId}" was not found`,
        [`Known tasks: ${repository.tasks.map((task) => task.id).join(', ') || '(none)'}`],
      );
    }

    if (mode === 'partial') {
      assertKnownGate(predecessor, gate);
    }

    const duplicate = current.dependsOn.some((dependency) =>
        dependency.task === predecessor.id &&
        dependency.mode === mode &&
        (dependency.gate ?? '') === gate,
    );
    if (duplicate) {
      throw new TaskGraphError(
        'E_TASK_DEP',
        `Task "${current.id}" already depends on "${predecessor.id}"`,
        [mode === 'partial' ? `Existing partial dependency on gate "${gate}".` : 'Existing full dependency.'],
      );
    }

    assertSameEntryTree(current, predecessor, repository);

    const dependency: TaskDependency =
      mode === 'partial'
        ? { task: predecessor.id, mode: 'partial', gate }
        : { task: predecessor.id, mode: 'full' };
    const dependsOn = [...current.dependsOn, dependency];

    const cycle = findDependencyCycle(
      repository.tasks.map((task) =>
        task.id === current.id ? { id: task.id, dependsOn } : { id: task.id, dependsOn: task.dependsOn },
      ),
    );
    if (cycle) {
      throw new TaskGraphError(
        'E_DEP_CYCLE',
        `Linking "${predecessor.id}" -> "${current.id}" would create a dependency cycle`,
        [`Cycle path: ${formatCyclePath(cycle)}`],
      );
    }

    return { ...current, dependsOn };
  });
}

/**
 * Removes the selected dependency from the successor's `depends_on` field.
 *
 * Without `--gate` the full dependency is removed; a named partial dependency is
 * removed only when its completion point matches.
 */
export function unlinkTask(root: string, options: UnlinkTaskOptions): TaskDocument {
  const gate = (options.gate ?? '').trim();
  return mutateTaskDocument(root, options.successor.trim(), (current) => {
    const index = current.dependsOn.findIndex((dependency) =>
      gate.length > 0
        ? dependency.task === options.predecessor &&
          dependency.mode === 'partial' &&
          (dependency.gate ?? '') === gate
        : dependency.task === options.predecessor && dependency.mode === 'full',
    );
    if (index < 0) {
      throw new TaskGraphError(
        'E_NO_DEP',
        gate.length > 0
          ? `Task "${current.id}" has no partial dependency on "${options.predecessor}" at gate "${gate}"`
          : `Task "${current.id}" has no full dependency on "${options.predecessor}"`,
        [describeDependencies(current)],
      );
    }
    return {
      ...current,
      dependsOn: current.dependsOn.filter((_, position) => position !== index),
    };
  });
}

/** Rejects a partial dependency whose completion point does not exist. */
function assertKnownGate(predecessor: TaskDocument, gate: string): void {
  const subgraph = predecessor.subgraph;
  if (!subgraph) {
    throw new TaskGraphError(
      'E_UNKNOWN_GATE',
      `Task "${predecessor.id}" is not a composite task and exposes no completion points`,
      ['A partial dependency can only target a composite task.'],
    );
  }
  if (findCompletionPoint(predecessor, gate)) return;
  const names = subgraph.exposes.map((point) => point.name);
  throw new TaskGraphError(
    'E_UNKNOWN_GATE',
    `Task "${predecessor.id}" does not expose completion point "${gate}"`,
    [
      names.length === 0
        ? `Task "${predecessor.id}" exposes no completion points yet (use \`task-graph task expose-gate\`).`
        : `Available completion points: ${names.join(', ')}`,
    ],
  );
}

/** Rejects an edge that crosses entry graph trees or a subgraph layer. */
function assertSameEntryTree(
  successor: TaskDocument,
  predecessor: TaskDocument,
  repository: TaskRepository,
): void {
  if (successor.graph === predecessor.graph) return;

  const parents = parentCompositeByGraph(
    repository.tasks.map((document) => ({ document })),
  );
  const successorRoot = treeRootOf(successor.graph, repository.manifest, parents);
  const predecessorRoot = treeRootOf(predecessor.graph, repository.manifest, parents);

  if (successorRoot === predecessorRoot) {
    throw new TaskGraphError(
      'E_CROSS_LAYER_DEP',
      `Task "${successor.id}" in graph "${successor.graph}" cannot depend directly on task "${predecessor.id}" in nested graph "${predecessor.graph}"`,
      ['Depend on the composite task or on one of its named completion points instead.'],
    );
  }
  throw new TaskGraphError(
    'E_CROSS_ENTRY_DEP',
    `Task "${successor.id}" in entry graph tree "${
      successorRoot ?? successor.graph
    }" cannot depend on task "${predecessor.id}" in a different entry graph tree`,
    ['Entry graph trees are independent; move the work into one graph instead.'],
  );
}

function describeDependencies(task: TaskDocument): string {
  if (task.dependsOn.length === 0) return `Task "${task.id}" has no dependencies.`;
  return `Current dependencies: ${task.dependsOn
    .map((dependency) =>
      dependency.mode === 'partial'
        ? `${dependency.task}:${dependency.gate ?? ''}`
        : dependency.task,
    )
    .join(', ')}`;
}

/** Current dependency edges of a task, in stored order. */
export function dependencyEdges(task: TaskDocument): readonly TaskDependency[] {
  return task.dependsOn;
}
