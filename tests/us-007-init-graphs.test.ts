import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXIT_OK, EXIT_USAGE } from '../src/cli/context.js';
import { main } from '../src/cli/main.js';
import { addGraph, nextGraphId } from '../src/core/graphs.js';
import { initializeProject } from '../src/core/init.js';
import { TaskGraphError } from '../src/core/errors.js';
import { readProjectManifest } from '../src/core/project.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { parseTaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace } from './helpers/temp.js';

test('US-007: init creates project.yaml, tasks and generated directories', () => {
  const workspace = useTempWorkspace(test, 'us-007-init');
  const result = initializeProject(workspace.root, { name: '示例项目' });

  assert.ok(workspace.exists('.task-graph/project.yaml'));
  assert.ok(workspace.exists('.task-graph/tasks'));
  assert.ok(workspace.exists('.task-graph/generated'));
  assert.ok(workspace.exists('.task-graph/generated/graph.json'));
  assert.equal(result.manifest.name, '示例项目');
  assert.deepEqual(result.manifest.graphs, []);
  assert.deepEqual(result.manifest.entryGraphs, []);
  assert.equal(result.task, null);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-007: task-first init creates one entry graph and one root task', () => {
  const workspace = useTempWorkspace(test, 'us-007-task-first');
  const result = initializeProject(workspace.root, {
    name: '登录项目',
    task: '实现登录能力',
    completionConditions: ['正确凭证可以登录', '错误凭证会被拒绝'],
  });

  const manifest = readProjectManifest(workspace.root);
  assert.deepEqual(manifest.graphs, [{ id: 'G-001', title: '实现登录能力' }]);
  assert.deepEqual(manifest.entryGraphs, ['G-001']);
  assert.equal(result.task?.id, 'T-0001');
  assert.equal(result.task?.status, 'todo');

  const document = parseTaskDocument(
    workspace.read('.task-graph/tasks/T-0001.md'),
    '.task-graph/tasks/T-0001.md',
  );
  assert.equal(document.id, 'T-0001');
  assert.equal(document.graph, 'G-001');
  assert.equal(document.title, '实现登录能力');
  for (const section of ['# 实现登录能力', '## 目标', '## 完成条件', '## 工作记录']) {
    assert.ok(document.body.includes(section), `root task body is missing ${section}`);
  }
  assert.ok(document.body.includes('- 正确凭证可以登录'));
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-007: a custom graph title is honoured', () => {
  const workspace = useTempWorkspace(test, 'us-007-graph-title');
  initializeProject(workspace.root, {
    name: 'x',
    task: '根任务',
    graphTitle: '核心产品',
  });
  assert.deepEqual(readProjectManifest(workspace.root).graphs, [
    { id: 'G-001', title: '核心产品' },
  ]);
});

