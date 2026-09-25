import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { linkTask } from '../src/core/deps.js';
import { completeTask, startTask } from '../src/core/lifecycle.js';
import { addManualBlocker, removeManualBlocker } from '../src/core/blockers.js';
import { computeReadiness } from '../src/core/readiness.js';
import { buildProject } from '../src/core/build.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { readTaskDocument, writeTaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

function seed(workspace: TempWorkspace): void {
  initializeProject(workspace.root, { name: 'readiness', task: '根任务' });
}

interface ProjectedTask {
  id: string;
  readiness: string;
  blockedBy: unknown[];
  status: string;
}
function projectedTasks(workspace: TempWorkspace): ProjectedTask[] {
  const data = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    tasks: ProjectedTask[];
  };
  return data.tasks;
}

function readinessOf(
  workspace: TempWorkspace,
  id: string,
): { readiness: string; blockedBy: readonly unknown[] } {
  const computed = computeReadiness(loadTaskRepository(workspace.root)).get(id);
  assert.ok(computed, `${id} must have computed readiness`);
  return { readiness: computed.readiness, blockedBy: computed.blockedBy };
}

test('US-012: a todo task with satisfied dependencies is Ready', () => {
  const workspace = useTempWorkspace(test, 'us-012-ready');
  seed(workspace);
  const predecessor = addTask(workspace.root, { graph: 'G-001', title: '前置', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });
  linkTask(workspace.root, { successor: successor.id, predecessor: predecessor.id });

  assert.deepEqual(readinessOf(workspace, successor.id).blockedBy, [
    { kind: 'task', task: predecessor.id },
  ]);

  // A dependency is satisfied only when the predecessor is done.
  startTask(workspace.root, { id: predecessor.id, now: fixedClock() });
  assert.equal(readinessOf(workspace, successor.id).readiness, 'blocked');
  completeTask(workspace.root, { id: predecessor.id, now: fixedClock() });

  assert.deepEqual(readinessOf(workspace, successor.id), { readiness: 'ready', blockedBy: [] });
  assert.deepEqual(readinessOf(workspace, 'T-0001'), { readiness: 'ready', blockedBy: [] });
});

test('US-012: unsatisfied dependencies and manual blockers compute as Blocked', () => {
  const workspace = useTempWorkspace(test, 'us-012-blocked');
  seed(workspace);
  const predecessor = addTask(workspace.root, { graph: 'G-001', title: '前置', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });
  linkTask(workspace.root, { successor: successor.id, predecessor: predecessor.id });
  addManualBlocker(workspace.root, { id: successor.id, reason: '等待法务审批' });

  assert.deepEqual(readinessOf(workspace, successor.id), {
    readiness: 'blocked',
    blockedBy: [
      { kind: 'task', task: predecessor.id },
      { kind: 'manual', text: '等待法务审批' },
    ],
  });

  completeTask(workspace.root, {
    id: startTask(workspace.root, { id: predecessor.id, now: fixedClock() }).id,
    now: fixedClock(),
  });
  assert.deepEqual(readinessOf(workspace, successor.id).blockedBy, [
    { kind: 'manual', text: '等待法务审批' },
  ]);
});

