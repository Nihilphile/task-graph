import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess, useTempWorkspace } from './helpers/temp.js';

test('work log and structured outputs are visible through task show and the generated view', (t) => {
  const workspace = useTempWorkspace(t, 'us-024-annotations');
  const run = (...args: string[]) => runCliProcess(args, { cwd: workspace.root });
  assert.equal(run('init', '--name', 'handoff', '--task', '根任务').code, 0);

  const revision = run('task', 'revise', 'T-0001', '--note', '只进历史');
  assert.equal(revision.code, 0, revision.stderr);
  const logged = run('task', 'log', 'T-0001', '--text', '完成接口契约核对');
  assert.equal(logged.code, 0, logged.stderr);
  const added = run('task', 'output', 'add', 'T-0001', '--path', 'docs/api.md', '--note', '接口契约');
  assert.equal(added.code, 0, added.stderr);

  const shown = run('task', 'show', 'T-0001', '--detail', '--expand', 'log', '--json');
  assert.equal(shown.code, 0, shown.stderr);
  const task = JSON.parse(shown.stdout).task as {
    documents: { logs: { body: string }[] };
    outputs: { path: string; note?: string }[];
  };
  assert.match(task.documents.logs[0]!.body, /完成接口契约核对/);
  assert.ok(!task.documents.logs[0]!.body.includes('只进历史'));
  assert.deepEqual(task.outputs, [{ path: 'docs/api.md', note: '接口契约' }]);
  assert.ok(workspace.read('.task-graph/tasks/T-0001.md').includes('output_added'));
  assert.ok(workspace.read('.task-graph/generated/index.html').includes('完成接口契约核对'));

  const removed = run('task', 'output', 'remove', 'T-0001', '--path', 'docs/api.md');
  assert.equal(removed.code, 0, removed.stderr);
  const after = JSON.parse(run('task', 'show', 'T-0001', '--detail', '--json').stdout).task;
  assert.deepEqual(after.outputs, []);
  assert.equal(run('task', 'output', 'add', 'T-0001', '--path', '../outside.md').code, 1);
  assert.equal(run('task', 'output', 'add', 'T-0001', '--path', 'C:outside.md').code, 1);
  assert.deepEqual(JSON.parse(run('task', 'show', 'T-0001', '--detail', '--json').stdout).task.outputs, []);
});

test('task list computes current blockers from source without graph.json', (t) => {
  const workspace = useTempWorkspace(t, 'us-024-inspect');
  const run = (...args: string[]) => runCliProcess(args, { cwd: workspace.root });
  assert.equal(run('init', '--name', 'inspection', '--task', '前置任务').code, 0);
  const add = run('task', 'add', '--title', '后续任务', '--depends-on', 'T-0001');
  assert.equal(add.code, 0, add.stderr);
  workspace.write('.task-graph/generated/graph.json', '{"stale":true}');

  const listed = run('task', 'list', '--readiness', 'unready', '--json');
  assert.equal(listed.code, 0, listed.stderr);
  const tasks = JSON.parse(listed.stdout).tasks as { id: string; blockedBy: unknown[] }[];
  assert.deepEqual(tasks.map((task) => task.id), ['T-0002']);
  assert.deepEqual(tasks[0]!.blockedBy, [{ kind: 'task', task: 'T-0001' }]);

  assert.equal(run('task', 'start', 'T-0001').code, 0);
  assert.equal(run('task', 'complete', 'T-0001').code, 0);
  const ready = JSON.parse(run('task', 'list', '--readiness', 'ready', '--json').stdout).tasks;
  assert.ok(ready.some((task: { id: string }) => task.id === 'T-0002'));
});
