import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { usageError } from '../src/core/errors.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask, replaceTask, reviseTask, resolveTargetGraph } from '../src/core/taskops.js';
import { readProjectManifest } from '../src/core/project.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const AT = '2026-09-21T10:00:00+08:00';

function seed(workspace: TempWorkspace): void {
  initializeProject(workspace.root, { name: 'task-ops', task: '根任务' });
}

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

test('US-008: task add creates a complete task document with a stable ID', () => {
  const workspace = useTempWorkspace(test, 'us-008-add');
  seed(workspace);
  const created = addTask(workspace.root, {
    graph: 'G-001',
    title: '实现登录接口',
    goal: '提供密码登录能力。',
    completionConditions: ['正确凭证可以登录', '错误凭证会被拒绝'],
    workLog: ['2026-09-21 开始调研'],
    actor: 'agent',
    now: fixedClock(),
  });

  assert.equal(created.id, 'T-0002');
  assert.equal(created.graph, 'G-001');
  assert.equal(created.status, 'todo');
  assert.equal(created.title, '实现登录接口');
  assert.equal(created.body.includes('## 目标'), true);
  assert.equal(created.body.includes('## 完成条件'), true);
  assert.equal(created.body.includes('## 工作记录'), true);
  assert.ok(created.body.includes('- 正确凭证可以登录'));
  assert.ok(created.body.includes('2026-09-21 开始调研'));
  assert.deepEqual(created.history, [
    { event: 'created', at: AT, actor: 'agent', extra: { graph: 'G-001' } },
  ]);

  const onDisk = workspace.read('.task-graph/tasks/T-0002.md');
  assert.ok(onDisk.startsWith('---\n'));
  assert.ok(onDisk.includes('# 实现登录接口'));
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-008: task add records dependencies, blockers and derived sources', () => {
  const workspace = useTempWorkspace(test, 'us-008-add-deps');
  seed(workspace);
  const depends = addTask(workspace.root, { graph: 'G-001', title: '前置任务', now: fixedClock() });
  const created = addTask(workspace.root, {
    graph: 'G-001',
    title: '后继任务',
    dependsOnSpecs: [depends.id],
    manualBlockers: ['等待法务审批'],
    now: fixedClock(),
  });

  assert.deepEqual(created.dependsOn, [{ task: depends.id, mode: 'full' }]);
  assert.deepEqual(created.manualBlockers, ['等待法务审批']);
  assert.equal(loadTaskRepository(workspace.root).tasks.length, 3);
});

