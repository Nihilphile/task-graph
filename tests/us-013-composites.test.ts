import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { attachSubgraph, setCompletionRequires } from '../src/core/composites.js';
import { completeTask, startTask } from '../src/core/lifecycle.js';
import { claimTask, releaseClaim } from '../src/core/claims.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { readProjectManifest, serializeProjectManifest } from '../src/core/project.js';
import { readTaskDocument, writeTaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

/** Removes a composite task subgraph directly, leaving the graph unparented. */
function detachSource(workspace: TempWorkspace, taskId: string): void {
  const document = readTaskDocument(workspace.root, taskId);
  writeTaskDocument(workspace.root, { ...document, subgraph: null });
}

/** Registers an extra graph directly in project.yaml without a parent. */
function registerOrphanGraph(workspace: TempWorkspace, id: string, title: string): void {
  const manifest = readProjectManifest(workspace.root);
  workspace.write(
    '.task-graph/project.yaml',
    serializeProjectManifest({
      ...manifest,
      graphs: [...manifest.graphs, { id, title }],
    }),
  );
}

function taskFile(workspace: TempWorkspace, id: string): string {
  return workspace.read(`.task-graph/tasks/${id}.md`);
}

test('US-013: a composite task stores completion_requires from its child graph', () => {
  const workspace = useTempWorkspace(test, 'us-013-completion');
  initializeProject(workspace.root, { name: 'composite', task: '交付登录能力' });
  const child = addGraph(workspace.root, { title: '登录子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '实现接口', now: fixedClock() });
  const inner2 = addTask(workspace.root, { graph: child.graph.id, title: '补齐测试', now: fixedClock() });

  const composite = setCompletionRequires(workspace.root, {
    task: 'T-0001',
    requires: [inner.id, inner2.id],
  });
  assert.deepEqual(composite.subgraph, {
    graph: child.graph.id,
    completionRequires: [inner.id, inner2.id],
    exposes: [],
  });
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  // Only the composite task file changed.
  assert.ok(taskFile(workspace, 'T-0001').includes(`- ${inner.id}`));
  assert.equal(loadTaskRepository(workspace.root).taskById(inner.id)?.subgraph, null);
});

test('US-013: a registered non-entry graph can be attached to a composite task', () => {
  const workspace = useTempWorkspace(test, 'us-013-attach');
  initializeProject(workspace.root, { name: 'attach', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '子图任务', now: fixedClock() });

  // Detach the source edge so the graph is registered but unparented, then
  // attach it with a full completion contract.
  detachSource(workspace, 'T-0001');
  assert.equal(
    validateRepository(workspace.root).issues.some((issue) => issue.code === 'E_SUBGRAPH_ORPHAN'),
    true,
  );

  const attached = attachSubgraph(workspace.root, {
    task: 'T-0001',
    graph: child.graph.id,
    completionRequires: [inner.id],
  });
  assert.deepEqual(attached.subgraph?.completionRequires, [inner.id]);
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  // A second attach of the same graph is allowed and keeps the existing contract.
  const again = attachSubgraph(workspace.root, { task: 'T-0001', graph: child.graph.id });
  assert.deepEqual(again.subgraph?.completionRequires, [inner.id]);
});

test('US-013: attaching refuses entry graphs, unknown graphs and a second parent', () => {
  const workspace = useTempWorkspace(test, 'us-013-attach-rejects');
  initializeProject(workspace.root, { name: 'attach-rejects', task: '复合任务' });
  const other = addGraph(workspace.root, { title: '第二张入口图', entry: true });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const second = addTask(workspace.root, { graph: 'G-001', title: '另一个任务', now: fixedClock() });

  assert.throws(
    () => attachSubgraph(workspace.root, { task: second.id, graph: other.graph.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_ENTRY_IS_SUBGRAPH',
  );
  assert.throws(
    () => attachSubgraph(workspace.root, { task: second.id, graph: 'G-404' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_GRAPH_REF',
  );
  assert.throws(
    () => attachSubgraph(workspace.root, { task: second.id, graph: child.graph.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SUBGRAPH_MULTI_PARENT',
  );

  // A task that already enters one child graph cannot enter another.
  registerOrphanGraph(workspace, 'G-004', '第四张图');
  assert.throws(
    () => attachSubgraph(workspace.root, { task: 'T-0001', graph: 'G-004' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_SUBGRAPH',
  );
  assert.throws(
    () => setCompletionRequires(workspace.root, { task: second.id, requires: ['T-0001'] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_SUBGRAPH',
  );
});

test('US-013: completion targets outside the child graph are rejected', () => {
  const workspace = useTempWorkspace(test, 'us-013-targets');
  initializeProject(workspace.root, { name: 'targets', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '子图任务', now: fixedClock() });
  const outer = addTask(workspace.root, { graph: 'G-001', title: '外层任务', now: fixedClock() });

  const before = taskFile(workspace, 'T-0001');
  assert.throws(
    () =>
      setCompletionRequires(workspace.root, { task: 'T-0001', requires: [outer.id] }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_COMPLETION_OUTSIDE_SUBGRAPH',
  );
  assert.throws(
    () => setCompletionRequires(workspace.root, { task: 'T-0001', requires: ['T-9999'] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_TASK_REF',
  );
  assert.throws(
    () => setCompletionRequires(workspace.root, { task: 'T-0001', requires: [inner.id, inner.id] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_COMPLETION',
  );
  assert.throws(
    () =>
      attachSubgraph(workspace.root, {
        task: 'T-0001',
        graph: child.graph.id,
        completionRequires: [outer.id],
      }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_COMPLETION_OUTSIDE_SUBGRAPH',
  );
  assert.equal(taskFile(workspace, 'T-0001'), before);
});

test('US-013: a composite task cannot be completed before its targets are done', () => {
  const workspace = useTempWorkspace(test, 'us-013-gating');
  initializeProject(workspace.root, { name: 'gating', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const first = addTask(workspace.root, { graph: child.graph.id, title: '子任务一', now: fixedClock() });
  const second = addTask(workspace.root, { graph: child.graph.id, title: '子任务二', now: fixedClock() });
  setCompletionRequires(workspace.root, { task: 'T-0001', requires: [first.id, second.id] });

  startTask(workspace.root, { id: 'T-0001', now: fixedClock() });
  const before = taskFile(workspace, 'T-0001');
  assert.throws(
    () => completeTask(workspace.root, { id: 'T-0001', now: fixedClock() }),
    (error: unknown) => {
      assert.ok(error instanceof TaskGraphError);
      assert.equal(error.code, 'E_COMPLETION_INCOMPLETE');
      assert.deepEqual(error.details, [`Unfinished completion targets: ${first.id}, ${second.id}`]);
      return true;
    },
  );
  assert.equal(taskFile(workspace, 'T-0001'), before);
  assert.equal(loadTaskRepository(workspace.root).taskById('T-0001')?.status, 'in_progress');

  // One target alone is not enough.
  completeTask(workspace.root, {
    id: startTask(workspace.root, { id: first.id, now: fixedClock() }).id,
    now: fixedClock(),
  });
  assert.throws(
    () => completeTask(workspace.root, { id: 'T-0001', now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_COMPLETION_INCOMPLETE',
  );

  completeTask(workspace.root, {
    id: startTask(workspace.root, { id: second.id, now: fixedClock() }).id,
    now: fixedClock(),
  });
  const completed = completeTask(workspace.root, { id: 'T-0001', now: fixedClock() });
  assert.equal(completed.status, 'done');
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-013: an attached graph without completion targets cannot be completed', () => {
  const workspace = useTempWorkspace(test, 'us-013-no-targets');
  initializeProject(workspace.root, { name: 'no-targets', task: '复合任务' });
  addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  startTask(workspace.root, { id: 'T-0001', now: fixedClock() });

  assert.throws(
    () => completeTask(workspace.root, { id: 'T-0001', now: fixedClock() }),
    (error: unknown) => {
      assert.ok(error instanceof TaskGraphError);
      assert.equal(error.code, 'E_COMPLETION_INCOMPLETE');
      assert.match(error.message, /declares no completion targets/);
      return true;
    },
  );
});

test('US-013: child claims stay independent from the composite claim', () => {
  const workspace = useTempWorkspace(test, 'us-013-claims');
  initializeProject(workspace.root, { name: 'claims', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '子任务', now: fixedClock() });
  setCompletionRequires(workspace.root, { task: 'T-0001', requires: [inner.id] });

  claimTask(workspace.root, {
    id: 'T-0001',
    role: 'coordinator',
    sessionId: 'thread-composite',
    now: fixedClock(),
  });
  claimTask(workspace.root, {
    id: inner.id,
    role: 'implementer',
    sessionId: 'thread-child',
    now: fixedClock(),
  });

  const repository = loadTaskRepository(workspace.root);
  assert.equal(repository.taskById('T-0001')?.claim?.role, 'coordinator');
  assert.equal(repository.taskById(inner.id)?.claim?.role, 'implementer');
  assert.equal(repository.taskById(inner.id)?.claim?.sessionId, 'thread-child');

  // Releasing the composite claim never touches the child claim.
  releaseClaim(workspace.root, { id: 'T-0001', now: fixedClock() });
  const after = loadTaskRepository(workspace.root);
  assert.equal(after.taskById('T-0001')?.claim, null);
  assert.equal(after.taskById(inner.id)?.claim?.sessionId, 'thread-child');
});

test('US-013: composite commands work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-013-cli');
  runCliProcess(['init', '--name', 'p', '--task', '复合任务'], { cwd: workspace.root });
  const graph = runCliProcess(['graph', 'add', '--title', '子图', '--parent-task', 'T-0001'], {
    cwd: workspace.root,
  });
  assert.equal(graph.code, 0, graph.stderr);
  runCliProcess(['task', 'add', '--graph', 'G-002', '--title', '子任务'], { cwd: workspace.root });

  const completion = runCliProcess(
    ['task', 'set-completion', 'T-0001', '--requires', 'T-0002'],
    { cwd: workspace.root },
  );
  assert.equal(completion.code, 0, completion.stderr);
  assert.match(completion.stdout, /id: T-0001[\s\S]*completionRequires:[\s\S]*T-0002/);

  const start = runCliProcess(['task', 'start', 'T-0001'], { cwd: workspace.root });
  assert.equal(start.code, 0, start.stderr);
  const premature = runCliProcess(['task', 'complete', 'T-0001'], { cwd: workspace.root });
  assert.equal(premature.code, EXIT_FAILURE);
  assert.match(premature.stderr, /E_COMPLETION_INCOMPLETE/);

  const missingRequires = runCliProcess(['task', 'set-completion', 'T-0001'], { cwd: workspace.root });
  assert.equal(missingRequires.code, EXIT_USAGE);
  assert.match(missingRequires.stderr, /completion target is required/);

  const missingGraph = runCliProcess(['task', 'attach-subgraph', 'T-0001'], { cwd: workspace.root });
  assert.equal(missingGraph.code, EXIT_USAGE);
  assert.match(missingGraph.stderr, /subgraph ID is required/);

  const attach = runCliProcess(
    ['task', 'attach-subgraph', 'T-0001', '--graph', 'G-002', '--json'],
    { cwd: workspace.root },
  );
  assert.equal(attach.code, 0, attach.stderr);
  const payload = JSON.parse(attach.stdout) as {
    task: { subgraph: { graph: string; completionRequires: string[] } };
  };
  assert.equal(payload.task.subgraph.graph, 'G-002');
  assert.deepEqual(payload.task.subgraph.completionRequires, ['T-0002']);
});
