import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatTaskId,
  listTaskFiles,
  loadTaskRepository,
  nextTaskId,
  taskIdNumber,
} from '../src/core/repo.js';
import { writeProjectManifest, emptyProjectManifest, type ProjectManifest } from '../src/core/project.js';
import { TaskGraphError } from '../src/core/errors.js';
import { createTaskDocument, writeTaskDocument } from '../src/core/task.js';
import { useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const MANIFEST: ProjectManifest = {
  version: 1,
  name: 'repo-test',
  entryGraphs: ['G-001', 'G-002'],
  graphs: [
    { id: 'G-001', title: '核心产品' },
    { id: 'G-002', title: '官网发布' },
  ],
  sources: [],
};

function seedProject(
  workspace: TempWorkspace,
  manifest: ProjectManifest = MANIFEST,
): void {
  writeProjectManifest(workspace.root, manifest);
  workspace.mkdir('.task-graph/tasks');
}

function addTask(workspace: TempWorkspace, id: string, graph: string, title = `任务 ${id}`) {
  writeTaskDocument(workspace.root, createTaskDocument({ id, graph, title }));
}

test('US-004: loads project.yaml and every task into typed indexes', () => {
  const workspace = useTempWorkspace(test, 'us-004-load');
  seedProject(workspace);
  addTask(workspace, 'T-0003', 'G-002', '第三个任务');
  addTask(workspace, 'T-0001', 'G-001', '第一个任务');
  addTask(workspace, 'T-0002', 'G-001', '第二个任务');

  const repo = loadTaskRepository(workspace.root);
  assert.equal(repo.manifest.name, 'repo-test');
  assert.deepEqual(
    repo.tasks.map((task) => task.id),
    ['T-0001', 'T-0002', 'T-0003'],
  );
  assert.equal(repo.taskById('T-0002')?.title, '第二个任务');
  assert.equal(repo.taskById('T-9999'), undefined);
  assert.deepEqual(
    repo.tasksInGraph('G-001').map((task) => task.id),
    ['T-0001', 'T-0002'],
  );
  assert.deepEqual(
    repo.tasksInGraph('G-002').map((task) => task.id),
    ['T-0003'],
  );
});

test('US-004: groups tasks by declared graph, keeping empty graphs', () => {
  const workspace = useTempWorkspace(test, 'us-004-group');
  seedProject(workspace, {
    ...MANIFEST,
    graphs: [...MANIFEST.graphs, { id: 'G-003', title: '空图' }],
  });
  addTask(workspace, 'T-0001', 'G-002');

  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual([...repo.graphTasks.keys()].sort(), ['G-001', 'G-002', 'G-003']);
  assert.deepEqual(repo.graphTasks.get('G-001'), []);
  assert.deepEqual(repo.graphTasks.get('G-003'), []);
  assert.deepEqual(
    repo.graphTasks.get('G-002')?.map((task) => task.id),
    ['T-0001'],
  );
});

test('US-004: an empty repository loads with no tasks and allocates T-0001', () => {
  const workspace = useTempWorkspace(test, 'us-004-empty');
  seedProject(workspace, emptyProjectManifest('empty'));
  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual(repo.tasks, []);
  assert.equal(repo.nextTaskId(), 'T-0001');
});

test('US-004: a repository without a tasks directory still loads', () => {
  const workspace = useTempWorkspace(test, 'us-004-no-tasks-dir');
  writeProjectManifest(workspace.root, MANIFEST);
  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual(repo.tasks, []);
  assert.equal(repo.nextTaskId(), 'T-0001');
});

test('US-004: allocates the next ID without filling numeric gaps', () => {
  const workspace = useTempWorkspace(test, 'us-004-gaps');
  seedProject(workspace);
  addTask(workspace, 'T-0001', 'G-001');
  addTask(workspace, 'T-0005', 'G-001');
  addTask(workspace, 'T-0009', 'G-002');

  const repo = loadTaskRepository(workspace.root);
  assert.equal(repo.nextTaskId(), 'T-0010');

  // Allocating never renames or rewrites existing task files.
  const before = workspace.listFiles();
  const nextId = repo.nextTaskId();
  addTask(workspace, nextId, 'G-001');
  const after = workspace.listFiles();
  assert.deepEqual(after, [...before, '.task-graph/tasks/T-0010.md'].sort());
  assert.deepEqual(
    loadTaskRepository(workspace.root).tasks.map((task) => task.id),
    ['T-0001', 'T-0005', 'T-0009', 'T-0010'],
  );
});

test('US-004: nextTaskId handles gaps, ties and longer sequences', () => {
  assert.equal(nextTaskId([]), 'T-0001');
  assert.equal(nextTaskId(['T-0001', 'T-0002']), 'T-0003');
  assert.equal(nextTaskId(['T-0002']), 'T-0003');
  assert.equal(nextTaskId(['T-0001', 'T-0004', 'T-0003']), 'T-0005');
  assert.equal(nextTaskId(['T-9999']), 'T-10000');
  assert.equal(nextTaskId(['not-a-task', 'T-0007']), 'T-0008');
  assert.equal(formatTaskId(1), 'T-0001');
  assert.equal(formatTaskId(12345), 'T-12345');
  assert.equal(taskIdNumber('T-0007'), 7);
  assert.equal(taskIdNumber('G-0001'), undefined);
});

test('US-004: rejects duplicate task IDs', () => {
  const workspace = useTempWorkspace(test, 'us-004-dup');
  seedProject(workspace);
  addTask(workspace, 'T-0001', 'G-001');
  // A second file that declares the already-registered ID is a duplicate.
  workspace.write(
    '.task-graph/tasks/T-0002.md',
    workspace
      .read('.task-graph/tasks/T-0001.md')
      .replace('# 任务 T-0001', '# 任务 T-0002'),
  );
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_DUP_TASK' &&
      /T-0002\.md/.test(error.format()),
  );
});

