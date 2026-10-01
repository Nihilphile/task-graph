import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { readTaskDocument } from '../src/core/task.js';
import { attachDocument, taskDocuments } from '../src/core/documents.js';
import { planGitHub } from '../src/core/github-plan.js';
import { useTempWorkspace } from './helpers/temp.js';
import { openViewer, click, taskNode } from './helpers/viewer-dom.js';

function setup(t: TestContext) {
  const w = useTempWorkspace(t, 'reference-context');
  initializeProject(w.root, { name: 'References', task: 'Producer' });
  const invoke = async (...args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main([...args, '--json', '--detail'], { cwd: w.root, io: { out: text => out.push(text), err: text => err.push(text) }, githubClient: { request() { throw new Error('Unexpected network'); } } });
    return { code, payload: JSON.parse(out.join('\n')), error: err.join('\n') };
  };
  const run = async (...args: string[]) => { const result = await invoke(...args); assert.equal(result.code, 0, result.error); return result.payload; };
  return { w, run, invoke, legacyReference: (id: string, ...args: string[]) => {
    const option = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
    attachDocument(w.root, { id, kind: 'reference', path: option('--path')!, summary: option('--summary'), title: option('--title'), snapshot: args.includes('--snapshot') });
  } };
}

test('Legacy attachment summary round-trips for all kinds; reference supports live code and frozen versions', async t => {
  const { w, run, legacyReference } = setup(t);
  w.write('guide.md', '# Guide\nFrozen original');
  for (const kind of ['report', 'log', 'handoff', 'reference']) {
    if (kind === 'reference') legacyReference('T-0001', '--path', 'guide.md', '--summary', kind + ' summary');
    else await run('task', kind, 'attach', 'T-0001', '--path', 'guide.md', '--summary', kind + ' summary');
  }
  w.write('types.ts', 'export type SavedReport = { path: string };');
  legacyReference('T-0001', '--path', 'types.ts', '--summary', 'Producer contract');
  legacyReference('T-0001', '--path', 'types.ts', '--snapshot', '--title', 'Frozen contract');
  w.write('types.ts', 'export type SavedReport = { readPath: string };');
  const task = readTaskDocument(w.root, 'T-0001');
  for (const kind of ['report', 'log', 'handoff', 'reference']) assert.equal(task.outputs.find(o => o.kind === kind)?.summary, kind + ' summary');
  const refs = taskDocuments(w.root, task).references!;
  assert.match(refs.find(d => d.title === 'types.ts')!.body!, /readPath/);
  assert.match(refs.find(d => d.title === 'Frozen contract')!.body!, /path: string/);
  assert.ok(refs.find(d => d.title === 'Frozen contract')!.snapshot);
  await run('task', 'handoff', 'create', 'T-0001', '--summary', 'Resume after review');
  assert.ok(readTaskDocument(w.root, 'T-0001').outputs.some(o => o.kind === 'handoff' && o.summary === 'Resume after review'));
});

test('File-style reference writes and invalid report snapshot mode are rejected without mutation', async t => {
  const { w, invoke } = setup(t);
  const before = w.read('.task-graph/tasks/T-0001.md');
  for (const file of ['../outside.md', 'missing.md']) {
    assert.notEqual((await invoke('task', 'reference', 'attach', 'T-0001', '--path', file)).code, 0);
    assert.equal(w.read('.task-graph/tasks/T-0001.md'), before);
  }
  w.write('guide.md', 'Guide');
  assert.notEqual((await invoke('task', 'report', 'attach', 'T-0001', '--path', 'guide.md', '--snapshot')).code, 0);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), before);
});

test('Reference label opens path/summary list and escaped code; GitHub publishes index only', async t => {
  const { w, run, legacyReference } = setup(t);
  w.write('guide.ts', 'const code = "<script>window.injected = true</script>";');
  legacyReference('T-0001', '--path', 'guide.ts', '--summary', '<img src=x onerror=alert(1)> contract');
  const page = await openViewer(w.paths.indexHtmlFile); t.after(() => page.close());
  click(page, taskNode(page, 'T-0001'));
  click(page, page.document.querySelector('#details-body [data-panel="references"]')!);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /guide.ts/);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /contract/);
  assert.equal(page.document.querySelector('#details-body img'), null);
  click(page, page.document.querySelector('[data-document]')!);
  assert.match(page.document.querySelector('.document-content pre')!.textContent!, /window.injected/);
  assert.equal(page.document.querySelector('.document-content script'), null);
  assert.deepEqual(page.errors, []);
  // Enable configuration locally through core APIs; never use a real GitHub transport.
  const graph = addGraph(w.root, { title: 'Published', entry: true, githubRepo: 'example/project' }).graph;
  const task = await run('task', 'add', '--graph', graph.id, '--summary', 'Remote index');
  legacyReference(task.task.id, '--path', 'guide.ts', '--summary', 'Code contract');
  const plan = planGitHub(w.root);
  const entity = plan.entities.find(e => e.key === task.task.id)!;
  assert.match(entity.body, /guide.ts[\s\S]*Code contract/);
  assert.equal(plan.comments.length, 0);
  assert.doesNotMatch(entity.body, /window.injected/);
});

