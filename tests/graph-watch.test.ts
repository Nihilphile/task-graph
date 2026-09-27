import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { useTempWorkspace } from './helpers/temp.js';
import { readWatchLedger, deliverWatch, watchGraph, unwatchGraph } from '../src/core/watch.js';
import { type DesktopAdapter, desktopAdapter, parseDesktopReceipt, runDesktopProcess } from '../src/core/desktop-notify.js';
import { startTask, completeTask } from '../src/core/lifecycle.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { retryWatchEvent } from '../src/core/watch.js';
import { serializeTaskDocument } from '../src/core/task.js';

test('Result notifications survive persisted history ordering for pass, reject and reasons', async t => {
  for (const result of [undefined, 'pass', 'reject'] as const) {
    for (const reason of [undefined, '验收证据已核对']) {
      const w = useTempWorkspace(t, 'watch-result-order');
      initializeProject(w.root, { name: 'Result order', task: 'Work' });
      let sent = 0;
      const adapter: DesktopAdapter = { inspect: async () => binding, submit: async () => {
        sent++; return { state: 'accepted', receipt: 'fixture' };
      } };
      await watchGraph(w.root, 'G-001', thread, adapter);
      startTask(w.root, { id: 'T-0001' });
      w.write('error.md', '# Failure analysis');
      completeTask(w.root, { id: 'T-0001', result, reason, ...(result === 'reject' ? { errorReport: 'error.md' } : {}) });
      await deliverWatch(w.root, adapter, { singlePass: true });
      assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'accepted', `${result ?? 'implicit pass'} / ${reason ?? 'no reason'}`);
      await deliverWatch(w.root, adapter, { singlePass: true });
      assert.equal(sent, 1);
    }
  }
});

test('Legacy paused result IDs retry without replacing the event or sending automatically', async t => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  for (const result of ['pass', 'reject'] as const) {
    const w = useTempWorkspace(t, 'watch-legacy-order');
    initializeProject(w.root, { name: 'Legacy result', task: 'Work' });
    const sent: string[] = [];
    const adapter: DesktopAdapter = { inspect: async () => binding, submit: async (_binding, _thread, message) => {
      sent.push(message); return { state: 'accepted', receipt: 'fixture' };
    } };
    await watchGraph(w.root, 'G-001', thread, adapter);
    startTask(w.root, { id: 'T-0001' });
    const reason = result === 'reject' ? undefined : '明确结论';
    w.write('error.md', '# Failure analysis');
    const task = completeTask(w.root, { id: 'T-0001', result, reason, ...(result === 'reject' ? { errorReport: 'error.md' } : {}) });
    const ledger = readWatchLedger(w.root)!;
    const event = ledger.events[0]!;
    const terminal = task.history.at(-1)!;
    const legacyHistory = { ...terminal, extra: { from: terminal.extra['from']!, to: terminal.extra['to']!, result,
      ...(reason === undefined ? {} : { reason }) } };
    w.write('.task-graph/tasks/T-0001.md', serializeTaskDocument({ ...task, history: [...task.history.slice(0, -1), legacyHistory] }));
    const source = hash(JSON.stringify([task.id, task.history.length, legacyHistory]));
    const legacyId = hash(event.subscription + ':' + source);
    event.message = event.message.replaceAll(event.id, legacyId);
    event.id = legacyId;
    event.state = 'paused';
    event.error = 'The recorded task result is missing; restore the committed task history before delivery';
    w.write('.task-graph/watch.json', JSON.stringify(ledger));
    await deliverWatch(w.root, adapter, { singlePass: true });
    assert.equal(sent.length, 0);
    retryWatchEvent(w.root, legacyId, false, 'G-001');
    await deliverWatch(w.root, adapter, { singlePass: true });
    const saved = readWatchLedger(w.root)!.events;
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.id, legacyId);
    assert.equal(saved[0]!.state, 'accepted');
    assert.ok(sent[0]!.includes(legacyId));
    await deliverWatch(w.root, adapter, { singlePass: true });
    assert.equal(sent.length, 1);
  }
});

