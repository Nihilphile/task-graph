import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addTask } from '../src/core/taskops.js';
import {
  STATUS_TRANSITIONS,
  cancelTask,
  completeTask,
  reopenTask,
  startTask,
  transitionTask,
} from '../src/core/lifecycle.js';
import { loadTaskRepository } from '../src/core/repo.js';
import type { TaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const AT = '2026-09-21T10:00:00+08:00';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

function seed(workspace: TempWorkspace): TaskDocument {
  initializeProject(workspace.root, { name: 'lifecycle', task: '根任务' });
  return addTask(workspace.root, { graph: 'G-001', title: '交付登录', now: fixedClock() });
}

function statusOf(workspace: TempWorkspace, id: string): string | undefined {
  return loadTaskRepository(workspace.root).taskById(id)?.status;
}

function taskFile(workspace: TempWorkspace, id: string): string {
  return workspace.read(`.task-graph/tasks/${id}.md`);
}

test('US-009: todo -> in_progress -> done records actor and timestamp history', () => {
  const workspace = useTempWorkspace(test, 'us-009-happy-path');
  const created = seed(workspace);

  const started = startTask(workspace.root, { id: created.id, actor: 'agent-a', now: fixedClock() });
  assert.equal(started.status, 'in_progress');
  assert.deepEqual(started.history.at(-1), {
    event: 'started',
    at: AT,
    actor: 'agent-a',
    extra: { from: 'todo', to: 'in_progress' },
  });

  const completed = completeTask(workspace.root, {
    id: created.id,
    actor: 'agent-b',
    now: fixedClock(),
  });
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.history.at(-1), {
    event: 'completed',
    at: AT,
    actor: 'agent-b',
    extra: { from: 'in_progress', to: 'done' },
  });
  assert.deepEqual(
    completed.history.map((entry) => entry.event),
    ['created', 'started', 'completed'],
  );
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-009: todo and in_progress tasks can be cancelled with a reason', () => {
  const workspace = useTempWorkspace(test, 'us-009-cancel');
  const created = seed(workspace);

  const cancelledFromTodo = cancelTask(workspace.root, {
    id: created.id,
    reason: '需求取消',
    actor: 'human',
    now: fixedClock(),
  });
  assert.equal(cancelledFromTodo.status, 'cancelled');
  assert.deepEqual(cancelledFromTodo.history.at(-1), {
    event: 'cancelled',
    at: AT,
    actor: 'human',
    extra: { from: 'todo', to: 'cancelled', reason: '需求取消' },
  });

  const other = addTask(workspace.root, { graph: 'G-001', title: '运行中任务', now: fixedClock() });
  startTask(workspace.root, { id: other.id, now: fixedClock() });
  const cancelledFromRunning = cancelTask(workspace.root, { id: other.id, now: fixedClock() });
  assert.equal(cancelledFromRunning.status, 'cancelled');
  assert.equal(cancelledFromRunning.history.at(-1)!.extra['from'], 'in_progress');
});

