import assert from 'node:assert/strict';
import { mkdirSync, rmSync, rmdirSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { readTaskDocument } from '../src/core/task.js';
import { readKnowledge } from '../src/core/knowledge-store.js';
import { recordDecision } from '../src/core/knowledge.js';
import { saveContract } from '../src/core/knowledge.js';
import { attachDocument } from '../src/core/documents.js';
import { startTask, completeTask } from '../src/core/lifecycle.js';
import { configureReview } from '../src/core/review.js';
import { currentReview, readReviewState } from '../src/core/review-state.js';
import { useTempWorkspace } from './helpers/temp.js';
import { openViewer, click, taskNode, waitForLayout } from './helpers/viewer-dom.js';
import { contractSections } from '../src/core/contract-sections.js';

function setup(t: TestContext) {
  const w = useTempWorkspace(t, 'knowledge');
  initializeProject(w.root, { name: 'Shared contracts', task: 'Producer' });
  async function invoke(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: () => {} } });
    return { code, data: JSON.parse(output.join('\n')) };
  }
  async function run(...args: string[]) {
    const result = await invoke(...args); assert.equal(result.code, 0, JSON.stringify(result.data)); return result.data;
  }
  return { w, run, invoke };
}

const sectionedContract = '# Materials\n\n## Common {#common}\nCOMMON_ONLY\n\n## Identity {#identity}\nIDENTITY_ONLY\n\n### Nested detail\nIdentity details\n\n## Payment {#payment}\nPAYMENT_ONLY\n';

test('Section selection reaches CLI, task context and frozen review; common is opt-in', async t => {
  const { w, run } = setup(t);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Materials', '--text', sectionedContract)).contract;
  await run('task[T-0001].contract', 'attach', '--id', `${c.id}#payment`);
  const context = (await run('task[T-0001]', 'show', '--expand', 'contract')).context;
  assert.deepEqual(context.contracts[0].sections, ['payment']);
  assert.match(context.contracts[0].body, /PAYMENT_ONLY/);
  assert.doesNotMatch(context.contracts[0].body, /COMMON_ONLY|IDENTITY_ONLY/);
  const selected = (await run(`contract[${c.id}]`, 'show', '--section', 'identity')).contract;
  assert.equal(selected.sections.length, 3);
  assert.match(selected.body, /Identity details/);
  assert.doesNotMatch(selected.body, /PAYMENT_ONLY|COMMON_ONLY/);
  const next = (await run('task', 'add', '--summary', 'Two sections', '--contract', `${c.id}#common`, '--contract', `${c.id}#identity`)).task;
  const multi = (await run(`task[${next.id}]`, 'show', '--expand', 'contract')).context.contracts;
  assert.equal(multi.length, 1); assert.deepEqual(multi[0].sections, ['common', 'identity']);
  assert.doesNotMatch(multi[0].body, /PAYMENT_ONLY/);
  w.write('rr.md', 'Check payment');
  attachDocument(w.root, { id: 'T-0001', path: 'rr.md', kind: 'review-requirement' });
  configureReview(w.root, 'T-0001', true, {}); startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  const frozen = currentReview(readReviewState(w.root), 'T-0001')!.materials.find(f => f.kind === 'contract')!;
  assert.match(w.read(frozen.read_path), /PAYMENT_ONLY/);
  assert.doesNotMatch(w.read(frozen.read_path), /COMMON_ONLY|IDENTITY_ONLY/);
});

test('Stable section IDs survive title changes, ignore fenced examples and reject dangling bindings atomically', async t => {
  const { w, run, invoke } = setup(t);
  assert.deepEqual(contractSections('```md\n## Fake {#fake}\n```\n\n' + sectionedContract).map(s => s.id), ['common', 'identity', 'payment']);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Materials', '--text', sectionedContract)).contract;
  await run('task[T-0001].contract', 'attach', '--id', `${c.id}#payment`);
  const renamed = sectionedContract.replace('## Payment', '## Renamed payment');
  await run(`contract[${c.id}]`, 'update', '--text', renamed);
  const beforeTask = w.read('.task-graph/tasks/T-0001.md');
  assert.notEqual((await invoke('task[T-0001].contract', 'attach', '--id', `${c.id}#absent`)).code, 0);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), beforeTask);
  for (const invalid of [renamed.replace('{#payment}', '{#changed}'), renamed + '\n## Duplicate {#payment}\nBad']) {
    assert.notEqual((await invoke(`contract[${c.id}]`, 'update', '--text', invalid)).code, 0);
    assert.equal(w.read(c.file), renamed);
  }
  await run('task[T-0001].contract', 'attach', '--id', c.id);
  assert.equal((await run('task[T-0001]', 'show')).context.contracts[0].sections, undefined);
  await run('task[T-0001].contract', 'remove', '--id', c.id);
  assert.deepEqual((await run('task[T-0001]', 'show')).context.contracts[0].sections, ['payment']);
});