test('Legacy compatibility still rejects altered result evidence', async t => {
  const w = useTempWorkspace(t, 'watch-altered-result');
  initializeProject(w.root, { name: 'Altered result', task: 'Work' });
  let sent = 0;
  const adapter: DesktopAdapter = { inspect: async () => binding, submit: async () => {
    sent++; return { state: 'accepted', receipt: 'fixture' };
  } };
  await watchGraph(w.root, 'G-001', thread, adapter);
  startTask(w.root, { id: 'T-0001' });
  w.write('error.md', '# Failure analysis');
  const task = completeTask(w.root, { id: 'T-0001', result: 'reject', reason: 'original-evidence', errorReport: 'error.md' });
  const ledger = readWatchLedger(w.root)!;
  const event = ledger.events[0]!;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const terminal = task.history.at(-1)!;
  const legacyHistory = { ...terminal, extra: { from: terminal.extra['from']!, to: terminal.extra['to']!, result: 'reject', reason: 'original-evidence' } };
  w.write('.task-graph/tasks/T-0001.md', serializeTaskDocument({ ...task, history: [...task.history.slice(0, -1), legacyHistory] }));
  event.id = hash(event.subscription + ':' + hash(JSON.stringify([task.id, task.history.length, legacyHistory])));
  w.write('.task-graph/watch.json', JSON.stringify(ledger));
  w.write('.task-graph/tasks/T-0001.md', w.read('.task-graph/tasks/T-0001.md').replace('original-evidence', 'changed-evidence'));
  await deliverWatch(w.root, adapter, { singlePass: true });
  assert.equal(sent, 0);
  assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'paused');
});

const thread = '01a0d067-d9fc-7cd1-b278-4b068b7a7169';
const binding = { executable: 'fixture', version: 'fixture-v1', home: 'fixture-profile' };

test('Explicit graph watch covers child results, is idempotent, never backfills and unwatch cancels unsent events', async t => {
  const w = useTempWorkspace(t, 'watch');
  initializeProject(w.root, { name: 'Watch', task: 'Parent' });
  const sent: string[] = [];
  let currentBinding = binding;
  const adapter: DesktopAdapter = { inspect: async () => currentBinding, submit: async (_b, target, message) => { assert.equal(target, thread); sent.push(message); return { state: 'accepted', receipt: 'fixture-receipt' }; } };
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, desktopAdapter: adapter, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  const old = (await run('task', 'add', '--summary', 'Earlier')).task.id;
  await run('task', 'start', old); await run('task', 'complete', old);
  assert.equal(readWatchLedger(w.root), undefined);
  assert.notEqual((await run('graph', 'watch', 'G-001')).code, 0);
  const first = await run('graph', 'watch', 'G-001', '--thread', thread);
  assert.equal(first.code, 0);
  assert.match(w.read('.task-graph/.gitignore'), /\/watch\.json/);
  assert.equal((await run('graph', 'watch', 'G-001', '--thread', thread)).subscription.id, first.subscription.id);
  currentBinding = { ...binding, executable: 'updated-desktop' };
  assert.equal((await run('graph', 'watch', 'G-001', '--thread', thread)).subscription.id, first.subscription.id);
  assert.equal(readWatchLedger(w.root)!.subscriptions[0]!.binding.executable, 'updated-desktop');
  currentBinding = { ...binding, home: 'different-profile' };
  assert.notEqual((await run('graph', 'watch', 'G-001', '--thread', thread)).code, 0);
  assert.equal(readWatchLedger(w.root)!.subscriptions[0]!.binding.home, binding.home);
  currentBinding = binding;
  assert.equal(readWatchLedger(w.root)!.events.length, 0);
  const child = (await run('task', 'add', '--summary', 'Child', '--parent-task', 'T-0001')).task.id;
  w.write('report.md', 'PRIVATE_BODY_NOT_IN_NOTIFICATION');
  await run('task', 'start', child); await run('task', 'complete', child, '--report', 'report.md');
  assert.equal(readWatchLedger(w.root)!.events.length, 1);
  const before = w.read('.task-graph/watch.json');
  assert.equal((await run('graph', 'watch', 'G-001', '--status')).counts.pending, 1);
  assert.equal(w.read('.task-graph/watch.json'), before);
  await run('graph', 'watch', 'G-001', '--flush');
  assert.equal(sent.length, 1); assert.ok(!sent[0]!.includes('PRIVATE_BODY'));
  assert.ok(sent[0]!.includes('report.md')); assert.ok(sent[0]!.includes('"result":"pass"'));
  await run('task', 'reopen', child);
  w.write('report.md', 'New failed verification');
  assert.equal((await run('task', 'reject', child, '--report', 'report.md', '--error-report', 'report.md')).code, 0);
  assert.equal(readWatchLedger(w.root)!.events[1]!.result, 'reject');
  await run('graph', 'unwatch', 'G-001', '--thread', thread);
  await run('graph', 'watch', 'G-001', '--flush');
  assert.equal(sent.length, 1);
  assert.equal(readWatchLedger(w.root)!.events[1]!.state, 'cancelled');
  await run('graph', 'watch', 'G-001', '--thread', thread);
  assert.equal(readWatchLedger(w.root)!.events.length, 2);
});

