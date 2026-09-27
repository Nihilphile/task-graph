import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graphSkill = path.resolve(process.env.TASK_GRAPH_SKILL_ROOT ?? path.join(skill, '../..'));
const cli = path.join(graphSkill, 'dist/src/cli.js');
const { main } = await import(pathToFileURL(path.join(graphSkill, 'dist/src/cli/main.js')).href);

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'to-task-工作流-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  cpSync(path.join(skill, 'assets/example'), root, { recursive: true });
  const write = (relative, text) => { const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
  const read = relative => readFileSync(path.join(root, relative), 'utf8');
  // Exercise the actual node CLI from a different cwd: --from is absolute, content is project-relative.
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--cwd', root, '--json'], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  const taskFiles = () => readdirSync(path.join(root, '.task-graph/tasks')).filter(file => file.endsWith('.md'));
  return { root, write, read, run, taskFiles };
}

test('Shipped example produces bound requirements, correct frontier and an offline human-readable graph', t => {
  const { root, read, run } = fixture(t);
  run('init', '--name', 'CSV export');
  const { graph } = run('graph', 'add', '--title', 'CSV export', '--entry');
  const created = run('task', 'add', '--from', path.join(root, 'plan.json'), '--graph', graph.id);
  assert.equal(created.ok, true);
  assert.equal(created.tasks.length, 2);
  assert.equal(run('validate').ok, true);
  const available = run('task', 'list', '--available').tasks;
  assert.deepEqual(available.map(task => task.id), [created.keys['csv-export.base']]);
  const successor = run('task', 'show', created.keys['csv-export.filtered']).task;
  assert.deepEqual(successor.dependsOn, [{ task: created.keys['csv-export.base'], mode: 'full' }]);
  const handoff = run('task', 'show', available[0].id, '--handoff', '--expand', 'content').handoff;
  assert.ok(handoff.includes('UTF-8 CSV'));
  const projection = JSON.parse(read('.task-graph/generated/graph.json'));
  assert.ok(projection.tasks[0].documents.content.html.includes('CSV'));
  assert.ok(read('.task-graph/generated/index.html').includes('按当前筛选条件导出'));
});

test('Replay keeps IDs and progress; next agent reads current requirements and becomes unblocked by delivery', t => {
  const { root, write, run, taskFiles } = fixture(t);
  run('init', '--name', 'Resume');
  const { graph } = run('graph', 'add', '--title', 'Resume', '--entry');
  const add = () => run('task', 'add', '--from', path.join(root, 'plan.json'), '--graph', graph.id);
  const first = add();
  const id = first.keys['csv-export.base'];
  const started = run('task', 'start', id, '--role', 'tester', '--session-id', 'isolated-smoke');
  assert.equal(started.guidance.skill, 'task-take');
  assert.match(readFileSync(started.guidance.skill_path, 'utf8'), /name: task-take/);
  write('doc/references/csv-export.md', '# Fixture contract\nCSV columns and escaping rules.');
  run('task', 'reference', 'attach', id, '--path', 'doc/references/csv-export.md', '--summary', 'CSV contract for successor');
  write('doc/reports/csv-export/base.md', '# Test fixture delivery\nA simulated result, not a real feature implementation.');
  run('task', 'complete', id, '--report', 'doc/reports/csv-export/base.md', '--log', 'Fixture complete');
  const again = add();
  assert.deepEqual(again.keys, first.keys);
  assert.equal(taskFiles().length, 2);
  assert.equal(run('task', 'show', id).task.status, 'done');
  assert.deepEqual(run('task', 'list', '--available').tasks.map(task => task.id), [first.keys['csv-export.filtered']]);
  write('doc/tasks/csv-export/filtered.md', '# Current requirements\nUpdated acceptance criterion');
  run('build');
  const handoff = run('task', 'show', first.keys['csv-export.filtered'], '--handoff', '--expand', 'content', '--expand', 'report').handoff;
  assert.ok(handoff.includes('Updated acceptance criterion'));
  assert.ok(handoff.includes('Test fixture delivery'));
  const next = run('task', 'start', first.keys['csv-export.filtered'], '--role', 'tester', '--session-id', 'successor-smoke');
  assert.deepEqual(next.guidance, started.guidance);
  assert.equal(next.context.references[0].source_task, id);
  assert.equal(next.context.references[0].summary, 'CSV contract for successor');
  assert.match(readFileSync(path.join(next.context.project_root, next.context.references[0].read_path), 'utf8'), /CSV columns/);
  const resumed = run('task', 'show', first.keys['csv-export.filtered']);
  assert.equal(resumed.task.claim.sessionId, 'successor-smoke');
  assert.deepEqual(resumed.guidance, next.guidance);
});