test('US-007: init refuses to overwrite an existing project', () => {
  const workspace = useTempWorkspace(test, 'us-007-refuse');
  initializeProject(workspace.root, { name: 'first', task: '根任务' });
  const projectBefore = workspace.read('.task-graph/project.yaml');
  const taskBefore = workspace.read('.task-graph/tasks/T-0001.md');

  assert.throws(
    () => initializeProject(workspace.root, { name: 'second', task: '另一个根任务' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_PROJECT_EXISTS',
  );

  assert.equal(workspace.read('.task-graph/project.yaml'), projectBefore);
  assert.equal(workspace.read('.task-graph/tasks/T-0001.md'), taskBefore);
});

test('US-007: graph add registers a stable ID and title', () => {
  const workspace = useTempWorkspace(test, 'us-007-graph-add');
  initializeProject(workspace.root, { name: 'p', task: '根任务' });

  const second = addGraph(workspace.root, { title: '登录能力子图', parentTask: 'T-0001' });
  assert.deepEqual(second.graph, { id: 'G-002', title: '登录能力子图' });
  assert.equal(second.entry, false);
  assert.equal(second.parentTask, 'T-0001');

  const third = addGraph(workspace.root, { title: '官网发布', entry: true });
  assert.deepEqual(third.graph, { id: 'G-003', title: '官网发布' });
  assert.equal(third.entry, true);

  const manifest = readProjectManifest(workspace.root);
  assert.deepEqual(manifest.graphs, [
    { id: 'G-001', title: '根任务' },
    { id: 'G-002', title: '登录能力子图' },
    { id: 'G-003', title: '官网发布' },
  ]);
  assert.deepEqual(manifest.entryGraphs, ['G-001', 'G-003']);
  assert.equal(nextGraphId(manifest), 'G-004');
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-007: graph add never leaves a dangling non-entry graph', () => {
  const workspace = useTempWorkspace(test, 'us-007-placement');
  initializeProject(workspace.root, { name: 'p', task: '根任务' });

  assert.throws(
    () => addGraph(workspace.root, { title: '没有归属的图' }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_GRAPH_PLACEMENT',
  );
  assert.throws(
    () => addGraph(workspace.root, { title: '既入口又子图', entry: true, parentTask: 'T-0001' }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_GRAPH_PLACEMENT',
  );
  assert.equal(readProjectManifest(workspace.root).graphs.length, 1);

  // A task may enter only one subgraph.
  addGraph(workspace.root, { title: '登录能力子图', parentTask: 'T-0001' });
  assert.throws(
    () => addGraph(workspace.root, { title: '第二个子图', parentTask: 'T-0001' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_SUBGRAPH',
  );
  assert.equal(readProjectManifest(workspace.root).graphs.length, 2);
});

test('US-007: an explicit option adds the new graph to entry_graphs', () => {
  const workspace = useTempWorkspace(test, 'us-007-entry');
  initializeProject(workspace.root, { name: 'p', task: '根任务' });
  const added = addGraph(workspace.root, { title: '官网发布', entry: true });

  assert.equal(added.entry, true);
  const manifest = readProjectManifest(workspace.root);
  assert.deepEqual(manifest.entryGraphs, ['G-001', 'G-002']);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-007: graph add supports an explicit ID and rejects duplicates', () => {
  const workspace = useTempWorkspace(test, 'us-007-graph-id');
  initializeProject(workspace.root, { name: 'p', task: '根任务' });
  const custom = addGraph(workspace.root, { title: '外部图', id: 'G-100', entry: true });
  assert.equal(custom.graph.id, 'G-100');
  // Allocation still continues past the highest number, never reusing gaps.
  assert.equal(nextGraphId(readProjectManifest(workspace.root)), 'G-101');

  assert.throws(
    () => addGraph(workspace.root, { title: '重复', id: 'G-100', entry: true }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_GRAPH',
  );
  assert.equal(readProjectManifest(workspace.root).graphs.length, 2);
});

test('US-007: every successful command validates and rebuilds generated artifacts', () => {
  const workspace = useTempWorkspace(test, 'us-007-rebuild');
  initializeProject(workspace.root, { name: 'p', task: '根任务' });
  const afterInit = readFileSync(workspace.file('.task-graph/generated/graph.json'), 'utf8');
  assert.ok(afterInit.includes('"T-0001"'));

  // Simulate stale generated output; the next command must rebuild it.
  workspace.write('.task-graph/generated/graph.json', '{"stale": true}\n');
  addGraph(workspace.root, { title: '第二张图', entry: true });

  const rebuilt = JSON.parse(
    readFileSync(workspace.file('.task-graph/generated/graph.json'), 'utf8'),
  ) as { graphs: { id: string }[]; tasks: { id: string }[] };
  assert.deepEqual(
    rebuilt.graphs.map((graph) => graph.id),
    ['G-001', 'G-002'],
  );
  assert.deepEqual(
    rebuilt.tasks.map((task) => task.id),
    ['T-0001'],
  );
});

test('US-007: generated output is deterministic for identical source input', () => {
  const first = useTempWorkspace(test, 'us-007-determinism-a');
  const second = useTempWorkspace(test, 'us-007-determinism-b');
  for (const workspace of [first, second]) {
    initializeProject(workspace.root, { name: '同名项目', task: '根任务' });
    addGraph(workspace.root, { title: '第二张图', entry: true });
  }
  assert.equal(
    first.read('.task-graph/generated/graph.json'),
    second.read('.task-graph/generated/graph.json'),
  );
});

test('US-007: init and graph add work through the CLI', async () => {
  const workspace = useTempWorkspace(test, 'us-007-cli');

  const init = runCliProcess(['init', '--name', '中文项目', '--task', '实现登录能力'], {
    cwd: workspace.root,
  });
  assert.equal(init.code, EXIT_OK, init.stderr);
  assert.match(init.stdout, /Initialized task graph project "中文项目"/);
  assert.match(init.stdout, /Entry graph: G-001 实现登录能力/);
  assert.match(init.stdout, /Root task: T-0001 实现登录能力/);

  const add = runCliProcess(['graph', 'add', '--title', '官网发布', '--entry'], {
    cwd: workspace.root,
  });
  assert.equal(add.code, EXIT_OK, add.stderr);
  assert.match(add.stdout, /Registered graph G-002 "官网发布" as an entry graph/);

  const manifest = readProjectManifest(workspace.root);
  assert.deepEqual(manifest.entryGraphs, ['G-001', 'G-002']);
  assert.equal(loadTaskRepository(workspace.root).tasks.length, 1);

  const jsonLines: string[] = [];
  const jsonCode = await main(['graph', 'add', '--title', '第三张图', '--entry', '--json'], {
    cwd: workspace.root,
    io: { out: (text) => jsonLines.push(text), err: (text) => jsonLines.push(text) },
  });
  assert.equal(jsonCode, EXIT_OK);
  const payload = JSON.parse(jsonLines.join('\n')) as { ok: boolean; graph: { id: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.graph.id, 'G-003');
});

test('US-007: CLI init refuses to overwrite and requires a graph title', () => {
  const workspace = useTempWorkspace(test, 'us-007-cli-refuse');
  assert.equal(runCliProcess(['init', '--name', 'p'], { cwd: workspace.root }).code, EXIT_OK);

  const again = runCliProcess(['init', '--name', 'p'], { cwd: workspace.root });
  assert.equal(again.code, 1);
  assert.match(again.stderr, /E_PROJECT_EXISTS/);

  const noTitle = runCliProcess(['graph', 'add'], { cwd: workspace.root });
  assert.equal(noTitle.code, EXIT_USAGE);
  assert.match(noTitle.stderr, /graph title is required/);

  const noPlace = runCliProcess(['graph', 'add', '--title', '悬空图'], { cwd: workspace.root });
  assert.equal(noPlace.code, EXIT_USAGE);
  assert.match(noPlace.stderr, /needs a place in the project/);
});

test('US-007: build command reports the rebuilt projection', () => {
  const workspace = useTempWorkspace(test, 'us-007-build-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });
  const build = runCliProcess(['build'], { cwd: workspace.root });
  assert.equal(build.code, EXIT_OK, build.stderr);
  assert.match(
    build.stdout,
    /Built \.task-graph\/generated\/graph\.json and \.task-graph\/generated\/index\.html \(1 task\(s\), 1 graph\(s\)\)/,
  );
});
