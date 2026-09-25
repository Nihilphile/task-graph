import { TaskGraphError } from './errors.js';
import { mutateTaskDocument } from './mutate.js';
import type { TaskDocument } from './task.js';

export interface ManualBlockerOptions {
  readonly id: string;
  readonly reason: string;
}

/**
 * Adds one manual blocker.
 *
 * Manual blockers record obstacles that cannot be derived from the DAG (for
 * example a missing approval). They are the only blocking state written to the
 * task Markdown; computed readiness and blocked_by never are.
 */
export function addManualBlocker(root: string, options: ManualBlockerOptions): TaskDocument {
  const reason = readReason(options.reason);
  return mutateTaskDocument(root, options.id, (current) => {
    if (current.manualBlockers.includes(reason)) {
      throw new TaskGraphError(
        'E_DUP_BLOCKER',
        `Task "${current.id}" is already blocked by "${reason}"`,
        [describeBlockers(current)],
      );
    }
    return { ...current, manualBlockers: [...current.manualBlockers, reason] };
  });
}

/** Removes exactly the given manual blocker text. */
export function removeManualBlocker(root: string, options: ManualBlockerOptions): TaskDocument {
  const reason = readReason(options.reason);
  return mutateTaskDocument(root, options.id, (current) => {
    const index = current.manualBlockers.indexOf(reason);
    if (index < 0) {
      throw new TaskGraphError(
        'E_NO_BLOCKER',
        `Task "${current.id}" is not blocked by "${reason}"`,
        [describeBlockers(current)],
      );
    }
    return {
      ...current,
      manualBlockers: current.manualBlockers.filter((_, position) => position !== index),
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