test('Uncertain delivery and interrupted owner are never blindly resent', async t => {
  const w = useTempWorkspace(t, 'watch-unknown');
  initializeProject(w.root, { name: 'Watch', task: 'Work' });
  let count = 0;
  const adapter: DesktopAdapter = { inspect: async () => binding, submit: async () => { count++; return { state: 'uncertain', error: 'Receipt lost' }; } };
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, desktopAdapter: adapter, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  await run('graph', 'watch', 'G-001', '--thread', thread);
  await run('task', 'start', 'T-0001'); await run('task', 'complete', 'T-0001');
  await deliverWatch(w.root, adapter); await deliverWatch(w.root, adapter);
  assert.equal(count, 1);
  const id = readWatchLedger(w.root)!.events[0]!.id;
  assert.notEqual((await run('graph', 'watch', 'G-001', '--retry', id)).code, 0);
  assert.equal((await run('graph', 'watch', 'G-001', '--retry', id, '--allow-duplicate')).code, 0);
  const state = readWatchLedger(w.root)!;
  state.events[0]!.state = 'in_flight'; state.worker = { pid: process.pid, token: 'old', heartbeat: 0 };
  w.write('.task-graph/watch.json', JSON.stringify(state));
  await deliverWatch(w.root, adapter);
  assert.equal(count, 1); assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'uncertain');
});

