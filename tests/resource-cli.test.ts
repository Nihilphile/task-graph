import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { spawnSync } from 'node:child_process';
import type { DesktopAdapter } from '../src/core/desktop-notify.js';
import { readWatchLedger } from '../src/core/watch.js';
import { initializeProject } from '../src/core/init.js';
import { useTempWorkspace, CLI_ENTRY } from './helpers/temp.js';

function runner(root: string, desktopAdapter?: DesktopAdapter) {
  return async (...args: string[]) => {
    const output: string[] = [], errors: string[] = [];
    const code = await main([...args, '--json'], { cwd: root, env: {}, desktopAdapter, io: { out: s => output.push(s), err: s => errors.push(s) } });
    assert.equal(output.length, 1, errors.join('\n'));
    return { code, data: JSON.parse(output[0]!), errors };
  };
}

test('resource discovery is read-only before init and exposes type actions for absent members', async t => {
  const w = useTempWorkspace(t, 'resource-discovery');
  const run = runner(w.root);
  const root = await run('.', 'describe');
  assert.equal(root.code, 0);
  assert.ok(root.data.children.includes('graph'));
  const absent = await run('graph[G-001].task[T-0001]', 'describe');
  assert.equal(absent.data.exists, false);
  assert.ok(absent.data.operations.includes('start'));
  assert.ok(absent.data.actions.find((a: {action: string}) => a.action === 'start').usage.includes("'graph[G-001].task[T-0001]' start"));
  assert.deepEqual(w.listFiles(), []);
  assert.equal((await run('.', 'init', '--name', 'Demo', '--task', 'Root')).code, 0);
  const found = await run('graph[G-001].task[T-0001]', '--help');
  assert.equal(found.data.exists, true);
  assert.equal(found.data.state.status, 'todo');
});

test('resource creation, dependency arrays, dynamic refinement and lifecycle share legacy semantics', async t => {
  const w = useTempWorkspace(t, 'resource-lifecycle');
  initializeProject(w.root, { name: 'Test', task: 'Root' });
  const run = runner(w.root);
  w.write('goal.md', '# Build consumer');
  const second = await run('graph[G-001].task', 'add', '--summary', 'Other prerequisite');
  assert.equal(second.code, 0);
  assert.equal(second.data.task.resource, 'graph[G-001].task[T-0002]');
  const added = await run('graph[G-001].task', 'add', '--summary', 'Consumer', '--content', 'goal.md', '--planning', 'dynamic',
    '--depends-on', 'graph[G-001].task[T-0001]', '--depends-on', 'T-0002');
  assert.equal(added.code, 0);
  const address = added.data.task.resource;
  const deps = await run(`${address}.dependency`, 'list');
  assert.equal(deps.data.dependencies.length, 2);
  assert.equal(deps.data.dependencies[0].resource, 'graph[G-001].task[T-0001]');
  assert.notEqual((await run(address, 'start')).code, 0);
  for (const id of ['T-0001', 'T-0002']) {
    assert.equal((await run(`graph[G-001].task[${id}]`, 'start')).code, 0);
    assert.equal((await run(`graph[G-001].task[${id}]`, 'complete')).code, 0);
  }
  const description = await run(address, 'describe');
  assert.equal(description.data.state.planningState, 'awaiting_review');
  assert.notEqual((await run(address, 'start')).code, 0);
  assert.equal((await run(address, 'refine', '--reason', 'Requirements and interface verified')).code, 0);
  assert.equal((await run(address, 'start', '--role', 'worker', '--session-id', 'test-session')).code, 0);
  assert.equal((await run(`${address}.log`, 'add', '已阅读上下文，开始施工')).code, 0);
  const legacy = await run('task', 'show', added.data.task.id);
  assert.equal(legacy.data.task.status, 'in_progress');
  assert.equal(legacy.data.task.claim.sessionId, 'test-session');
  assert.equal(legacy.data.resource, undefined);
  assert.equal((await run(address, 'complete')).code, 0);
});

test('wrong graph, conflicting placement, malformed addresses and unsupported arguments have no effects', async t => {
  const w = useTempWorkspace(t, 'resource-guard');
  initializeProject(w.root, { name: 'Test', task: 'Root' });
  const run = runner(w.root);
  await run('graph', 'add', '--title', 'Second', '--entry');
  const before = w.listFiles().map(f => [f, w.read(f)]);
  for (const args of [
    ['graph[G-002].task[T-0001]', 'start'],
    ['graph[G-001].task', 'add', '--graph', 'G-002', '--summary', 'Wrong'],
    ['graph[G-001].task', 'add', '--parent-task', 'T-0001', '--summary', 'Wrong'],
    ['graph[G-001].task[T-0001]', 'start', 'T-0002'],
    ['graph[G-001].task[T-0001]', 'start', '--summray', 'Wrong'],
    ['graph[G-001].task[T-0001]', 'refine', '--reason'],
    ['graph[G-001].task', 'add', '--summary'],
    ['graph[G-001].task[T-0001].report[0]', 'list'],
    ['graph[G-001].watch', 'status', '--flush'],
    ['graph[G-001].task[T-0001]', 'snart'],
  ]) assert.notEqual((await run(...args)).code, 0, args.join(' '));
  assert.deepEqual(w.listFiles().map(f => [f, w.read(f)]), before);
  const description = await run('graph[G-002].task[T-0001]', 'describe');
  assert.equal(description.data.exists, false);
  assert.equal(description.data.actual_resource, 'graph[G-001].task[T-0001]');
});

