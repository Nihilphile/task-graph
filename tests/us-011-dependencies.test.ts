import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { linkTask, unlinkTask } from '../src/core/deps.js';
import { exposeCompletionPoint } from '../src/core/composites.js';
import { findDependencyCycle } from '../src/core/dag.js';
import { buildProject } from '../src/core/build.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

/** Every file below the project root, base64-encoded so bytes are compared. */
function snapshotTree(workspace: TempWorkspace): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const file of workspace.listFiles()) {
    snapshot[file] = workspace.readBuffer(file).toString('base64');
  }
  return snapshot;
}

function assertTreeUnchanged(
  workspace: TempWorkspace,
  before: Record<string, string>,
  label: string,
): void {
  assert.deepEqual(snapshotTree(workspace), before, `${label} must leave every file unchanged`);
}

function seed(workspace: TempWorkspace): void {
  initializeProject(workspace.root, { name: 'deps', task: '根任务' });
}

function taskFile(workspace: TempWorkspace, id: string): string {
  return workspace.read(`.task-graph/tasks/${id}.md`);
}

test('US-011: task link stores the full dependency only in the successor', () => {
  const workspace = useTempWorkspace(test, 'us-011-link');
  seed(workspace);
  const predecessor = addTask(workspace.root, { graph: 'G-001', title: '前置', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });
  const predecessorBefore = taskFile(workspace, predecessor.id);

  const linked = linkTask(workspace.root, {
    successor: successor.id,
    predecessor: predecessor.id,
  });

  assert.deepEqual(linked.dependsOn, [{ task: predecessor.id, mode: 'full' }]);
  assert.equal(taskFile(workspace, predecessor.id), predecessorBefore);
  assert.equal(taskFile(workspace, successor.id).includes(`- task: ${predecessor.id}`), true);
  assert.equal(
    taskFile(workspace, predecessor.id).includes('depends_on:\n  - task:'),
    false,
  );
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  const projection = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    relationships: { full: { from: string; to: string }[] };
  };
  assert.deepEqual(projection.relationships.full, [
    { from: predecessor.id, to: successor.id },
  ]);
});