test('Existing parent gets one child graph; exposed gates unblock external work without completing parent', t => {
  const { root, write, run } = fixture(t);
  run('init', '--task', 'Deliver export');
  const parent = run('task', 'list').tasks[0];
  write('nested.json', JSON.stringify({ tasks: [
    { key: 'nested.base', summary: 'Base', content: 'doc/tasks/csv-export/base.md', parent_task: parent.id },
    { key: 'nested.filtered', summary: 'Filtered', content: 'doc/tasks/csv-export/filtered.md', parent_task: parent.id, depends_on: ['@nested.base'] },
  ] }));
  const added = run('task', 'add', '--from', path.join(root, 'nested.json'));
  run('task', 'add', '--from', path.join(root, 'nested.json'));
  const detail = run('task', 'show', parent.id).task;
  assert.deepEqual(new Set(detail.subgraph.completionRequires), new Set(Object.values(added.keys)));
  assert.equal(new Set(added.tasks.map(task => task.graph)).size, 1);
  run('task', 'expose-gate', parent.id, '--name', 'base-ready', '--requires', added.keys['nested.base']);
  const consumer = run('task', 'add', '--graph', parent.graph, '--summary', 'External check', '--depends-on', `${parent.id}:base-ready`).task;
  assert.equal(run('task', 'show', consumer.id).task.readiness, 'blocked');
  run('task', 'start', added.keys['nested.base']);
  run('task', 'complete', added.keys['nested.base']);
  assert.equal(run('task', 'show', parent.id).task.status, 'todo');
  assert.equal(run('task', 'show', consumer.id).task.readiness, 'ready');
});

test('A cyclic draft rolls back every task, then corrected stable-key plan can be submitted', async t => {
  const { root, write, run, taskFiles } = fixture(t);
  run('init'); const { graph } = run('graph', 'add', '--entry', '--title', 'Draft');
  const plan = { tasks: [
    { key: 'cycle.a', summary: 'A', content: 'doc/tasks/csv-export/base.md', depends_on: ['@cycle.b'] },
    { key: 'cycle.b', summary: 'B', content: 'doc/tasks/csv-export/filtered.md', depends_on: ['@cycle.a'] },
  ] };
  write('draft.json', JSON.stringify(plan));
  const out = [];
  const code = await main(['task', 'add', '--from', path.join(root, 'draft.json'), '--graph', graph.id, '--json'], { cwd: root, io: { out: text => out.push(text), err: () => {} } });
  assert.notEqual(code, 0);
  assert.equal(JSON.parse(out.join('\n')).ok, false);
  assert.equal(taskFiles().length, 0);
  plan.tasks[0].depends_on = [];
  write('draft.json', JSON.stringify(plan));
  assert.equal(run('task', 'add', '--from', path.join(root, 'draft.json'), '--graph', graph.id).tasks.length, 2);
});

test('GitHub request stays in task-graph: offline publishing preserves local tasks and exposes pending', async t => {
  const { root, run, taskFiles } = fixture(t);
  run('init');
  let attempts = 0;
  const offline = { request() { attempts++; throw new Error('Isolated test: no network'); } };
  const invoke = async (...args) => {
    const out = [];
    const code = await main([...args, '--json'], { cwd: root, githubClient: offline, io: { out: text => out.push(text), err: () => {} } });
    assert.equal(code, 0);
    return JSON.parse(out.join('\n'));
  };
  const enabled = await invoke('graph', 'add', '--entry', '--title', 'Published delivery', '--gh', '--repo', 'example/isolated');
  assert.equal(enabled.github.status, 'pending');
  const created = await invoke('task', 'add', '--from', path.join(root, 'plan.json'), '--graph', enabled.graph.id);
  assert.equal(created.ok, true);
  assert.equal(created.github.status, 'pending');
  const calls = attempts;
  assert.equal((await invoke('task', 'list')).tasks.length, 2);
  assert.equal(attempts, calls);
  assert.equal(taskFiles().length, 2);
  assert.equal((await invoke('github', 'sync')).github.status, 'pending');
  assert.equal(taskFiles().length, 2);
});