test('custom graph identities round-trip through resource responses, including reserved characters', async t => {
  const w = useTempWorkspace(t, 'resource-custom-id');
  initializeProject(w.root, { name: 'Test' });
  const run = runner(w.root);
  for (const id of ['T-0001', '实验.图[一]:50%']) {
    assert.equal((await run('graph', 'add', '--id', id, '--title', 'Custom', '--entry')).code, 0);
    const graphs = (await run('graph', 'list')).data.graphs;
    const address = graphs.find((g: {id: string}) => g.id === id).resource;
    const task = (await run(`${address}.task`, 'add', '--summary', 'Task')).data.task;
    assert.equal((await run(task.resource, 'show')).data.task.graph, id);
    assert.equal((await run(address, 'show')).data.graph.id, id);
  }
});

test('watch resource separates registration, read-only status and delivery actions', async t => {
  const w = useTempWorkspace(t, 'resource-watch');
  initializeProject(w.root, { name: 'Watch', task: 'Work' });
  const sent: string[] = [];
  const adapter: DesktopAdapter = {
    inspect: async () => ({ executable: 'fixture', version: 'fixture', home: 'fixture' }),
    submit: async (_binding, _thread, message) => { sent.push(message); return { state: 'accepted', receipt: 'fixture' }; },
  };
  const run = runner(w.root, adapter), watch = 'graph[G-001].watch';
  const thread = '01a0d067-d9fc-7cd1-b278-4b068b7a7169';
  assert.equal((await run(watch, 'add', '--thread', thread)).code, 0);
  const before = w.read('.task-graph/watch.json');
  assert.equal((await run(watch, 'status')).code, 0);
  assert.equal(w.read('.task-graph/watch.json'), before);
  await run('graph[G-001].task[T-0001]', 'start');
  await run('graph[G-001].task[T-0001]', 'complete');
  assert.equal(readWatchLedger(w.root)!.events.length, 1);
  assert.equal((await run(watch, 'flush')).code, 0);
  assert.equal(sent.length, 1);
  assert.equal((await run(watch, 'remove', '--thread', thread)).code, 0);
});

test('PowerShell passes bracket addresses with and without quotes to the actual Node entry', { skip: process.platform !== 'win32' }, t => {
  const w = useTempWorkspace(t, 'resource-powershell');
  initializeProject(w.root, { name: 'PowerShell', task: 'Work' });
  for (const address of ['graph[G-001].task[T-0001]', "'graph[G-001].task[T-0001]'"]) {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      `& $env:TASK_GRAPH_NODE $env:TASK_GRAPH_CLI ${address} describe --cwd $env:TASK_GRAPH_PROJECT --json`], {
      env: { ...process.env, TASK_GRAPH_NODE: process.execPath, TASK_GRAPH_CLI: CLI_ENTRY, TASK_GRAPH_PROJECT: w.root },
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).exists, true);
  }
});

test('scoped plans cannot escape the graph and preserve atomic creation', async t => {
  const w = useTempWorkspace(t, 'resource-plan');
  initializeProject(w.root, { name: 'Test', task: 'Root' });
  const run = runner(w.root);
  await run('graph', 'add', '--title', 'Second', '--entry');
  for (const misplaced of [{ graph: 'G-002' }, { parent_task: 'T-0001' }]) {
    w.write('bad.json', JSON.stringify({ tasks: [{ summary: 'Valid' }, { summary: 'Wrong', ...misplaced }] }));
    assert.notEqual((await run('graph[G-001].task', 'add', '--from', w.file('bad.json'))).code, 0);
    assert.equal((await run('task', 'list')).data.tasks.length, 1);
  }
  w.write('plan.json', JSON.stringify({ tasks: [{ key: 'one', summary: 'First' }, { key: 'two', summary: 'Second', depends_on: ['@one'] }] }));
  const result = await run('graph[G-001].task', 'add', '--from', w.file('plan.json'));
  assert.equal(result.code, 0);
  assert.equal(result.data.tasks.length, 2);
  assert.equal(result.data.tasks[1].resource, 'graph[G-001].task[T-0003]');
});