test('Contract stacks wire each selected section to its task, collapse and restore section navigation', async t => {
  const { w, run } = setup(t);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Materials', '--text', sectionedContract)).contract;
  await run('task[T-0001].contract', 'attach', '--id', `${c.id}#identity`);
  const next = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Payment', '--contract', `${c.id}#payment`)).task;
  const page = await openViewer(w.paths.indexHtmlFile); t.after(() => page.close());
  const line = () => page.document.querySelector(`.edge-contract[data-section="identity"][data-to="T-0001"]`)!;
  const expandedPath = line().getAttribute('d');
  assert.equal(page.document.querySelectorAll('.contract-section').length, 3);
  assert.equal(page.document.querySelectorAll('.contract-sheet').length, 2);
  assert.equal(page.document.querySelector('.edge-contract[data-section="common"]'), null);
  click(page, page.document.querySelector('.contract-section[data-section="identity"]')!);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /IDENTITY_ONLY/);
  assert.doesNotMatch(page.document.querySelector('#details-body')!.textContent!, /PAYMENT_ONLY|COMMON_ONLY/);
  const restored = await openViewer(w.paths.indexHtmlFile, { hash: page.window.location.hash }); t.after(() => restored.close());
  assert.match(restored.document.querySelector('#details-body')!.textContent!, /IDENTITY_ONLY/);
  click(page, page.document.querySelector('[data-contract-toggle]')!);
  await waitForLayout(page);
  assert.equal(page.document.querySelectorAll('.contract-section').length, 0);
  assert.notEqual(line().getAttribute('d'), expandedPath);
  click(page, page.document.querySelector('[data-contract-toggle]')!);
  await waitForLayout(page);
  assert.equal(line().getAttribute('d'), expandedPath);
  const child = await openViewer(w.paths.indexHtmlFile, { hash: `#graph=${next.graph}` }); t.after(() => child.close());
  assert.ok(child.document.querySelector(`.edge-contract[data-section="payment"][data-to="${next.id}"]`));
  assert.ok(child.document.querySelector(`[data-contract="${c.id}"]`));
  assert.deepEqual(page.errors, []); assert.deepEqual(restored.errors, []); assert.deepEqual(child.errors, []);
});