test('US-012: a partial dependency is blocked by unmet completion point members', () => {
  const workspace = useTempWorkspace(test, 'us-012-gate');
  initializeProject(workspace.root, { name: 'gate', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '子图任务', now: fixedClock() });

  const composite = readTaskDocument(workspace.root, 'T-0001');
  writeTaskDocument(workspace.root, {
    ...composite,
    subgraph: {
      graph: child.graph.id,
      completionRequires: [inner.id],
      exposes: [{ name: 'api-ready', requires: [inner.id] }],
    },
  });

  const successor = addTask(workspace.root, { graph: 'G-001', title: '外层后继', now: fixedClock() });
  linkTask(workspace.root, {
    successor: successor.id,
    predecessor: 'T-0001',
    gate: 'api-ready',
  });

  assert.deepEqual(readinessOf(workspace, successor.id).blockedBy, [
    { kind: 'gate', task: 'T-0001', gate: 'api-ready', tasks: [inner.id] },
  ]);

  completeTask(workspace.root, {
    id: startTask(workspace.root, { id: inner.id, now: fixedClock() }).id,
    now: fixedClock(),
  });
  assert.deepEqual(readinessOf(workspace, successor.id), { readiness: 'ready', blockedBy: [] });
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-012: manual blockers can be added and removed by command', () => {
  const workspace = useTempWorkspace(test, 'us-012-blockers');
  seed(workspace);
  const task = addTask(workspace.root, { graph: 'G-001', title: '任务', now: fixedClock() });

  const blocked = addManualBlocker(workspace.root, { id: task.id, reason: '等待硬件到位' });
  assert.deepEqual(blocked.manualBlockers, ['等待硬件到位']);
  assert.equal(readinessOf(workspace, task.id).readiness, 'blocked');

  const beforeDuplicate = workspace.read(`.task-graph/tasks/${task.id}.md`);
  assert.throws(
    () => addManualBlocker(workspace.root, { id: task.id, reason: '等待硬件到位' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_BLOCKER',
  );
  assert.throws(
    () => addManualBlocker(workspace.root, { id: task.id, reason: '   ' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_BLOCKER',
  );
  assert.equal(workspace.read(`.task-graph/tasks/${task.id}.md`), beforeDuplicate);

  const unblocked = removeManualBlocker(workspace.root, { id: task.id, reason: '等待硬件到位' });
  assert.deepEqual(unblocked.manualBlockers, []);
  assert.equal(readinessOf(workspace, task.id).readiness, 'ready');

  const beforeMissing = workspace.read(`.task-graph/tasks/${task.id}.md`);
  assert.throws(
    () => removeManualBlocker(workspace.root, { id: task.id, reason: '并不存在' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_BLOCKER',
  );
  assert.equal(workspace.read(`.task-graph/tasks/${task.id}.md`), beforeMissing);
});

test('US-012: readiness and blocked_by never appear in task Markdown', () => {
  const workspace = useTempWorkspace(test, 'us-012-not-persisted');
  seed(workspace);
  const predecessor = addTask(workspace.root, { graph: 'G-001', title: '前置', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });
  linkTask(workspace.root, { successor: successor.id, predecessor: predecessor.id });
  addManualBlocker(workspace.root, { id: successor.id, reason: '等待审批' });

  const before = workspace.read(`.task-graph/tasks/${successor.id}.md`);
  buildProject(workspace.root);
  const after = workspace.read(`.task-graph/tasks/${successor.id}.md`);

  assert.equal(after, before, 'build must not rewrite the task document');
  assert.equal(after.includes('readiness'), false);
  assert.equal(after.includes('blocked_by'), false);
  assert.equal(after.includes('blockedBy'), false);
  assert.equal(after.includes('manual_blockers:\n  - 等待审批'), true);

  const projected = projectedTasks(workspace).find((entry) => entry.id === successor.id);
  assert.equal(projected?.readiness, 'blocked');
  assert.equal(projected?.blockedBy.length, 2);
});

test('US-012: a predecessor status change updates readiness on the next build', () => {
  const workspace = useTempWorkspace(test, 'us-012-recompute');
  seed(workspace);
  const predecessor = addTask(workspace.root, { graph: 'G-001', title: '前置', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });
  linkTask(workspace.root, { successor: successor.id, predecessor: predecessor.id });

  assert.equal(
    projectedTasks(workspace).find((entry) => entry.id === successor.id)?.readiness,
    'blocked',
  );

  startTask(workspace.root, { id: predecessor.id, now: fixedClock() });
  assert.equal(
    projectedTasks(workspace).find((entry) => entry.id === successor.id)?.readiness,
    'blocked',
  );

  completeTask(workspace.root, { id: predecessor.id, now: fixedClock() });
  assert.equal(
    projectedTasks(workspace).find((entry) => entry.id === successor.id)?.readiness,
    'ready',
  );

  // A direct body-only edit needs an explicit build to refresh generated data.
  const predecessorFile = `.task-graph/tasks/${predecessor.id}.md`;
  workspace.write(
    predecessorFile,
    workspace.read(predecessorFile).replace('status: done', 'status: todo'),
  );
  buildProject(workspace.root);
  assert.equal(
    projectedTasks(workspace).find((entry) => entry.id === successor.id)?.readiness,
    'blocked',
  );
});

test('US-012: task block and task unblock work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-012-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });

  const block = runCliProcess(['task', 'block', 'T-0001', '--reason', '等待预算'], {
    cwd: workspace.root,
  });
  assert.equal(block.code, 0, block.stderr);
  assert.match(block.stdout, /Blocked T-0001: 等待预算/);

  const duplicate = runCliProcess(['task', 'block', 'T-0001', '--reason', '等待预算'], {
    cwd: workspace.root,
  });
  assert.equal(duplicate.code, EXIT_FAILURE);
  assert.match(duplicate.stderr, /E_DUP_BLOCKER/);

  const missingReason = runCliProcess(['task', 'block', 'T-0001'], { cwd: workspace.root });
  assert.equal(missingReason.code, EXIT_USAGE);
  assert.match(missingReason.stderr, /blocker reason is required/);

  const unblock = runCliProcess(['task', 'unblock', 'T-0001', '--reason', '等待预算', '--json'], {
    cwd: workspace.root,
  });
  assert.equal(unblock.code, 0, unblock.stderr);
  const payload = JSON.parse(unblock.stdout) as { task: { manualBlockers: string[] } };
  assert.deepEqual(payload.task.manualBlockers, []);

  const unblockAgain = runCliProcess(['task', 'unblock', 'T-0001', '--reason', '等待预算'], {
    cwd: workspace.root,
  });
  assert.equal(unblockAgain.code, EXIT_FAILURE);
  assert.match(unblockAgain.stderr, /E_NO_BLOCKER/);
});
