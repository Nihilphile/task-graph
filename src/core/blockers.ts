import { TaskGraphError } from './errors.js';
import { assertNotCancelled, mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { historyEntry, type TaskDocument } from './task.js';

export interface ManualBlockerOptions extends ClockOptions {
  readonly id: string;
  readonly reason: string;
}

/**
 * Adds one manual blocker.
 *
 * Manual blockers record obstacles that cannot be derived from the DAG (for
 * example a missing approval). Store blocked plus the phase to restore;
 * computed readiness and blocked_by remain derived.
 */
export function addManualBlocker(root: string, options: ManualBlockerOptions): TaskDocument {
  const reason = readReason(options.reason);
  return mutateTaskDocument(root, options.id, (current) => {
    assertNotCancelled(current);
    if (current.status === 'done') throw new TaskGraphError('E_TASK_TRANSITION', 'Reopen completed work before blocking it');
    if (current.manualBlockers.includes(reason)) {
      throw new TaskGraphError(
        'E_DUP_BLOCKER',
        `Task "${current.id}" is already blocked by "${reason}"`,
        [describeBlockers(current)],
      );
    }
    const blockedFrom = current.status === 'blocked' ? current.blockedFrom ?? 'todo' : current.status as 'todo' | 'in_progress' | 'reject';
    return { ...current, status: 'blocked', blockedFrom, manualBlockers: [...current.manualBlockers, reason],
      history: [...current.history, historyEntry('blocked', timestampOf(options.now), options.actor ?? null, { from: current.status, to: 'blocked', reason })] };
  });
}

/** Removes exactly the given manual blocker text. */
export function removeManualBlocker(root: string, options: ManualBlockerOptions): TaskDocument {
  const reason = readReason(options.reason);
  return mutateTaskDocument(root, options.id, (current) => {
    assertNotCancelled(current);
    const index = current.manualBlockers.indexOf(reason);
    if (index < 0) {
      throw new TaskGraphError(
        'E_NO_BLOCKER',
        `Task "${current.id}" is not blocked by "${reason}"`,
        [describeBlockers(current)],
      );
    }
    const manualBlockers = current.manualBlockers.filter((_, position) => position !== index);
    const status = manualBlockers.length ? current.status : current.blockedFrom ?? current.status;
    return {
      ...current,
      status,
      blockedFrom: manualBlockers.length ? current.blockedFrom : undefined,
      manualBlockers,
      history: [...current.history, historyEntry('unblocked', timestampOf(options.now), options.actor ?? null, { from: current.status, to: status, reason })],
    };
  });
}

function readReason(value: string): string {
  const reason = value.trim();
  if (reason.length === 0) {
    throw new TaskGraphError('E_TASK_BLOCKER', 'A manual blocker needs a reason', [
      'Pass --reason <text>.',
    ]);
  }
  return reason;
}

function describeBlockers(task: TaskDocument): string {
  if (task.manualBlockers.length === 0) return `Task "${task.id}" has no manual blockers.`;
  return `Current manual blockers: ${task.manualBlockers.join(' | ')}`;
}