test('Show/start share address manifests; direct references preserve provenance and show is read-only', async t => {
  const { w, run, legacyReference } = setup(t);
  w.write('contract.ts', 'SECRET_BODY_NOT_IN_MANIFEST'); w.write('brief.md', '# Consumer requirement');
  legacyReference('T-0001', '--path', 'contract.ts', '--summary', 'Producer interface');
  const second = (await run('task', 'add', '--summary', 'Second producer')).task.id;
  legacyReference(second, '--path', 'contract.ts', '--snapshot', '--summary', 'Pinned contract');
  const consumer = (await run('task', 'add', '--summary', 'Consumer', '--content', 'brief.md', '--depends-on', 'T-0001', '--depends-on', second)).task.id;
  w.write('local.md', 'Own reference');
  legacyReference(consumer, '--path', 'local.md');
  const before = new Map(w.listFiles().map(file => [file, w.readBuffer(file)]));
  const context = (await run('task', 'show', consumer)).context;
  assert.equal(context.project_root, w.root);
  assert.equal(context.content.path, 'brief.md'); assert.equal(context.content.summary, 'Consumer');
  assert.deepEqual(context.references.map((entry: { source_task: string }) => entry.source_task), [consumer, 'T-0001', second]);
  assert.ok(!JSON.stringify(context).includes('SECRET_BODY_NOT_IN_MANIFEST'));
  const show = await run('task', 'show', consumer);
  assert.ok(!JSON.stringify(show.task.documents.references).includes('SECRET_BODY_NOT_IN_MANIFEST'));
  assert.equal(context.references[1].scope, 'dependency');
  assert.equal(context.references[2].mode, 'snapshot');
  assert.match(context.references[2].read_path, /^\.task-graph\/snapshots\//);
  assert.deepEqual(w.listFiles(), [...before.keys()]);
  for (const [file, bytes] of before) assert.deepEqual(w.readBuffer(file), bytes);
  for (const id of ['T-0001', second]) { await run('task', 'start', id); await run('task', 'complete', id); }
  const started = await run('task', 'start', consumer, '--role', 'tester', '--session-id', 'context-fixture');
  assert.deepEqual(started.context.content, context.content);
  assert.deepEqual(started.context.references, context.references);
  assert.ok(started.context.handoffs.length > 0);
  assert.deepEqual((await run('task', 'show', consumer, '--handoff')).context, started.context);
});

test('Partial gates include only referenced members, deduplicate overlapping gates, and do not walk ancestors', async t => {
  const { w, run, legacyReference } = setup(t);
  for (const name of ['parent', 'selected', 'other']) w.write(`${name}.md`, name);
  legacyReference('T-0001', '--path', 'parent.md');
  const selected = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Selected')).task.id;
  const other = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Other')).task.id;
  legacyReference(selected, '--path', 'selected.md');
  legacyReference(other, '--path', 'other.md');
  await run('task', 'expose-gate', 'T-0001', '--name', 'api', '--requires', selected);
  await run('task', 'expose-gate', 'T-0001', '--name', 'schema', '--requires', selected);
  const consumer = (await run('task', 'add', '--graph', 'G-001', '--summary', 'Consumer', '--depends-on', 'T-0001:api', '--depends-on', 'T-0001:schema')).task.id;
  assert.deepEqual((await run('task', 'show', consumer)).context.references.map((r: { path: string }) => r.path), ['parent.md', 'selected.md']);
  const next = (await run('task', 'add', '--graph', 'G-001', '--summary', 'Next', '--depends-on', consumer)).task.id;
  assert.deepEqual((await run('task', 'show', next)).context.references, []);
});

test('Reference index refreshes bindings and distinguishes missing live files from readable snapshots', async t => {
  const { w, run, legacyReference } = setup(t);
  w.write('guide.md', 'Version one');
  legacyReference('T-0001', '--path', 'guide.md');
  legacyReference('T-0001', '--path', 'guide.md', '--snapshot');
  const consumer = (await run('task', 'add', '--summary', 'Consumer', '--depends-on', 'T-0001')).task.id;
  unlinkSync(w.file('guide.md'));
  const entries = (await run('task', 'show', consumer)).context.references;
  assert.match(entries.find((e: { mode: string }) => e.mode === 'live').error, /Cannot read/);
  assert.equal(entries.find((e: { mode: string }) => e.mode === 'snapshot').error, undefined);
  await run('task', 'output', 'remove', 'T-0001', '--path', 'guide.md');
  assert.deepEqual((await run('task', 'show', consumer)).context.references, []);
});

test('Dependency reference sidebar groups source tasks and opens upstream content', async t => {
  const { w, run, legacyReference } = setup(t);
  w.write('upstream.md', '# Upstream contract\nUse this behavior.'); w.write('own.md', 'Own notes');
  legacyReference('T-0001', '--path', 'upstream.md', '--summary', 'Upstream usage');
  const consumer = (await run('task', 'add', '--summary', 'Consumer', '--depends-on', 'T-0001')).task.id;
  legacyReference(consumer, '--path', 'own.md', '--summary', 'Local usage');
  const page = await openViewer(w.paths.indexHtmlFile); t.after(() => page.close());
  click(page, taskNode(page, consumer)); click(page, page.document.querySelector('#details-body [data-panel="references"]')!);
  const text = page.document.querySelector('#details-body')!.textContent!;
  assert.match(text, /本任务提供的参考/); assert.match(text, /依赖提供的参考/);
  assert.match(text, /upstream.md/); assert.match(text, /T-0001/); assert.match(text, /Upstream usage/);
  const entry = [...page.document.querySelectorAll('[data-document]')].find(el => el.textContent?.includes('upstream.md'))!;
  click(page, entry);
  assert.match(page.document.querySelector('.document-content')!.textContent!, /Use this behavior/);
  assert.deepEqual(page.errors, []);
});