test('Contracts are distinct shared nodes, update one text, and do not satisfy execution dependencies', async t => {
  const { w, run, invoke } = setup(t);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Payment', '--text', '# Payment\nCurrent v1', '--task', 'T-0001')).contract;
  assert.equal(c.id, 'C-0001'); assert.equal(c.status, undefined);
  const child = (await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Nested consumer', '--contract', c.id)).task;
  assert.equal((await run(`task[${child.id}]`, 'show')).task.readiness, 'ready');
  const waiting = (await run('task', 'add', '--graph', child.graph, '--summary', 'Wait for implementation', '--contract', c.id, '--depends-on', child.id)).task;
  assert.equal((await run(`task[${waiting.id}]`, 'show')).task.readiness, 'unready');
  assert.notEqual((await invoke(`task[${waiting.id}]`, 'start')).code, 0);
  const before = w.read(`.task-graph/tasks/${child.id}.md`);
  await run(`contract[${c.id}]`, 'update', '--text', '# Payment\nCurrent v2');
  assert.equal(w.read(`.task-graph/tasks/${child.id}.md`), before);
  assert.match((await run(`contract[${c.id}]`, 'show')).contract.body, /Current v2/);
  assert.match((await run(`task[${child.id}]`, 'show', '--handoff', '--expand', 'contract')).handoff, /Current v2/);
  assert.match((await run(`task[${child.id}]`, 'show', '--expand', 'contract')).context.contracts[0].body, /Current v2/);
  assert.equal((await run(`task[${child.id}]`, 'show', '--exclude-path', c.file)).context.contracts, undefined);
  const linked = (await run(`task[${child.id}].contract`, 'list')).entries;
  assert.equal(linked.length, 1); assert.equal(linked[0].read_path, c.file);
  assert.equal(readKnowledge(w.root).contracts.length, 1);
  assert.equal((await run(`contract[${c.id}]`, 'describe')).actions.some((a: {action: string}) => a.action === 'complete'), false);
});

test('Code references enforce short entries, deduplicate and propagate updates without embedding source bodies', async t => {
  const { w, run, invoke } = setup(t);
  w.write('api.ts', 'export function pay() { return "PRIVATE_SOURCE_BODY"; }\n// second line');
  const added = await run('task[T-0001].reference', 'add', '--path', 'api.ts', '--line', '1', '--symbol', 'pay', '--summary', '付款入口');
  const r = added.reference;
  const same = await run('reference', 'add', '--path', 'api.ts', '--line', '1', '--symbol', 'pay', '--summary', '付款入口');
  assert.equal(same.reference.id, r.id);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Payment', '--text', 'Rule', '--reference', r.id)).contract;
  const next = (await run('task', 'add', '--summary', 'Consumer', '--depends-on', 'T-0001', '--contract', c.id, '--reference', r.id)).task.id;
  let context = (await run(`task[${next}]`, 'show')).context;
  assert.equal(context.code_references.length, 1);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_SOURCE_BODY/);
  await run(`reference[${r.id}]`, 'update', '--path', 'api.ts', '--line', '2', '--symbol', 'pay', '--summary', '付款预览与提交共用入口');
  context = (await run(`task[${next}]`, 'show')).context;
  assert.equal(context.code_references[0].line, 2);
  assert.equal((await run(`contract[${c.id}].reference`, 'list')).entries[0].id, r.id);
  const before = w.read('.task-graph/knowledge.json');
  for (const summary of ['中'.repeat(31), 'two\nlines', '']) {
    assert.notEqual((await invoke('reference', 'add', '--path', 'api.ts', '--line', '1', '--symbol', 'other', '--summary', summary)).code, 0);
    assert.equal(w.read('.task-graph/knowledge.json'), before);
  }
  w.write('report.md', 'Not a code reference');
  assert.notEqual((await invoke('task[T-0001].reference', 'attach', '--path', 'report.md')).code, 0);
  assert.notEqual((await invoke('reference', 'add', '--path', 'report.md', '--line', '1', '--symbol', 'rule', '--summary', '规则')).code, 0);
  assert.equal((await run('reference', 'add', '--path', 'api.ts', '--line', '1', '--symbol', 'emoji', '--summary', '😀'.repeat(30))).reference.summary, '😀'.repeat(30));
});

test('Decision recording is atomic and replayable, freezes its evidence and leaves consumers pending', async t => {
  const { w, run, invoke } = setup(t);
  const request = ['decision', 'record', '--key', 'payment-policy', '--graph', 'G-001', '--title', 'Payment policy', '--text', '# Rule\nOne payment', '--task', 'T-0001', '--actor', 'controller'];
  const result = await run(...request);
  assert.equal(result.saved, true); assert.equal(result.view.status, 'refreshed'); assert.equal(result.task.status, 'done');
  const task = readTaskDocument(w.root, result.task.id), consumer = readTaskDocument(w.root, 'T-0001');
  assert.deepEqual(consumer.contracts, [result.contract.id]); assert.equal(consumer.status, 'todo'); assert.deepEqual(consumer.dependsOn, []);
  assert.deepEqual(task.history.map(h => h.event), ['created', 'started', 'contract_attached', 'report_attached', 'completed']);
  assert.match(task.history[1]!.extra['reason'] as string, /已定决策/);
  const before = w.read(`.task-graph/tasks/${task.id}.md`);
  const replay = await run(...request);
  assert.equal(replay.reused, true); assert.equal(replay.task.id, task.id); assert.equal(w.read(`.task-graph/tasks/${task.id}.md`), before);
  assert.notEqual((await invoke(...request.map(v => v === '# Rule\nOne payment' ? 'Changed rule' : v))).code, 0);
  await run('decision', 'record', '--key', 'payment-policy-v2', '--graph', 'G-001', '--contract', result.contract.id, '--title', 'Revised payment', '--text', '# Rule\nNew payment');
  assert.equal(readKnowledge(w.root).contracts.length, 1);
  assert.match(w.read(result.contract.file), /New payment/);
  assert.match(w.read(task.content!), /One payment/);
  assert.match(w.read(task.outputs[0]!.snapshot!), /One payment/);
  assert.equal(readTaskDocument(w.root, 'T-0001').status, 'todo');
});

test('A rejected consumer binding rolls back the entire decision including text, IDs and audit snapshot', async t => {
  const { w } = setup(t);
  const before = new Map(w.listFiles().map(f => [f, w.readBuffer(f)]));
  assert.throws(() => recordDecision(w.root, { key: 'invalid', graph: 'G-001', title: 'Invalid', text: 'New rule', tasks: ['T-0001', 'T-9999'] }), /Unknown task/);
  assert.deepEqual(w.listFiles(), [...before.keys()]);
  for (const [file, bytes] of before) assert.deepEqual(w.readBuffer(file), bytes);
});