test('Desktop subprocess preserves Chinese multiline arguments; only exact target receipt proves acceptance', async t => {
  const w = useTempWorkspace(t, 'desktop-argv');
  w.write('queue-fixture.cjs', 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  const message = '中文第一行\n第二行 "quoted" $literal';
  const result = await runDesktopProcess(process.execPath, [path.join(w.root, 'queue-fixture.cjs'), 'queue', '--thread', thread, '--message', message], w.root);
  assert.deepEqual(JSON.parse(result.output), ['queue', '--thread', thread, '--message', message]);
  assert.equal(parseDesktopReceipt(result, thread).state, 'uncertain');
  assert.equal(parseDesktopReceipt({ ...result, output: `Queued message receipt for thread ${thread}.` }, thread).state, 'accepted');
  assert.equal(parseDesktopReceipt({ ...result, output: `Queued message receipt for thread ${thread}.`, uncertain: true }, thread).state, 'uncertain');
  assert.equal(parseDesktopReceipt({ ...result, output: `Queued message receipt for thread ${thread}.` }, 'ffffffff-ffff-ffff-ffff-ffffffffffff').state, 'uncertain');
});

test('Durable queue resumes once per subscription, honors a live owner and bounds provably unstarted retries', async t => {
  const w = useTempWorkspace(t, 'watch-recovery');
  initializeProject(w.root, { name: 'Recovery', task: 'Work' });
  const other = '11111111-2222-3333-4444-555555555555';
  let submits = 0;
  const adapter: DesktopAdapter = { inspect: async () => binding, submit: async () => { submits++; return { state: 'not_started', error: 'Missing executable' }; } };
  await watchGraph(w.root, 'G-001', thread, adapter); await watchGraph(w.root, 'G-001', other, adapter);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  assert.equal(readWatchLedger(w.root)!.events.length, 2);
  const busy = readWatchLedger(w.root)!;
  busy.worker = { pid: process.pid, token: 'live-owner', heartbeat: Date.now() };
  w.write('.task-graph/watch.json', JSON.stringify(busy));
  await deliverWatch(w.root, adapter, { singlePass: true });
  assert.equal(submits, 0);
  delete busy.worker; w.write('.task-graph/watch.json', JSON.stringify(busy));
  unwatchGraph(w.root, 'G-001', other);
  for (let i = 0; i < 4; i++) {
    const ledger = readWatchLedger(w.root)!; ledger.events[0]!.nextAttemptAt = 0;
    w.write('.task-graph/watch.json', JSON.stringify(ledger));
    await deliverWatch(w.root, adapter, { singlePass: true });
  }
  assert.equal(submits, 4);
  assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'paused');
  assert.equal(readWatchLedger(w.root)!.events[1]!.state, 'cancelled');
  await deliverWatch(w.root, adapter, { singlePass: true }); assert.equal(submits, 4);
});

test('Desktop version gate prevents queue; timeout and excess output are uncertain', async t => {
  const w = useTempWorkspace(t, 'desktop-limits');
  const unsupported = await desktopAdapter.submit({ executable: process.execPath, home: w.root, version: 'codex-cli 0.153.4' }, thread, 'must not queue');
  assert.equal(unsupported.state, 'paused');
  const absent = await runDesktopProcess(path.join(w.root, 'not-installed.exe'), [], w.root);
  assert.equal(parseDesktopReceipt(absent, thread).state, 'not_started');
  w.write('hang.cjs', 'setInterval(() => {}, 1000)');
  const timed = await runDesktopProcess(process.execPath, [path.join(w.root, 'hang.cjs')], w.root, 100);
  assert.equal(parseDesktopReceipt(timed, thread).state, 'uncertain');
  w.write('noisy.cjs', 'process.stdout.write("x".repeat(10000))');
  const noisy = await runDesktopProcess(process.execPath, [path.join(w.root, 'noisy.cjs')], w.root);
  assert.equal(noisy.uncertain, true);
  assert.equal(parseDesktopReceipt(noisy, thread).state, 'uncertain');
});

test('A partial filesystem commit cannot notify a result missing from durable task history', async t => {
  const w = useTempWorkspace(t, 'watch-partial');
  initializeProject(w.root, { name: 'Partial write', task: 'Work' });
  let sent = 0;
  const adapter: DesktopAdapter = { inspect: async () => binding, submit: async () => { sent++; return { state: 'accepted', receipt: 'fixture' }; } };
  await watchGraph(w.root, 'G-001', thread, adapter);
  startTask(w.root, { id: 'T-0001' });
  const before = w.read('.task-graph/tasks/T-0001.md');
  completeTask(w.root, { id: 'T-0001' });
  w.write('.task-graph/tasks/T-0001.md', before);
  await deliverWatch(w.root, adapter, { singlePass: true });
  assert.equal(sent, 0);
  assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'paused');
});