test('US-004: rejects a task whose frontmatter ID does not match its file name', () => {
  const workspace = useTempWorkspace(test, 'us-004-mismatch');
  seedProject(workspace);
  addTask(workspace, 'T-0001', 'G-001');
  const text = workspace.read('.task-graph/tasks/T-0001.md').replace('id: T-0001', 'id: T-0002');
  workspace.write('.task-graph/tasks/T-0001.md', text);
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_TASK_ID_MISMATCH' &&
      /declares id "T-0002"/.test(error.message),
  );
});

test('US-004: rejects task files that are not named T-NNNN.md', () => {
  const workspace = useTempWorkspace(test, 'us-004-badname');
  seedProject(workspace);
  addTask(workspace, 'T-0001', 'G-001');
  workspace.write('.task-graph/tasks/notes.md', '# not a task\n');
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_FILENAME',
  );
});

test('US-004: malformed task files fail with file context', () => {
  const workspace = useTempWorkspace(test, 'us-004-malformed');
  seedProject(workspace);
  workspace.write('.task-graph/tasks/T-0001.md', '# no frontmatter\n');
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_TASK_FORMAT' &&
      /T-0001\.md/.test(error.message),
  );

  workspace.write('.task-graph/tasks/T-0001.md', '---\nid: T-0001\nstatus: todo\n---\n\n# x\n');
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK',
  );
});

test('US-004: stale temporary files are never loaded as tasks', () => {
  const workspace = useTempWorkspace(test, 'us-004-temp');
  seedProject(workspace);
  addTask(workspace, 'T-0001', 'G-001');
  workspace.write('.task-graph/tasks/.T-0002.md.tmp-1234-abc', 'garbage');
  assert.deepEqual(listTaskFiles(workspace.file('.task-graph/tasks')), ['T-0001.md']);
  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual(
    repo.tasks.map((task) => task.id),
    ['T-0001'],
  );
  assert.equal(repo.nextTaskId(), 'T-0002');
});

test('US-004: a missing project manifest is reported clearly', () => {
  const workspace = useTempWorkspace(test, 'us-004-no-project');
  assert.throws(
    () => loadTaskRepository(workspace.root),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_PROJECT',
  );
});
