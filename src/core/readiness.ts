import type { TaskRepository } from './repo.js';
import type { TaskDocument, TaskStatus } from './task.js';
import { planningState } from './refinement.js';

/**
 * Computed readiness of one task.
 *
 * Readiness is derived state: it is never written back to task Markdown, only
 * into the generated projection and the HTML viewer.
 */
export type Readiness = 'ready' | 'unready';

/** One reason a task is not ready to start. */
export type BlockedReason =
  | { readonly kind: 'refinement'; readonly state: string }
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
  readonly planningState?: ReturnType<typeof planningState>;
  readonly readiness: Readiness;
  readonly blockedBy: readonly BlockedReason[];
}

/**
 * Computes readiness for every task in the repository.
 *
 * A full dependency is satisfied only when the predecessor is `done`; a partial
 * dependency is satisfied when every task of the referenced completion point is
 * `done`. Manual obstacles belong to status=blocked and do not prevent repair
 * from starting. Derives relations never participate.
 */
export function computeReadiness(
  repository: TaskRepository,
): ReadonlyMap<string, TaskReadiness> {
  const byId = new Map<string, TaskDocument>();
  for (const task of repository.tasks) byId.set(task.id, task);

  const result = new Map<string, TaskReadiness>();
  for (const task of repository.tasks) {
    const state = readinessFor(task, byId);
    if (task.planning !== 'dynamic') { result.set(task.id, state); continue; }
    const plan = planningState(task, repository);
    const blockedBy: BlockedReason[] = [...state.blockedBy, ...(plan === 'refined' || task.status === 'done' || task.status === 'cancelled' ? [] : [{ kind: 'refinement' as const, state: plan }])];
    result.set(task.id, { readiness: blockedBy.some(b => b.kind !== 'manual') ? 'unready' : 'ready', blockedBy, planningState: plan });
  }
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
  if (task.status === 'blocked' && !task.manualBlockers.length) blockedBy.push({ kind: 'manual', text: task.blockedFrom === 'pending_review' ? '审查受阻；重审用 review restart，接手修复用 start' : '任务已受阻；使用 start 接手修复' });

  return { readiness: blockedBy.some(b => b.kind !== 'manual') ? 'unready' : 'ready', blockedBy };
}

function statusOf(byId: ReadonlyMap<string, TaskDocument>, id: string): TaskStatus | undefined {
  return byId.get(id)?.status;
}

/** Human-readable one-line summary used by the CLI and tests. */
export function describeReadiness(readiness: TaskReadiness): string {
  if (readiness.readiness === 'ready') return 'ready';
  return `unready: ${readiness.blockedBy.filter(b => b.kind !== 'manual').map(describeBlockedReason).join(', ')}`;
}

function describeBlockedReason(reason: BlockedReason): string {
  if (reason.kind === 'refinement') return `controller refinement required (${reason.state}); use task refine`;
  if (reason.kind === 'manual') return `manual blocker "${reason.text}"`;
  if (reason.kind === 'task') return `unmet dependency ${reason.task}`;
  const members = reason.tasks.length === 0 ? 'no listed tasks' : reason.tasks.join(', ');
  return `unmet completion point ${reason.task}:${reason.gate} (${members})`;
}