test('attachment collections preserve direct provenance, snapshots and audience filtering without bodies', async t => {
  const w = useTempWorkspace(t, 'resource-documents');
  initializeProject(w.root, { name: 'Test', task: 'Producer' });
  const run = runner(w.root), producer = 'graph[G-001].task[T-0001]';
  w.write('reference.md', 'PRIVATE_BODY_IMPLEMENTATION');
  w.write('report.md', 'PRIVATE_BODY_REPORT');
  w.write('feedback.md', 'PRIVATE_BODY_USER_FEEDBACK');
  await run(`${producer}.reference`, 'attach', '--path', 'reference.md', '--summary', 'API index');
  await run(`${producer}.report`, 'attach', '--path', 'report.md', '--summary', 'Verification');
  await run(`${producer}.report`, 'attach', '--path', 'feedback.md', '--audience', 'user');
  const consumer = (await run('graph[G-001].task', 'add', '--summary', 'Consumer', '--depends-on', 'T-0001')).data.task.resource;
  const refs = await run(`${consumer}.reference`, 'list');
  assert.equal(refs.data.files[0].source_resource, producer);
  assert.equal(refs.data.files[0].scope, 'dependency');
  assert.equal(refs.data.files[0].mode, 'live');
  const reports = await run(`${consumer}.report`, 'list');
  assert.equal(reports.data.files.length, 1);
  assert.equal(reports.data.files[0].mode, 'snapshot');
  assert.match(reports.data.files[0].read_path, /^\.task-graph\/snapshots\//);
  assert.equal(reports.data.excluded[0].reason, 'audience_user');
  assert.doesNotMatch(JSON.stringify([refs.data, reports.data]), /PRIVATE_BODY/);
});

test('dependency edits, graph and subgraph queries expose canonical addresses', async t => {
  const w = useTempWorkspace(t, 'resource-relations');
  initializeProject(w.root, { name: 'Test', task: 'Parent' });
  const run = runner(w.root), parent = 'graph[G-001].task[T-0001]';
  const child = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Child')).data.task;
  const subgraph = await run(`${parent}.subgraph`, 'show');
  assert.equal(subgraph.data.subgraph.resource, `graph[${child.graph}]`);
  const graph = await run(`graph[${child.graph}]`, 'show');
  assert.equal(graph.data.parent, parent);
  const other = (await run(`graph[${child.graph}].task`, 'add', '--summary', 'Other')).data.task.resource;
  assert.equal((await run(`${other}.dependency`, 'add', `graph[${child.graph}].task[${child.id}]`)).code, 0);
  assert.equal((await run(`${other}.dependency`, 'list')).data.dependencies.length, 1);
  assert.equal((await run(`${other}.dependency`, 'remove', child.id)).code, 0);
  assert.equal((await run(`${other}.dependency`, 'list')).data.dependencies.length, 0);
  assert.equal((await run('graph', 'list')).data.graphs.length, 2);
  assert.equal((await run(`graph[${child.graph}].task`, 'list')).data.tasks.length, 2);
});

test('subgraph traversal validates every ownership hop and resolves task-only shorthand', async t => {
  const w = useTempWorkspace(t, 'resource-traversal');
  initializeProject(w.root, { name: 'Tree', task: 'Root' });
  const run = runner(w.root);
  const child = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Child')).data.task;
  const grandchild = (await run('task', 'add', '--parent-task', child.id, '--summary', 'Grandchild')).data.task;
  const childPath = `task[T-0001].subgraph.task[${child.id}]`;
  const deepPath = `graph[G-001].${childPath}.subgraph.task[${grandchild.id}]`;
  assert.equal((await run('task[T-0001]', 'show')).data.task.resource, 'graph[G-001].task[T-0001]');
  assert.equal((await run(childPath, 'show')).data.task.id, child.id);
  assert.equal((await run(deepPath, 'show')).data.task.resource, `graph[${grandchild.graph}].task[${grandchild.id}]`);
  assert.equal((await run(`${childPath}.subgraph.task`, 'list')).data.tasks.length, 1);
  const added = await run(`${childPath}.subgraph.task`, 'add', '--summary', 'Another grandchild');
  assert.equal(added.code, 0);
  assert.equal(added.data.task.graph, grandchild.graph);
  w.write('details.md', '# Deep requirements');
  assert.equal((await run(`${deepPath}.content`, 'attach', '--path', 'details.md')).code, 0);
  assert.equal((await run(`${deepPath}.content`, 'list')).data.files[0].read_path, 'details.md');
  const before = w.listFiles().map(f => [f, w.read(f)]);
  assert.notEqual((await run(`task[T-0001].subgraph.task[${grandchild.id}]`, 'start')).code, 0);
  assert.notEqual((await run(`${deepPath}.subgraph.task`, 'add', '--summary', 'Implicit child')).code, 0);
  assert.notEqual((await run(`graph[${child.graph}].${childPath}`, 'start')).code, 0);
  assert.deepEqual(w.listFiles().map(f => [f, w.read(f)]), before);
  const absent = await run(`${deepPath}.subgraph.task`, 'describe');
  assert.equal(absent.data.exists, false);
  assert.match(absent.data.reason, /no subgraph/);
  assert.ok(absent.data.operations.includes('add'));
});