test('View generation failure reports saved state; retry never creates a second decision', async t => {
  const { w, run } = setup(t);
  const file = w.file('.task-graph/generated/graph.json');
  rmSync(file); mkdirSync(file);
  const args = ['decision', 'record', '--key', 'view-failure', '--graph', 'G-001', '--title', 'Rule', '--text', 'Contract'];
  const result = await run(...args);
  assert.equal(result.saved, true); assert.equal(result.view.status, 'failed'); assert.equal(result.view.retry.action, 'build'); assert.equal(result.view.retry.cwd, w.root);
  const replay = await run(...args);
  assert.equal(replay.reused, true); assert.equal(replay.task.id, result.task.id);
  assert.equal(readKnowledge(w.root).decisions.length, 1);
  rmdirSync(file); await run('.', 'build');
  assert.equal(JSON.parse(w.read('.task-graph/generated/graph.json')).contracts.length, 1);
});

test('Offline contract nodes open current text and code entries, retain hash selection, and escape markup', async t => {
  const { w, run } = setup(t);
  w.write('entry.ts', 'export const entry = 1;');
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Shared <rule>', '--text', '# Current contract\nAuthoritative body', '--task', 'T-0001')).contract;
  await run(`contract[${c.id}].reference`, 'add', '--path', 'entry.ts', '--line', '1', '--symbol', '<img src=x>', '--summary', '<script>x</script>');
  const page = await openViewer(w.paths.indexHtmlFile); t.after(() => page.close());
  const node = page.document.querySelector(`[data-kind="contract"][data-contract="${c.id}"]`)!;
  assert.ok(node); assert.ok(page.document.querySelector('.edge-contract'));
  assert.equal(node.hasAttribute('data-task'), false);
  click(page, node);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /Authoritative body/);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /entry.ts:1/);
  assert.equal(page.document.querySelector('#details-body img'), null);
  assert.equal(page.document.querySelector('#details-body script'), null);
  const restored = await openViewer(w.paths.indexHtmlFile, { hash: page.window.location.hash }); t.after(() => restored.close());
  assert.match(restored.document.querySelector('#details-body')!.textContent!, /Authoritative body/);
  click(page, taskNode(page, 'T-0001'));
  click(page, page.document.querySelector('[data-panel="codeReferences"]')!);
  assert.match(page.document.querySelector('#details-body')!.textContent!, /entry.ts:1/);
  assert.deepEqual(page.errors, []); assert.deepEqual(restored.errors, []);
});

test('JSON task plans bind contracts and entries atomically, rejecting unknown contract IDs', async t => {
  const { w, run, invoke } = setup(t);
  const c = (await run('contract', 'add', '--graph', 'G-001', '--title', 'Rule', '--text', 'Current')).contract;
  w.write('plan.json', JSON.stringify({ tasks: [{ summary: 'Planned', contracts: [c.id] }] }));
  const added = await run('task', 'add', '--from', w.file('plan.json'));
  assert.deepEqual(readTaskDocument(w.root, added.tasks[0].id).contracts, [c.id]);
  w.write('plan.json', JSON.stringify({ tasks: [{ summary: 'Bad', contracts: ['C-9999'] }] }));
  assert.notEqual((await invoke('task', 'add', '--from', w.file('plan.json'))).code, 0);
  assert.equal((await run('task', 'list')).tasks.length, 2);
});

test('Review receives a frozen contract and later contract edits cannot rewrite that review input', t => {
  const { w } = setup(t);
  const c = saveContract(w.root, { graph: 'G-001', title: 'Rule', text: 'Original contract', tasks: ['T-0001'] }).contract;
  w.write('rr.md', '# Check\nVerify original contract.');
  attachDocument(w.root, { id: 'T-0001', path: 'rr.md', kind: 'review-requirement' });
  configureReview(w.root, 'T-0001', true, {});
  startTask(w.root, { id: 'T-0001' });
  completeTask(w.root, { id: 'T-0001' });
  const run = currentReview(readReviewState(w.root), 'T-0001')!;
  const frozen = run.materials.find(f => f.kind === 'contract')!;
  assert.ok(frozen); assert.equal(frozen.source_task, 'T-0001');
  saveContract(w.root, { id: c.id, text: 'Later contract' });
  assert.equal(w.read(frozen.read_path), 'Original contract');
  assert.equal(w.read(c.file), 'Later contract');
  assert.equal(readTaskDocument(w.root, 'T-0001').status, 'pending_review');
});