test('US-009: cancelled is terminal and unsupported transitions change nothing', () => {
  const workspace = useTempWorkspace(test, 'us-009-terminal');
  const created = seed(workspace);
  cancelTask(workspace.root, { id: created.id, now: fixedClock() });
  const before = taskFile(workspace, created.id);

  for (const target of ['todo', 'in_progress', 'done', 'cancelled'] as const) {
    assert.throws(
      () => transitionTask(workspace.root, target, { id: created.id, now: fixedClock(), reopen: true }),
      (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
      `cancelled -> ${target} must be rejected`,
    );
  }
  assert.equal(taskFile(workspace, created.id), before);
  assert.equal(statusOf(workspace, created.id), 'cancelled');
  assert.equal(STATUS_TRANSITIONS.cancelled.length, 0);
});

test('US-009: unsupported transitions are rejected before any write', () => {
  const workspace = useTempWorkspace(test, 'us-009-rejects');
  const created = seed(workspace);

  // todo -> done skips running, in_progress -> todo goes backwards.
  const beforeTodo = taskFile(workspace, created.id);
  assert.throws(
    () => completeTask(workspace.root, { id: created.id, now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
  assert.equal(taskFile(workspace, created.id), beforeTodo);

  startTask(workspace.root, { id: created.id, now: fixedClock() });
  completeTask(workspace.root, { id: created.id, now: fixedClock() });

  // done -> cancelled is not a supported path; only an explicit reopen exists.
  const beforeDone = taskFile(workspace, created.id);
  assert.throws(
    () => cancelTask(workspace.root, { id: created.id, now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
  assert.throws(
    () => startTask(workspace.root, { id: created.id, now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
  assert.equal(taskFile(workspace, created.id), beforeDone);
  assert.equal(statusOf(workspace, created.id), 'done');

  // A repeated transition to the current status is refused as well.
  assert.throws(
    () => transitionTask(workspace.root, 'done', {
      id: created.id,
      now: fixedClock(),
      reopen: true,
    }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );

  assert.throws(
    () => startTask(workspace.root, { id: 'T-9999', now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_TASK',
  );
});

test('US-009: a done task is reopened only on an explicit request', () => {
  const workspace = useTempWorkspace(test, 'us-009-reopen');
  const created = seed(workspace);
  startTask(workspace.root, { id: created.id, now: fixedClock() });
  completeTask(workspace.root, { id: created.id, now: fixedClock() });

  assert.throws(
    () => startTask(workspace.root, { id: created.id, now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
  assert.equal(statusOf(workspace, created.id), 'done');

  const reopened = reopenTask(workspace.root, {
    id: created.id,
    reason: '验收失败',
    actor: 'human',
    now: fixedClock(),
  });
  assert.equal(reopened.status, 'in_progress');
  assert.deepEqual(reopened.history.at(-1), {
    event: 'reopened',
    at: AT,
    actor: 'human',
    extra: { from: 'done', to: 'in_progress', reason: '验收失败' },
  });

  // `startTask` with `reopen: true` is the same explicit path.
  completeTask(workspace.root, { id: created.id, now: fixedClock() });
  const again = startTask(workspace.root, { id: created.id, reopen: true, now: fixedClock() });
  assert.equal(again.status, 'in_progress');
  assert.equal(again.history.at(-1)!.event, 'reopened');
});

test('US-009: every successful lifecycle command rebuilds generated artifacts', () => {
  const workspace = useTempWorkspace(test, 'us-009-rebuild');
  const created = seed(workspace);

  const projectionStatus = (): string | undefined => {
    const data = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
      tasks: { id: string; status: string }[];
    };
    return data.tasks.find((task) => task.id === created.id)?.status;
  };

  assert.equal(projectionStatus(), 'todo');
  startTask(workspace.root, { id: created.id, now: fixedClock() });
  assert.equal(projectionStatus(), 'in_progress');
  completeTask(workspace.root, { id: created.id, now: fixedClock() });
  assert.equal(projectionStatus(), 'done');
  reopenTask(workspace.root, { id: created.id, now: fixedClock() });
  assert.equal(projectionStatus(), 'in_progress');
  cancelTask(workspace.root, { id: created.id, now: fixedClock() });
  assert.equal(projectionStatus(), 'cancelled');
});

test('US-009: the lifecycle commands work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-009-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });

  const start = runCliProcess(['task', 'start', 'T-0001', '--actor', 'agent'], {
    cwd: workspace.root,
  });
  assert.equal(start.code, 0, start.stderr);
  assert.match(start.stdout, /Started T-0001 \(in_progress\): 根任务/);

  const prematureComplete = runCliProcess(['task', 'complete', 'T-0002'], { cwd: workspace.root });
  assert.equal(prematureComplete.code, EXIT_FAILURE);
  assert.match(prematureComplete.stderr, /E_NO_TASK|not found/);

  const complete = runCliProcess(['task', 'complete', 'T-0001', '--json'], {
    cwd: workspace.root,
  });
  assert.equal(complete.code, 0, complete.stderr);
  const payload = JSON.parse(complete.stdout) as { ok: boolean; task: { status: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.task.status, 'done');

  const blockedReopen = runCliProcess(['task', 'start', 'T-0001'], { cwd: workspace.root });
  assert.equal(blockedReopen.code, EXIT_FAILURE);
  assert.match(blockedReopen.stderr, /reopening is explicit/);

  const reopen = runCliProcess(['task', 'reopen', 'T-0001', '--reason', '返工'], {
    cwd: workspace.root,
  });
  assert.equal(reopen.code, 0, reopen.stderr);
  assert.match(reopen.stdout, /Reopened T-0001 \(in_progress\)/);

  const cancel = runCliProcess(['task', 'cancel', 'T-0001', '--reason', '不再需要'], {
    cwd: workspace.root,
  });
  assert.equal(cancel.code, 0, cancel.stderr);
  assert.match(cancel.stdout, /Cancelled T-0001 \(cancelled\)/);

  const afterCancel = runCliProcess(['task', 'start', 'T-0001'], { cwd: workspace.root });
  assert.equal(afterCancel.code, EXIT_FAILURE);
  assert.match(afterCancel.stderr, /E_TASK_TRANSITION/);

  const usage = runCliProcess(['task', 'start'], { cwd: workspace.root });
  assert.equal(usage.code, EXIT_USAGE);
  assert.match(usage.stderr, /task ID is required/);

  assert.deepEqual(validateRepository(workspace.root).issues, []);
  assert.equal(statusOf(workspace, 'T-0001'), 'cancelled');
});
