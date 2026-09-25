import { TaskGraphError } from './errors.js';
import { historyEntry, type TaskClaim, type TaskDocument } from './task.js';
import { assertNotCancelled, mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';

/** History event names recorded by the claim commands. */
export const CLAIM_EVENTS = {
  claimed: 'claimed',
  released: 'released',
  reassigned: 'reassigned',
  takenOver: 'taken_over',
} as const;

export interface ClaimTaskOptions extends ClockOptions {
  readonly id: string;
  readonly role: string;
  readonly sessionId: string;
  /** Optional supplementary execution instance ID; NEVER replaces session_id. */
  readonly executionId?: string | undefined;
}

export interface ReleaseClaimOptions extends ClockOptions {
  readonly id: string;
  readonly reason?: string | undefined;
}

export interface ReassignClaimOptions extends ClaimTaskOptions {
  /**
   * `true` records an explicit takeover of an existing claim (and requires one);
   * `false` (default) is a controller reassignment and may assign an unclaimed task.
   */
  readonly takeover?: boolean | undefined;
  readonly reason?: string | undefined;
}

/**
 * Records a claim for a task.
 *
 * `role`, `session_id` and `claimed_at` are always stored together; an optional
 * `execution_id` is supplementary metadata and never stands in for the session.
 * An existing claim is never overwritten silently: use reassign or takeover.
 */
export function claimTask(root: string, options: ClaimTaskOptions): TaskDocument {
  const identity = readClaimIdentity(options);
  const at = timestampOf(options.now);

  return mutateTaskDocument(root, options.id, (current) => {
    assertNotCancelled(current);
    if (current.claim) {
      throw new TaskGraphError(
        'E_TASK_CLAIMED',
        `Task "${current.id}" is already claimed`,
        [
          `Current claim: ${formatClaim(current.claim)}`,
          'Use `task-graph task reassign` to hand it over, or `task-graph task release` first.',
        ],
      );
    }
    return withClaim(current, identity, at, CLAIM_EVENTS.claimed, options.actor ?? null, {
      previousClaim: null,
    });
  });
}

/**
 * Clears the current claim and records who released it.
 *
 * Release is always explicit: nothing in this module expires a claim by itself.
 */
export function releaseClaim(root: string, options: ReleaseClaimOptions): TaskDocument {
  const at = timestampOf(options.now);
  return mutateTaskDocument(root, options.id, (current) => {
    if (!current.claim) {
      throw new TaskGraphError('E_NO_CLAIM', `Task "${current.id}" has no claim to release`);
    }
    const previous = current.claim;
    return {
      ...current,
      claim: null,
      history: [
        ...current.history,
        historyEntry(CLAIM_EVENTS.released, at, options.actor ?? null, {
          role: previous.role,
          session_id: previous.sessionId,
          ...(previous.executionId === undefined ? {} : { execution_id: previous.executionId }),
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        }),
      ],
    };
  });
}

/**
 * Reassigns or takes over a task.
 *
 * Both paths record the previous and the new claim identities plus the actor and
 * timestamp, so responsibility history survives the handover.
 */
export function reassignClaim(root: string, options: ReassignClaimOptions): TaskDocument {
  const identity = readClaimIdentity(options);
  const at = timestampOf(options.now);
  const takeover = options.takeover === true;

  return mutateTaskDocument(root, options.id, (current) => {
    assertNotCancelled(current);
    if (takeover && !current.claim) {
      throw new TaskGraphError(
        'E_NO_CLAIM',
        `Task "${current.id}" has no claim to take over`,
        ['Use `task-graph task claim` or `task-graph task reassign` to assign it.'],
      );
    }
    return withClaim(
      current,
      identity,
      at,
      takeover ? CLAIM_EVENTS.takenOver : CLAIM_EVENTS.reassigned,
      options.actor ?? null,
      {
        previousClaim: current.claim,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      },
    );
  });
}

interface ClaimIdentity {
  readonly role: string;
  readonly sessionId: string;
  readonly executionId?: string | undefined;
}

function readClaimIdentity(options: ClaimTaskOptions): ClaimIdentity {
  const role = options.role?.trim() ?? '';
  if (role.length === 0) {
    throw new TaskGraphError('E_TASK_CLAIM', 'A claim needs a role', ['Pass --role <role>.']);
  }
  const sessionId = options.sessionId?.trim() ?? '';
  if (sessionId.length === 0) {
    throw new TaskGraphError('E_TASK_CLAIM', 'A claim needs a session ID', [
      'Pass --session-id <id>; an execution ID alone is not enough.',
    ]);
  }
  const executionId = options.executionId?.trim();
  return executionId === undefined || executionId.length === 0
    ? { role, sessionId }
    : { role, sessionId, executionId };
}

function withClaim(
  current: TaskDocument,
  identity: ClaimIdentity,
  at: string,
  event: string,
  actor: string | null,
  extraOptions: { previousClaim: TaskClaim | null; reason?: string | undefined },
): TaskDocument {
  const claim: TaskClaim =
    identity.executionId === undefined
      ? { role: identity.role, sessionId: identity.sessionId, claimedAt: at }
      : {
          role: identity.role,
          sessionId: identity.sessionId,
          claimedAt: at,
          executionId: identity.executionId,
        };
  const previous = extraOptions.previousClaim;
  return {
    ...current,
    claim,
    history: [
      ...current.history,
      historyEntry(event, at, actor, {
        from_role: previous ? previous.role : null,
        from_session_id: previous ? previous.sessionId : null,
        role: identity.role,
        session_id: identity.sessionId,
        ...(identity.executionId === undefined ? {} : { execution_id: identity.executionId }),
        ...(extraOptions.reason === undefined ? {} : { reason: extraOptions.reason }),
      }),
    ],
  };
}

/** `role / session_id` rendering used by messages and tests. */
export function formatClaim(claim: TaskClaim): string {
  const execution = claim.executionId === undefined ? '' : ` (execution ${claim.executionId})`;
  return `${claim.role} / ${claim.sessionId}${execution}`;
}
