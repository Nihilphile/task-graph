import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addTask } from '../src/core/taskops.js';
import { cancelTask } from '../src/core/lifecycle.js';
import { claimTask, reassignClaim, releaseClaim } from '../src/core/claims.js';
import { buildProject } from '../src/core/build.js';
import { loadTaskRepository } from '../src/core/repo.js';
import type { TaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const AT = '2026-09-21T10:00:00+08:00';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

function seed(workspace: TempWorkspace): TaskDocument {
  initializeProject(workspace.root, { name: 'claims', task: '根任务' });
  return addTask(workspace.root, { graph: 'G-001', title: '交付登录', now: fixedClock() });
}

function taskFile(workspace: TempWorkspace, id: string): string {
  return workspace.read(`.task-graph/tasks/${id}.md`);
}

function reload(workspace: TempWorkspace, id: string): TaskDocument {
  const task = loadTaskRepository(workspace.root).taskById(id);
  assert.ok(task, `${id} must exist`);
  return task;
}

test('US-010: a claim records role, session_id and claimed_at', () => {
  const workspace = useTempWorkspace(test, 'us-010-claim');
  const created = seed(workspace);

  const claimed = claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-abc123',
    actor: 'controller',
    now: fixedClock(),
  });

  assert.deepEqual(claimed.claim, {
    role: 'implementer',
    sessionId: 'thread-abc123',
    claimedAt: AT,
  });
  assert.deepEqual(claimed.history.at(-1), {
    event: 'claimed',
    at: AT,
    actor: 'controller',
    extra: {
      from_role: null,
      from_session_id: null,
      role: 'implementer',
      session_id: 'thread-abc123',
    },
  });
  assert.equal(claimed.status, 'todo');
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-010: an execution ID is optional supplementary metadata only', () => {
  const workspace = useTempWorkspace(test, 'us-010-execution-id');
  const created = seed(workspace);

  const claimed = claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-abc123',
    executionId: 'run-42',
    now: fixedClock(),
  });
  assert.deepEqual(claimed.claim, {
    role: 'implementer',
    sessionId: 'thread-abc123',
    claimedAt: AT,
    executionId: 'run-42',
  });
  assert.equal(claimed.history.at(-1)!.extra['execution_id'], 'run-42');
  assert.equal(claimed.history.at(-1)!.extra['session_id'], 'thread-abc123');

  // Session identity stays mandatory: an execution ID never replaces it.
  const other = addTask(workspace.root, { graph: 'G-001', title: '另一个任务', now: fixedClock() });
  const before = taskFile(workspace, other.id);
  assert.throws(
    () =>
      claimTask(workspace.root, {
        id: other.id,
        role: 'implementer',
        sessionId: '   ',
        executionId: 'run-99',
        now: fixedClock(),
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_CLAIM',
  );
  assert.throws(
    () => claimTask(workspace.root, { id: other.id, role: '', sessionId: 's', now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_CLAIM',
  );
  assert.equal(taskFile(workspace, other.id), before);
});

test('US-010: a fresh claim never silently overwrites an existing one', () => {
  const workspace = useTempWorkspace(test, 'us-010-no-silent-replace');
  const created = seed(workspace);
  claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-1',
    now: fixedClock(),
  });
  const before = taskFile(workspace, created.id);

  assert.throws(
    () =>
      claimTask(workspace.root, {
        id: created.id,
        role: 'implementer',
        sessionId: 'thread-2',
        now: fixedClock(),
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_CLAIMED',
  );
  assert.equal(taskFile(workspace, created.id), before);
  assert.equal(reload(workspace, created.id).claim?.sessionId, 'thread-1');
});

test('US-010: release clears the claim and records who released it', () => {
  const workspace = useTempWorkspace(test, 'us-010-release');
  const created = seed(workspace);
  claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-1',
    executionId: 'run-1',
    now: fixedClock(),
  });

  const released = releaseClaim(workspace.root, {
    id: created.id,
    reason: '会话结束',
    actor: 'controller',
    now: fixedClock(),
  });
  assert.equal(released.claim, null);
  assert.deepEqual(released.history.at(-1), {
    event: 'released',
    at: AT,
    actor: 'controller',
    extra: {
      role: 'implementer',
      session_id: 'thread-1',
      execution_id: 'run-1',
      reason: '会话结束',
    },
  });

  const before = taskFile(workspace, created.id);
  assert.throws(
    () => releaseClaim(workspace.root, { id: created.id, now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_CLAIM',
  );
  assert.equal(taskFile(workspace, created.id), before);
});

test('US-010: reassignment and takeover record old and new identities', () => {
  const workspace = useTempWorkspace(test, 'us-010-reassign');
  const created = seed(workspace);

  // A controller may assign an unclaimed task; the previous identity is null.
  const assigned = reassignClaim(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-1',
    actor: 'controller',
    now: fixedClock(),
  });
  assert.deepEqual(assigned.history.at(-1), {
    event: 'reassigned',
    at: AT,
    actor: 'controller',
    extra: {
      from_role: null,
      from_session_id: null,
      role: 'implementer',
      session_id: 'thread-1',
    },
  });

  // Taking over requires an existing claim and keeps both identities.
  const takenOver = reassignClaim(workspace.root, {
    id: created.id,
    role: 'reviewer',
    sessionId: 'thread-2',
    takeover: true,
    reason: '原负责人不可用',
    actor: 'controller',
    now: fixedClock(),
  });
  assert.deepEqual(takenOver.claim, {
    role: 'reviewer',
    sessionId: 'thread-2',
    claimedAt: AT,
  });
  assert.deepEqual(takenOver.history.at(-1), {
    event: 'taken_over',
    at: AT,
    actor: 'controller',
    extra: {
      from_role: 'implementer',
      from_session_id: 'thread-1',
      role: 'reviewer',
      session_id: 'thread-2',
      reason: '原负责人不可用',
    },
  });

  const other = addTask(workspace.root, { graph: 'G-001', title: '未领取任务', now: fixedClock() });
  const before = taskFile(workspace, other.id);
  assert.throws(
    () =>
      reassignClaim(workspace.root, {
        id: other.id,
        role: 'reviewer',
        sessionId: 'thread-3',
        takeover: true,
        now: fixedClock(),
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_CLAIM',
  );
  assert.equal(taskFile(workspace, other.id), before);
});

test('US-010: nothing expires or releases a claim automatically', () => {
  const workspace = useTempWorkspace(test, 'us-010-no-expiry');
  const created = seed(workspace);
  const longAgo = (): Date => new Date('2000-01-01T00:00:00+08:00');
  claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-old',
    now: longAgo,
  });

  const claimedAt = reload(workspace, created.id).claim?.claimedAt;
  assert.equal(claimedAt, '2000-01-01T00:00:00+08:00');

  // Validation, an unrelated claim, a build and a status change must all leave
  // the ancient claim untouched.
  assert.deepEqual(validateRepository(workspace.root).issues, []);
  const other = addTask(workspace.root, { graph: 'G-001', title: '另一个任务', now: fixedClock() });
  claimTask(workspace.root, {
    id: other.id,
    role: 'implementer',
    sessionId: 'thread-new',
    now: fixedClock(),
  });
  buildProject(workspace.root);

  const after = reload(workspace, created.id);
  assert.equal(after.claim?.sessionId, 'thread-old');
  assert.equal(after.claim?.claimedAt, '2000-01-01T00:00:00+08:00');
  assert.equal(after.history.filter((entry) => entry.event === 'released').length, 0);

  // A cancelled task accepts a release (responsibility ends) but no new claim.
  cancelTask(workspace.root, { id: other.id, now: fixedClock() });
  assert.throws(
    () =>
      claimTask(workspace.root, {
        id: other.id,
        role: 'implementer',
        sessionId: 'thread-3',
        now: fixedClock(),
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
  const released = releaseClaim(workspace.root, { id: other.id, now: fixedClock() });
  assert.equal(released.claim, null);
  assert.equal(released.status, 'cancelled');
});

test('US-010: every successful claim command rebuilds generated artifacts', () => {
  const workspace = useTempWorkspace(test, 'us-010-rebuild');
  const created = seed(workspace);

  const projectionClaim = (): { role: string; sessionId: string; claimedAt: string } | null | undefined => {
    const data = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
      tasks: { id: string; claim: { role: string; sessionId: string; claimedAt: string } | null }[];
    };
    return data.tasks.find((task) => task.id === created.id)?.claim;
  };

  assert.equal(projectionClaim(), null);
  claimTask(workspace.root, {
    id: created.id,
    role: 'implementer',
    sessionId: 'thread-1',
    now: fixedClock(),
  });
  assert.deepEqual(projectionClaim(), {
    role: 'implementer',
    sessionId: 'thread-1',
    claimedAt: AT,
  });

  reassignClaim(workspace.root, {
    id: created.id,
    role: 'reviewer',
    sessionId: 'thread-2',
    takeover: true,
    now: fixedClock(),
  });
  assert.deepEqual(projectionClaim(), {
    role: 'reviewer',
    sessionId: 'thread-2',
    claimedAt: AT,
  });

  releaseClaim(workspace.root, { id: created.id, now: fixedClock() });
  assert.equal(projectionClaim(), null);
});

test('US-010: the claim commands work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-010-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });

  const claim = runCliProcess(
    [
      'task',
      'claim',
      'T-0001',
      '--role',
      'implementer',
      '--session-id',
      'thread-1',
      '--execution-id',
      'run-7',
      '--actor',
      'controller',
    ],
    { cwd: workspace.root },
  );
  assert.equal(claim.code, 0, claim.stderr);
  assert.match(claim.stdout, /Claimed T-0001 for implementer \/ thread-1 \(execution run-7\)/);

  const duplicate = runCliProcess(
    ['task', 'claim', 'T-0001', '--role', 'implementer', '--session-id', 'thread-2'],
    { cwd: workspace.root },
  );
  assert.equal(duplicate.code, EXIT_FAILURE);
  assert.match(duplicate.stderr, /E_TASK_CLAIMED/);

  const takeover = runCliProcess(
    [
      'task',
      'reassign',
      'T-0001',
      '--role',
      'reviewer',
      '--session-id',
      'thread-2',
      '--takeover',
      '--json',
    ],
    { cwd: workspace.root },
  );
  assert.equal(takeover.code, 0, takeover.stderr);
  const payload = JSON.parse(takeover.stdout) as { task: { claim: { role: string } } };
  assert.equal(payload.task.claim.role, 'reviewer');

  const release = runCliProcess(['task', 'release', 'T-0001', '--actor', 'controller'], {
    cwd: workspace.root,
  });
  assert.equal(release.code, 0, release.stderr);
  assert.match(release.stdout, /Released T-0001/);

  const releaseAgain = runCliProcess(['task', 'release', 'T-0001'], { cwd: workspace.root });
  assert.equal(releaseAgain.code, EXIT_FAILURE);
  assert.match(releaseAgain.stderr, /E_NO_CLAIM/);

  const missingRole = runCliProcess(
    ['task', 'claim', 'T-0001', '--session-id', 'thread-9'],
    { cwd: workspace.root },
  );
  assert.equal(missingRole.code, EXIT_FAILURE);
  assert.match(missingRole.stderr, /claim needs a role/);

  const missingId = runCliProcess(['task', 'claim', '--role', 'r', '--session-id', 's'], {
    cwd: workspace.root,
  });
  assert.equal(missingId.code, EXIT_USAGE);
  assert.match(missingId.stderr, /task ID is required/);

  assert.equal(reload(workspace, 'T-0001').claim, null);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});