test('US-011: rejected links never write a byte', () => {
  const workspace = useTempWorkspace(test, 'us-011-rejects');
  seed(workspace);
  const first = addTask(workspace.root, { graph: 'G-001', title: '任务一', now: fixedClock() });
  const second = addTask(workspace.root, { graph: 'G-001', title: '任务二', now: fixedClock() });

  const beforeMissing = snapshotTree(workspace);
  assert.throws(
    () => linkTask(workspace.root, { successor: second.id, predecessor: 'T-9999' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_TASK_REF',
  );
  assert.throws(
    () => linkTask(workspace.root, { successor: 'T-9999', predecessor: first.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_TASK',
  );
  assert.throws(
    () => linkTask(workspace.root, { successor: first.id, predecessor: first.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_SELF_DEP',
  );
  assert.throws(
    () =>
      linkTask(workspace.root, {
        successor: second.id,
        predecessor: first.id,
        mode: 'full',
        gate: 'x',
      }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_TASK_DEP' && /no completion point/.test(error.message),
  );
  assert.throws(
    () => linkTask(workspace.root, { successor: second.id, predecessor: first.id, mode: 'partial' }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_TASK_DEP' && /needs a completion point/.test(error.message),
  );
  assertTreeUnchanged(workspace, beforeMissing, 'an invalid link');

  linkTask(workspace.root, { successor: second.id, predecessor: first.id });
  const beforeDuplicate = snapshotTree(workspace);
  assert.throws(
    () => linkTask(workspace.root, { successor: second.id, predecessor: first.id }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_TASK_DEP' && /already depends on/.test(error.message),
  );
  assertTreeUnchanged(workspace, beforeDuplicate, 'a duplicate link');
  assert.deepEqual(loadTaskRepository(workspace.root).taskById(second.id)?.dependsOn, [
    { task: first.id, mode: 'full' },
  ]);
});

test('US-011: cross-entry-graph and cross-layer dependencies are rejected', () => {
  const workspace = useTempWorkspace(test, 'us-011-cross-graph');
  seed(workspace);
  const other = addGraph(workspace.root, { title: '第二张入口图', entry: true });
  const inOther = addTask(workspace.root, {
    graph: other.graph.id,
    title: '另一张图的任务',
    now: fixedClock(),
  });
  const inFirst = addTask(workspace.root, { graph: 'G-001', title: '入口图任务', now: fixedClock() });

  const beforeCross = snapshotTree(workspace);
  assert.throws(
    () => linkTask(workspace.root, { successor: inFirst.id, predecessor: inOther.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_CROSS_ENTRY_DEP',
  );
  assertTreeUnchanged(workspace, beforeCross, 'a cross-entry-graph link');

  // A nested graph is a different layer: only the composite task or a named
  // completion point may be referenced from the outer graph.
  const nested = useTempWorkspace(test, 'us-011-cross-layer');
  initializeProject(nested.root, { name: 'layer', task: '复合任务' });
  const child = addGraph(nested.root, { title: '子图', parentTask: 'T-0001' });
  const childTask = addTask(nested.root, {
    graph: child.graph.id,
    title: '子图任务',
    now: fixedClock(),
  });
  const outerTask = addTask(nested.root, { graph: 'G-001', title: '外层任务', now: fixedClock() });

  const beforeLayer = snapshotTree(nested);
  assert.throws(
    () => linkTask(nested.root, { successor: outerTask.id, predecessor: childTask.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_CROSS_LAYER_DEP',
  );
  assertTreeUnchanged(nested, beforeLayer, 'a cross-layer link');
});

test('US-011: a cycle is detected before writing and reports the full path', () => {
  const workspace = useTempWorkspace(test, 'us-011-cycle');
  seed(workspace);
  const a = 'T-0001';
  const b = addTask(workspace.root, { graph: 'G-001', title: '任务 B', now: fixedClock() }).id;
  const c = addTask(workspace.root, { graph: 'G-001', title: '任务 C', now: fixedClock() }).id;
  linkTask(workspace.root, { successor: b, predecessor: a });
  linkTask(workspace.root, { successor: c, predecessor: b });

  const beforeCycle = snapshotTree(workspace);
  assert.throws(
    () => linkTask(workspace.root, { successor: a, predecessor: c }),
    (error: unknown) => {
      assert.ok(error instanceof TaskGraphError);
      assert.equal(error.code, 'E_DEP_CYCLE');
      assert.match(error.message, /would create a dependency cycle/);
      assert.deepEqual(error.details, [`Cycle path: ${a} -> ${c} -> ${b} -> ${a}`]);
      return true;
    },
  );
  assertTreeUnchanged(workspace, beforeCycle, 'a cyclic link');
  assert.deepEqual(loadTaskRepository(workspace.root).taskById(a)?.dependsOn, []);

  // The pure helper reports the same complete path.
  assert.deepEqual(
    findDependencyCycle([
      { id: a, dependsOn: [{ task: c }] },
      { id: b, dependsOn: [{ task: a }] },
      { id: c, dependsOn: [{ task: b }] },
    ]),
    [a, c, b, a],
  );
  assert.equal(findDependencyCycle([{ id: a, dependsOn: [] }]), undefined);
});

test('US-011: a hand-written cycle fails validation and build with E_CYCLE', () => {
  const workspace = useTempWorkspace(test, 'us-011-manual-cycle');
  seed(workspace);
  const b = addTask(workspace.root, { graph: 'G-001', title: '任务 B', now: fixedClock() }).id;

  // Rewrite both documents so each one depends on the other.
  for (const id of ['T-0001', b]) {
    const text = taskFile(workspace, id);
    const other = id === 'T-0001' ? b : 'T-0001';
    workspace.write(
      `.task-graph/tasks/${id}.md`,
      text.replace('depends_on: []', `depends_on:\n  - task: ${other}\n    mode: full`),
    );
  }

  const report = validateRepository(workspace.root);
  const cycleIssues = report.issues.filter((issue) => issue.code === 'E_CYCLE');
  assert.equal(cycleIssues.length, 1);
  assert.match(cycleIssues[0]!.message, /dependency cycle: T-0001 -> T-\d+ -> T-0001/);
  assert.equal(report.ok, false);

  const generatedBefore = workspace.read('.task-graph/generated/graph.json');
  assert.throws(
    () => buildProject(workspace.root),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_VALIDATE',
  );
  assert.equal(workspace.read('.task-graph/generated/graph.json'), generatedBefore);
});

test('US-011: task unlink removes the selected dependency only', () => {
  const workspace = useTempWorkspace(test, 'us-011-unlink');
  initializeProject(workspace.root, { name: 'unlink', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '子图任务', now: fixedClock() });
  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [inner.id],
  });
  const first = addTask(workspace.root, { graph: 'G-001', title: '前置一', now: fixedClock() });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '后继', now: fixedClock() });

  linkTask(workspace.root, { successor: successor.id, predecessor: first.id });
  linkTask(workspace.root, {
    successor: successor.id,
    predecessor: 'T-0001',
    gate: 'api-ready',
  });
  assert.deepEqual(loadTaskRepository(workspace.root).taskById(successor.id)?.dependsOn, [
    { task: first.id, mode: 'full' },
    { task: 'T-0001', mode: 'partial', gate: 'api-ready' },
  ]);
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  const unlinked = unlinkTask(workspace.root, {
    successor: successor.id,
    predecessor: first.id,
  });
  assert.deepEqual(unlinked.dependsOn, [
    { task: 'T-0001', mode: 'partial', gate: 'api-ready' },
  ]);

  const partialRemoved = unlinkTask(workspace.root, {
    successor: successor.id,
    predecessor: 'T-0001',
    gate: 'api-ready',
  });
  assert.deepEqual(partialRemoved.dependsOn, []);

  // Removing something that is not stored fails and writes nothing.
  const before = snapshotTree(workspace);
  assert.throws(
    () => unlinkTask(workspace.root, { successor: successor.id, predecessor: first.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_DEP',
  );
  assert.throws(
    () =>
      unlinkTask(workspace.root, {
        successor: successor.id,
        predecessor: 'T-0001',
        gate: 'nope',
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_DEP',
  );
  assertTreeUnchanged(workspace, before, 'an unlink of a missing dependency');
});

test('US-011: task link and task unlink work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-011-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });
  runCliProcess(['task', 'add', '--graph', 'G-001', '--title', '后继'], { cwd: workspace.root });

  const link = runCliProcess(
    ['task', 'link', 'T-0002', '--depends-on', 'T-0001', '--json', '--detail'],
    { cwd: workspace.root },
  );
  assert.equal(link.code, 0, link.stderr);
  const payload = JSON.parse(link.stdout) as {
    task: { id: string; dependsOn: { task: string; mode: string }[] };
  };
  assert.deepEqual(payload.task.dependsOn, [{ task: 'T-0001', mode: 'full' }]);

  const cycle = runCliProcess(['task', 'link', 'T-0001', '--depends-on', 'T-0002'], {
    cwd: workspace.root,
  });
  assert.equal(cycle.code, EXIT_FAILURE);
  assert.match(cycle.stderr, /E_DEP_CYCLE/);
  assert.match(cycle.stderr, /Cycle path: T-0001 -> T-0002 -> T-0001/);

  const noPredecessor = runCliProcess(['task', 'link', 'T-0002'], { cwd: workspace.root });
  assert.equal(noPredecessor.code, EXIT_USAGE);
  assert.match(noPredecessor.stderr, /predecessor task ID is required/);

  const missingId = runCliProcess(['task', 'unlink', '--depends-on', 'T-0001'], {
    cwd: workspace.root,
  });
  assert.equal(missingId.code, EXIT_USAGE);
  assert.match(missingId.stderr, /task ID is required/);

  const unlink = runCliProcess(['task', 'unlink', 'T-0002', '--depends-on', 'T-0001'], {
    cwd: workspace.root,
  });
  assert.equal(unlink.code, 0, unlink.stderr);
  assert.match(unlink.stdout, /id: T-0002[\s\S]*action: removed[\s\S]*task: T-0001/);
  assert.deepEqual(loadTaskRepository(workspace.root).taskById('T-0002')?.dependsOn, []);

  const unlinkAgain = runCliProcess(['task', 'unlink', 'T-0002', '--depends-on', 'T-0001'], {
    cwd: workspace.root,
  });
  assert.equal(unlinkAgain.code, EXIT_FAILURE);
  assert.match(unlinkAgain.stderr, /E_NO_DEP/);
});
