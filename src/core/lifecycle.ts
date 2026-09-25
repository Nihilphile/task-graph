import { TaskGraphError } from './errors.js';
import { loadTaskRepository } from './repo.js';
import { historyEntry, type TaskDocument, type TaskStatus } from './task.js';
import { assertNotCancelled, mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { appendManagedLog, saveHandoff, withDocument } from './documents.js';
import { computeReadiness, describeReadiness } from './readiness.js';

/**
 * Allowed persisted status transitions.
 *
 * `cancelled` is terminal. `done` can only move back through an explicit
 * reopen, so a finished task never silently becomes active again.
 */
export const STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: ['in_progress'],
  cancelled: [],
};

/** History event name recorded for each supported transition. */
export const TRANSITION_EVENTS: Readonly<Record<string, string>> = {
  'todo->in_progress': 'started',
  'in_progress->done': 'completed',
  'todo->cancelled': 'cancelled',
  'in_progress->cancelled': 'cancelled',
  'done->in_progress': 'reopened',
};

export interface TransitionOptions extends ClockOptions {
  readonly id: string;
  readonly reason?: string | undefined;
  /** Required to move a `done` task back to `in_progress`. */
  readonly reopen?: boolean | undefined;
  readonly role?: string;
  readonly sessionId?: string;
  readonly reports?: readonly string[];
  readonly log?: string;
}

/**
 * Moves a task to `to`, rejecting every unsupported transition before anything
 * is written, and appending a history event with the actor and timestamp.
 */
export function transitionTask(
  root: string,
  to: TaskStatus,
  options: TransitionOptions,
): TaskDocument {
  const at = timestampOf(options.now);
  return mutateTaskDocument(root, options.id, (current, transaction) => {
    const from = current.status;
    assertNotCancelled(current);
    if (from === to) {
      throw new TaskGraphError(
        'E_TASK_TRANSITION',
        `Task "${current.id}" is already ${to}`,
        [`Supported transitions from ${from}: ${describeAllowed(from)}`],
      );
    }
    if (!STATUS_TRANSITIONS[from].includes(to)) {
      throw new TaskGraphError(
        'E_TASK_TRANSITION',
        `Task "${current.id}" cannot move from ${from} to ${to}`,
        [
          `Supported transitions from ${from}: ${describeAllowed(from)}`,
          ...(from === 'cancelled'
            ? ['Cancelled is terminal: create a new task instead.']
            : []),
        ],
      );
    }
    if (from === 'done' && to === 'in_progress' && options.reopen !== true) {
      throw new TaskGraphError(
        'E_TASK_TRANSITION',
        `Task "${current.id}" is done; reopening is explicit`,
        ['Pass --reopen (or use `task-graph task reopen`) to move it back to in_progress.'],
      );
    }
    if (to === 'done' && current.subgraph) {
      assertCompletionComplete(root, current);
    }

    let next = current;
    if (to === 'in_progress') {
      const readiness = computeReadiness(loadTaskRepository(root)).get(current.id)!;
      if (readiness.readiness === 'blocked') throw new TaskGraphError('E_TASK_BLOCKED', `Task "${current.id}" is ${describeReadiness(readiness)}`);
      if (options.role !== undefined || options.sessionId !== undefined) {
        if (!options.role?.trim() || !options.sessionId?.trim()) throw new TaskGraphError('E_TASK_CLAIM', 'Starting with a claim requires --role and --session-id');
        if (current.claim && (current.claim.role !== options.role || current.claim.sessionId !== options.sessionId)) throw new TaskGraphError('E_TASK_CLAIMED', `Task "${current.id}" is already claimed`, ['Use task reassign for an explicit takeover.']);
        if (!current.claim) next = { ...next, claim: { role: options.role.trim(), sessionId: options.sessionId.trim(), claimedAt: at },
          history: [...next.history, historyEntry('claimed', at, options.actor ?? null, { role: options.role.trim(), session_id: options.sessionId.trim() })] };
      }
      next = saveHandoff(root, { ...next, status: to }, transaction, { ...options, title: `派工 · ${at}` });
    }
    if (to === 'done') {
      for (const report of options.reports ?? []) next = withDocument(root, next, transaction, { ...options, path: report, kind: 'report' });
      if (options.log !== undefined) next = appendManagedLog(root, next, transaction, options.log, options);
      if (next.claim) {
        next = { ...next, claim: null, history: [...next.history,
          historyEntry('released', at, options.actor ?? null, { role: next.claim.role, session_id: next.claim.sessionId, reason: 'task completed' }),
        ] };
      }
    }

    const event = TRANSITION_EVENTS[`${from}->${to}`] ?? 'status-changed';
    return {
      ...next,
      status: to,
      history: [
        ...next.history,
        historyEntry(event, at, options.actor ?? null, {
          from,
          to,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        }),
      ],
    };
  });
}

/** `todo` -> `in_progress`; a `done` task requires `reopen: true`. */
export function startTask(root: string, options: TransitionOptions): TaskDocument {
  return transitionTask(root, 'in_progress', options);
}

/** `in_progress` -> `done`. */
export function completeTask(root: string, options: TransitionOptions): TaskDocument {
  return transitionTask(root, 'done', options);
}

/** `todo` or `in_progress` -> `cancelled` (terminal). */
export function cancelTask(root: string, options: TransitionOptions): TaskDocument {
  return transitionTask(root, 'cancelled', options);
}

/** `done` -> `in_progress`, only through an explicit reopen request. */
export function reopenTask(root: string, options: TransitionOptions): TaskDocument {
  return transitionTask(root, 'in_progress', { ...options, reopen: true });
}

/** Human-readable list of transitions allowed from a status. */
export function describeAllowed(status: TaskStatus): string {
  const allowed = STATUS_TRANSITIONS[status];
  return allowed.length === 0 ? '(none: terminal)' : allowed.join(', ');
}

/**
 * A composite task may only be completed once every one of its declared
 * completion targets is done. Without declared targets there is no completion
 * contract, so the task cannot be marked done.
 */
function assertCompletionComplete(root: string, current: TaskDocument): void {
  const subgraph = current.subgraph;
  if (!subgraph) return;
  if (subgraph.completionRequires.length === 0) {
    throw new TaskGraphError(
      'E_COMPLETION_INCOMPLETE',
      `Composite task "${current.id}" declares no completion targets`,
      [
        `Declare completion targets from child graph "${subgraph.graph}", for example \`task-graph task set-completion ${current.id} --requires T-NNNN\`.`,
      ],
    );
  }
  const repository = loadTaskRepository(root);
  const unfinished = subgraph.completionRequires.filter(
    (taskId) => repository.taskById(taskId)?.status !== 'done',
  );
  if (unfinished.length === 0) return;
  throw new TaskGraphError(
    'E_COMPLETION_INCOMPLETE',
    `Task "${current.id}" cannot be done until every completion target is done`,
    [`Unfinished completion targets: ${unfinished.join(', ')}`],
  );
}