test('US-008: task add rejects a missing or ambiguous graph placement', () => {
  const workspace = useTempWorkspace(test, 'us-008-graph-choice');
  seed(workspace);
  addGraph(workspace.root, { title: '官网发布', entry: true });

  assert.throws(
    () => addTask(workspace.root, { title: '没有归属' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_GRAPH_AMBIGUOUS',
  );
  assert.throws(
    () => addTask(workspace.root, { title: '未知图', graph: 'G-404' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_TASK_GRAPH',
  );
  assert.equal(loadTaskRepository(workspace.root).tasks.length, 1);

  // With exactly one graph the placement is unambiguous and may be omitted.
  const single = useTempWorkspace(test, 'us-008-single-graph');
  initializeProject(single.root, { name: 'p' });
  addGraph(single.root, { title: '唯一入口图', entry: true });
  const created = addTask(single.root, { title: '自动归属', now: fixedClock() });
  assert.equal(created.graph, 'G-001');
});

test('US-008: a project without any graph refuses task creation', () => {
  const workspace = useTempWorkspace(test, 'us-008-no-graph');
  initializeProject(workspace.root, { name: 'p' });
  assert.throws(
    () => addTask(workspace.root, { title: 'x' }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_GRAPH',
  );
});

test('US-008: resolveTargetGraph explains every placement decision', () => {
  const manifest = readProjectManifest;
  assert.ok(manifest);
  assert.throws(() => resolveTargetGraph({ version: 1, name: 'x', entryGraphs: [], graphs: [], sources: [] }, undefined));
  const two = {
    version: 1 as const,
    name: 'x',
    entryGraphs: ['G-001'],
    graphs: [
      { id: 'G-001', title: 'a' },
      { id: 'G-002', title: 'b' },
    ],
    sources: [],
  };
  assert.equal(resolveTargetGraph(two, 'G-002'), 'G-002');
  assert.throws(
    () => resolveTargetGraph(two, undefined),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_GRAPH_AMBIGUOUS',
  );
});

test('US-008: revise keeps the ID and file name and appends a revised event', () => {
  const workspace = useTempWorkspace(test, 'us-008-revise');
  seed(workspace);
  const created = addTask(workspace.root, {
    graph: 'G-001',
    title: '旧标题',
    goal: '旧目标。',
    completionConditions: ['旧条件'],
    now: fixedClock(),
  });
  const before = workspace.read(`.task-graph/tasks/${created.id}.md`);

  const revised = reviseTask(workspace.root, {
    id: created.id,
    title: '新标题',
    goal: '新目标。',
    completionConditions: ['新条件一', '新条件二'],
    actor: 'user',
    now: fixedClock(),
  });

  assert.equal(revised.id, created.id);
  assert.equal(revised.status, 'todo');
  assert.equal(revised.title, '新标题');
  assert.ok(revised.body.includes('# 新标题'));
  assert.ok(revised.body.includes('新目标。'));
  assert.ok(revised.body.includes('- 新条件一'));
  assert.ok(!revised.body.includes('旧目标。'));
  assert.ok(revised.body.includes('## 工作记录'));

  const history = revised.history.at(-1)!;
  assert.equal(history.event, 'revised');
  assert.equal(history.at, AT);
  assert.equal(history.actor, 'user');
  assert.equal(history.extra['title'], '新标题');

  const after = workspace.read(`.task-graph/tasks/${created.id}.md`);
  assert.equal(loadTaskRepository(workspace.root).tasks.map((task) => task.id).length, 2);
  assert.ok(after.length > 0 && before.length > 0);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-008: changing a title never renames the task file', () => {
  const workspace = useTempWorkspace(test, 'us-008-no-rename');
  seed(workspace);
  const created = addTask(workspace.root, { graph: 'G-001', title: '原名', now: fixedClock() });
  const filesBefore = workspace.listFiles();

  reviseTask(workspace.root, { id: created.id, title: '改名后的标题', now: fixedClock() });

  assert.deepEqual(workspace.listFiles(), filesBefore);
  assert.ok(workspace.exists(`.task-graph/tasks/${created.id}.md`));
  assert.equal(loadTaskRepository(workspace.root).taskById(created.id)?.title, '改名后的标题');
});

test('US-008: revise rejects an empty revision request', () => {
  const workspace = useTempWorkspace(test, 'us-008-revise-empty');
  seed(workspace);
  const created = addTask(workspace.root, { graph: 'G-001', title: '任务', now: fixedClock() });
  const before = workspace.read(`.task-graph/tasks/${created.id}.md`);
  assert.throws(
    () => reviseTask(workspace.root, { id: created.id }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_REVISE',
  );
  assert.equal(workspace.read(`.task-graph/tasks/${created.id}.md`), before);
});

test('US-008: the replacement flow cancels the old task and links supersedes', () => {
  const workspace = useTempWorkspace(test, 'us-008-replace');
  seed(workspace);
  const created = addTask(workspace.root, {
    graph: 'G-001',
    title: '原始目标',
    goal: '原始目标。',
    now: fixedClock(),
  });

  const result = replaceTask(workspace.root, {
    id: created.id,
    title: '重写后的目标',
    reason: '目标发生变化',
    actor: 'agent',
    now: fixedClock(),
  });

  assert.equal(result.cancelled.id, created.id);
  assert.equal(result.cancelled.status, 'cancelled');
  assert.equal(result.cancelled.history.at(-1)!.event, 'cancelled');
  assert.equal(result.cancelled.history.at(-1)!.extra['from'], 'todo');

  assert.notEqual(result.created.id, created.id);
  assert.equal(result.created.status, 'todo');
  assert.deepEqual(result.created.supersedes, [created.id]);
  assert.equal(result.created.graph, 'G-001');
  assert.equal(result.created.title, '重写后的目标');

  const repository = loadTaskRepository(workspace.root);
  assert.equal(repository.taskById(created.id)?.status, 'cancelled');
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-008: replace refuses an already cancelled task', () => {
  const workspace = useTempWorkspace(test, 'us-008-replace-cancelled');
  seed(workspace);
  const created = addTask(workspace.root, { graph: 'G-001', title: '原始目标', now: fixedClock() });
  replaceTask(workspace.root, { id: created.id, title: '替代', now: fixedClock() });
  assert.throws(
    () => replaceTask(workspace.root, { id: created.id, title: '再次替代', now: fixedClock() }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TRANSITION',
  );
});

test('US-008: every successful command rebuilds the generated artifacts', () => {
  const workspace = useTempWorkspace(test, 'us-008-rebuild');
  seed(workspace);
  const created = addTask(workspace.root, { graph: 'G-001', title: '任务 A', now: fixedClock() });
  const afterAdd = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    tasks: { id: string; title: string }[];
  };
  assert.deepEqual(
    afterAdd.tasks.map((task) => task.id),
    ['T-0001', 'T-0002'],
  );

  reviseTask(workspace.root, { id: created.id, title: '任务 A 修订', now: fixedClock() });
  const afterRevise = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    tasks: { id: string; title: string }[];
  };
  assert.equal(afterRevise.tasks.find((task) => task.id === created.id)?.title, '任务 A 修订');

  replaceTask(workspace.root, { id: created.id, title: '任务 A 重写', now: fixedClock() });
  const afterReplace = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    tasks: { id: string; title: string }[];
  };
  assert.deepEqual(
    afterReplace.tasks.map((task) => task.id),
    ['T-0001', 'T-0002', 'T-0003'],
  );
  assert.equal(
    afterReplace.tasks.find((task) => task.id === 'T-0002')?.title,
    '任务 A 修订',
  );
  assert.equal(
    afterReplace.tasks.find((task) => task.id === 'T-0003')?.title,
    '任务 A 重写',
  );
});

test('US-008: task add, revise and replace work through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-008-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });

  const add = runCliProcess(
    ['task', 'add', '--graph', 'G-001', '--title', '实现登录', '--goal', '登录能力', '--condition', '可登录'],
    { cwd: workspace.root },
  );
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /Created T-0002 in G-001: 实现登录/);

  const revise = runCliProcess(['task', 'revise', 'T-0002', '--title', '实现登录能力'], {
    cwd: workspace.root,
  });
  assert.equal(revise.code, 0, revise.stderr);
  assert.match(revise.stdout, /Revised T-0002: 实现登录能力/);
  assert.equal(
    loadTaskRepository(workspace.root).taskById('T-0002')?.title,
    '实现登录能力',
  );

  const replace = runCliProcess(
    ['task', 'revise', 'T-0002', '--replace', '--title', '重写登录能力', '--reason', '目标变化'],
    { cwd: workspace.root },
  );
  assert.equal(replace.code, 0, replace.stderr);
  assert.match(replace.stdout, /Replaced T-0002 with T-0003/);

  const missingTitle = runCliProcess(['task', 'add'], { cwd: workspace.root });
  assert.equal(missingTitle.code, EXIT_USAGE);
  assert.match(missingTitle.stderr, /task title is required/);

  // A second graph makes the placement ambiguous until --graph is supplied.
  assert.equal(
    runCliProcess(['graph', 'add', '--title', '第二张图', '--entry'], { cwd: workspace.root }).code,
    0,
  );
  const ambiguous = runCliProcess(['task', 'add', '--title', 'x'], { cwd: workspace.root });
  assert.equal(ambiguous.code, EXIT_FAILURE);
  assert.match(ambiguous.stderr, /E_GRAPH_AMBIGUOUS|Several graphs exist/);

  const placed = runCliProcess(['task', 'add', '--title', 'x', '--graph', 'G-002'], {
    cwd: workspace.root,
  });
  assert.equal(placed.code, 0, placed.stderr);
  assert.match(placed.stdout, /Created T-0004 in G-002: x/);
});

test('US-008: usage errors use the usage exit code', () => {
  const error = usageError('nope');
  assert.equal(error.code, 'E_USAGE');
});
