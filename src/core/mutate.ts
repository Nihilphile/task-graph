import { TaskGraphError } from './errors.js';
import { buildProject } from './build.js';
import { loadTaskRepository } from './repo.js';
import { serializeTaskDocument, type TaskDocument } from './task.js';
import { toIsoTimestamp } from './time.js';
import { runProjectTransaction, type ProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';
import { assertPlanMutable } from './refinement.js';
import { recordWatchResult } from './watch.js';

/** Actor plus injectable clock shared by every structured task command. */
export interface ClockOptions {
  readonly actor?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

/** Current time as an ISO 8601 string with a local UTC offset. */
export function timestampOf(now?: (() => Date) | undefined): string {
  return toIsoTimestamp(now ? now() : new Date());
}

/**
 * Applies one in-place change to a single task document.
 *
 * The change runs inside a project transaction: the repository is re-read under
 * the lock, the rewritten document is validated before the transaction is
 * accepted, and generated artifacts are rebuilt only after a successful commit.
 */
export function mutateTaskDocument(
  root: string,
  id: string,
  mutate: (current: TaskDocument, transaction: ProjectTransaction) => TaskDocument,
): TaskDocument {
  let touchedId: string | null = null;

  runProjectTransaction(
    root,
    (transaction) => {
      const repository = loadTaskRepository(root);
      const current = repository.taskById(id);
      if (!current) {
        throw new TaskGraphError('E_NO_TASK', `Task "${id}" was not found`);
      }
      const next = mutate(current, transaction);
      assertPlanMutable(current, next);
      if (current.status !== next.status && (next.status === 'done' || next.status === 'reject')) recordWatchResult(root, next, transaction);
      transaction.write(
        `.task-graph/tasks/${current.id}.md`,
        serializeTaskDocument(next),
      );
      touchedId = current.id;
    },
    { validate: () => assertRepositoryValid(root) },
  );

  buildProject(root);

  const updated = touchedId === null ? undefined : loadTaskRepository(root).taskById(touchedId);
  if (!updated) throw new TaskGraphError('E_INTERNAL', `Task "${id}" disappeared after the mutation`);
  return updated;
}

/** Rejects work that is not allowed while a task is cancelled (terminal). */
export function assertNotCancelled(task: TaskDocument): void {
  if (task.status !== 'cancelled') return;
  throw new TaskGraphError('E_TASK_TRANSITION', `Task "${task.id}" is cancelled`, [
    'Cancelled is terminal: create a new task or revise the goal instead.',
  ]);
}
