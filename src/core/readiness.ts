import type { TaskRepository } from './repo.js';
import type { TaskDocument, TaskStatus } from './task.js';

/**
 * Computed readiness of one task.
 *
 * Readiness is derived state: it is never written back to task Markdown, only
 * into the generated projection and the HTML viewer.
 */
export type Readiness = 'ready' | 'blocked';

/** One reason a task is not ready to start. */
export type BlockedReason =
  | { readonly kind: 'task'; readonly task: string }
  | {
      readonly kind: 'gate';
      readonly task: string;
      readonly gate: string;
      /** Tasks required by the completion point that are not done yet. */
      readonly tasks: readonly string[];
    }
  | { readonly kind: 'manual'; readonly text: string };

export interface TaskReadiness {
  readonly readiness: Readiness;
  readonly blockedBy: readonly BlockedReason[];
}

/**
 * Computes readiness for every task in the repository.
 *
 * A full dependency is satisfied only when the predecessor is `done`; a partial
 * dependency is satisfied when every task of the referenced completion point is
 * `done`; manual blockers always block. Derives relations never participate.
 */
export function computeReadiness(
  repository: TaskRepository,
): ReadonlyMap<string, TaskReadiness> {
  const byId = new Map<string, TaskDocument>();
  for (const task of repository.tasks) byId.set(task.id, task);

  const result = new Map<string, TaskReadiness>();
  for (const task of repository.tasks) result.set(task.id, readinessFor(task, byId));
  return result;
}

/** Readiness of a single task given the full task index. */
export function readinessFor(
  task: TaskDocument,
  byId: ReadonlyMap<string, TaskDocument>,
): TaskReadiness {
  const blockedBy: BlockedReason[] = [];

  for (const dependency of task.dependsOn) {
    const predecessor = byId.get(dependency.task);
    if (!predecessor) {
      blockedBy.push({ kind: 'task', task: dependency.task });
      continue;
    }
    if (dependency.mode !== 'partial') {
      if (predecessor.status !== 'done') {
        blockedBy.push({ kind: 'task', task: predecessor.id });
      }
      continue;
    }

    const gate = dependency.gate ?? '';
    const point = predecessor.subgraph?.exposes.find((exposed) => exposed.name === gate);
    const required = point?.requires ?? [];
    const unmet = required.filter((id) => statusOf(byId, id) !== 'done');
    if (unmet.length > 0 || point === undefined) {
      blockedBy.push({ kind: 'gate', task: predecessor.id, gate, tasks: unmet });
    }
  }

  for (const text of task.manualBlockers) {
    blockedBy.push({ kind: 'manual', text });
  }

  return { readiness: blockedBy.length === 0 ? 'ready' : 'blocked', blockedBy };
}

function statusOf(byId: ReadonlyMap<string, TaskDocument>, id: string): TaskStatus | undefined {
  return byId.get(id)?.status;
}

/** Human-readable one-line summary used by the CLI and tests. */
export function describeReadiness(readiness: TaskReadiness): string {
  if (readiness.readiness === 'ready') return 'ready';
  return `blocked by ${readiness.blockedBy.map(describeBlockedReason).join(', ')}`;
}

function describeBlockedReason(reason: BlockedReason): string {
  if (reason.kind === 'manual') return `manual blocker "${reason.text}"`;
  if (reason.kind === 'task') return `unmet dependency ${reason.task}`;
  const members = reason.tasks.length === 0 ? 'no listed tasks' : reason.tasks.join(', ');
  return `unmet completion point ${reason.task}:${reason.gate} (${members})`;
}
