import { TaskGraphError } from './errors.js';
import { historyEntry, type TaskDocument } from './task.js';
import { loadTaskRepository } from './repo.js';
import { computeReadiness, describeReadiness } from './readiness.js';
import { currentReview, readReviewState, writeReviewState } from './review-state.js';
import { processAlive } from './review.js';
import { saveHandoff } from './documents.js';
import { timestampOf, type ClockOptions } from './mutate.js';
import type { ProjectTransaction } from './transaction.js';

/** Accepting blocked work ends the waiting episode; old reasons remain in the audit trail. */
export function beginBlockedRepair(root: string, task: TaskDocument, tx: ProjectTransaction, options: ClockOptions): TaskDocument {
  if (task.status !== 'blocked') return task;
  const state = readReviewState(root), review = currentReview(state, task.id);
  if (review && (['queued', 'running'].includes(review.state) || processAlive(review.workerPid) || processAlive(review.childPid))) {
    throw new TaskGraphError('E_REVIEW_RUNNING', 'The previous review may still be active; recover or stop it before accepting repair work');
  }
  let next: TaskDocument = { ...task, status: 'in_progress', blockedFrom: undefined, manualBlockers: [] };
  // Accepting responsibility for manual obstacles does not waive prerequisites or controller refinement.
  const repository = loadTaskRepository(root);
  const ready = computeReadiness({ ...repository, tasks: repository.tasks.map(t => t.id === task.id ? next : t) }).get(task.id)!;
  if (ready.readiness !== 'ready') throw new TaskGraphError('E_TASK_UNREADY', `Task "${task.id}" is ${describeReadiness(ready)}`);
  const at = timestampOf(options.now);
  next = { ...next, history: [...next.history, historyEntry('repair_started', at, options.actor ?? null, {
    from: 'blocked', to: 'in_progress', previous_phase: task.blockedFrom ?? 'todo',
    previous_blockers: [...task.manualBlockers], ...(review ? { previous_review: review.id } : {}),
  })] };
  // The old frozen review remains auditable but cannot submit against the repaired delivery.
  if (review) { delete state.tasks[task.id]!.current; writeReviewState(tx, state); }
  return saveHandoff(root, next, tx, { ...options, title: `修复接手 · ${at}` });
}

export function repairReceipt(task: TaskDocument) {
  const event = task.history.at(-1);
  return event?.event === 'repair_started' ? {
    previous_phase: event.extra['previous_phase'], previous_blockers: event.extra['previous_blockers'],
    ...(event.extra['previous_review'] ? { previous_review: event.extra['previous_review'] } : {}),
  } : undefined;
}
