import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { useTempWorkspace } from './helpers/temp.js';
import { attachDocument } from '../src/core/documents.js';
import { completeTask, startTask } from '../src/core/lifecycle.js';
import { configureReview, startReview, finishReview, restartReview, failReview, updateRun, recoverReviews, markReviewing } from '../src/core/review.js';
import { readReviewState, currentReview } from '../src/core/review-state.js';
import { executeReview } from '../src/core/review-runner.js';
import { watchGraph, readWatchLedger, deliverWatch } from '../src/core/watch.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { computeReadiness } from '../src/core/readiness.js';
import { click, openViewer, taskNode } from './helpers/viewer-dom.js';

const adapter = { inspect: async () => ({ executable: 'fixture', version: 'fixture', home: 'fixture' }), submit: async () => ({ state: 'accepted' as const, receipt: 'receipt' }) };
function fixture(t: TestContext) {
  const w = useTempWorkspace(t, 'review'); initializeProject(w.root, { name: 'Review', task: 'Work' });
  w.write('rr.md', '# 验收\n交付 answer.txt 包含 42。'); w.write('answer.txt', '42');
  attachDocument(w.root, { id: 'T-0001', path: 'rr.md', kind: 'review-requirement', summary: '可核实的标准' });
  const run = () => currentReview(readReviewState(w.root), 'T-0001')!;
  const task = () => loadTaskRepository(w.root).taskById('T-0001')!;
  const running = () => { updateRun(w.root, run().id, r => { r.state = 'running'; }); markReviewing(w.root,'T-0001',run().id,'fixture-session'); };
  const cli = async (...args: string[]) => {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, env: { TASK_GRAPH_REVIEW_NO_SPAWN: '1' }, desktopAdapter: adapter, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  };
  return { ...w, run, task, running, cli };
}

test('RR resource supports multiple files, manifests, explicit expansion, HTML and guarded removal', async t => {
  const w = fixture(t);
  w.write('rr2.md', '# 第二条\n明确边界');
  assert.equal((await w.cli('task[T-0001].review-requirement', 'attach', '--path', 'rr2.md')).code, 0);
  const list = await w.cli('task[T-0001].review-requirement', 'list'); assert.equal(list.files.length, 2);
  const show = await w.cli('task[T-0001]', 'show'); assert.equal(show.context.review_requirements.length, 2);
  assert.ok(!JSON.stringify(show.context).includes('明确边界'));
  assert.ok(JSON.stringify(await w.cli('task[T-0001]', 'show', '--expand', 'review-requirement')).includes('明确边界'));
  assert.equal((await w.cli('task[T-0001].auto-review', 'enable')).code, 0);
  assert.equal((await w.cli('task[T-0001].review-requirement', 'remove', '--path', 'rr2.md')).code, 0);
  assert.notEqual((await w.cli('task[T-0001].review-requirement', 'remove', '--path', 'rr.md')).code, 0);
  const page = await openViewer(path.join(w.root, '.task-graph/generated/index.html')); t.after(() => page.close());
  click(page, taskNode(page, 'T-0001').querySelector('[data-panel="reviewRequirements"]')!);
  assert.equal(page.document.querySelectorAll('.document-item').length, 1);
});

test('graph scan skips absent/broken RR and explicit off; defaults and per-task model overrides remain discoverable', async t => {
  const w = fixture(t);
  const missing = (await w.cli('task', 'add', '--summary', 'No RR')).task.id;
  const off = (await w.cli('task', 'add', '--summary', 'Explicit off')).task.id;
  await w.cli(`task[${off}].review-requirement`, 'attach', '--path', 'rr.md');
  await w.cli(`task[${off}].auto-review`, 'disable');
  const scan = await w.cli('graph[G-001].auto-review', 'enable', '--model', 'custom', '--reasoning', 'high');
  assert.equal(scan.code, 0); assert.equal(scan.results.find((r: any) => r.task === missing).result, 'missing_rr');
  assert.equal(scan.results.find((r: any) => r.task === off).result, 'explicitly_disabled');
  assert.equal((await w.cli('task[T-0001].auto-review', 'status', '--detail')).review.config.model, 'custom');
  w.write('rr.md', '   ');
  const rescanned = await w.cli('graph[G-001].auto-review', 'enable');
  assert.equal(rescanned.results.find((r: any) => r.task === 'T-0001').result, 'invalid_rr');
  assert.notEqual((await w.cli(`task[${off}].auto-review`, 'enable')).code, 0);
  assert.notEqual((await w.cli('task[T-0001]', 'start')).code, 0);
});

test('auto complete submits, releases claim and gates dependencies; finish commits exact report and one notification', async t => {
  const w = fixture(t);
  await watchGraph(w.root, 'G-001', '11111111-2222-3333-4444-555555555555', adapter);
  const successor = (await w.cli('task', 'add', '--summary', 'Next', '--depends-on', 'T-0001')).task.id;
  configureReview(w.root, 'T-0001', true, {});
  startTask(w.root, { id: 'T-0001', role: 'worker', sessionId: 'worker-id' });
  w.write('implementation.md', '# done');
  completeTask(w.root, { id: 'T-0001', reports: ['implementation.md'] });
  assert.equal(w.task().status, 'pending_review'); assert.equal(w.task().claim, null);
  assert.equal(readWatchLedger(w.root)!.events.length, 0);
  assert.equal(computeReadiness(loadTaskRepository(w.root)).get(successor)!.readiness, 'unready');
  assert.throws(() => completeTask(w.root, { id: 'T-0001' }));
  assert.notEqual((await w.cli('task[T-0001]', 'claim', '--role', 'worker', '--session-id', 'wrong')).code, 0);
  w.running(); w.write(w.run().reportPath, '# 验收通过\n读取 answer.txt，值为 42。');
  assert.equal(w.task().status, 'reviewing'); assert.equal(readWatchLedger(w.root)!.events.length, 0);
  const runningHistory = w.task().history.length;
  markReviewing(w.root, 'T-0001', w.run().id, 'fixture-session');
  assert.equal(w.task().history.length, runningHistory);
  assert.equal((await w.cli('task', 'list', '--status', 'reviewing')).tasks.length, 1);
  assert.throws(() => configureReview(w.root, 'T-0001', false, {}), /before starting/);
  assert.throws(() => attachDocument(w.root, { id: 'T-0001', path: 'answer.txt', kind: 'content' }), /fixed during review/);
  assert.throws(() => completeTask(w.root, { id: 'T-0001' }));
  assert.equal(computeReadiness(loadTaskRepository(w.root)).get(successor)!.readiness, 'unready');
  const page = await openViewer(w.file('.task-graph/generated/index.html')); t.after(() => page.close());
  assert.match(taskNode(page,'T-0001').textContent!, /审查中/);
  assert.ok(page.document.querySelector('[data-status-filter="reviewing"]'));
  const options = { id: 'T-0001', reviewId: w.run().id, result: 'pass' as const, report: w.run().reportPath };
  finishReview(w.root, options); finishReview(w.root, options);
  assert.equal(w.task().status, 'done'); assert.equal(readWatchLedger(w.root)!.events.length, 1);
  markReviewing(w.root,'T-0001',w.run().id,'fixture-session');assert.equal(w.task().status,'done');
  assert.equal(computeReadiness(loadTaskRepository(w.root)).get(successor)!.readiness, 'ready');
  assert.match(readWatchLedger(w.root)!.events[0]!.message, /review_id/);
  assert.ok(!readWatchLedger(w.root)!.events[0]!.message.includes('implementation.md'));
  await deliverWatch(w.root, adapter, { singlePass: true }); assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'accepted');
});

test('manual review reopens acceptance without rolling back running successors; blocked restart preserves delivery and rejects stale finish', async t => {
  const w = fixture(t);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  const successor = (await w.cli('task', 'add', '--summary', 'Already started', '--depends-on', 'T-0001')).task.id;
  startTask(w.root, { id: successor });
  startReview(w.root, { id: 'T-0001', config: { model: 'custom' } });
  const old = w.run(); w.running(); w.write(old.reportPath, '# blocked\n环境缺失');
  finishReview(w.root, { id: 'T-0001', reviewId: old.id, result: 'blocked', report: old.reportPath });
  assert.equal(w.task().status, 'blocked'); assert.equal(w.task().blockedFrom, 'pending_review'); assert.equal(loadTaskRepository(w.root).taskById(successor)!.status, 'in_progress');
  restartReview(w.root, 'T-0001'); assert.notEqual(w.run().id, old.id); assert.deepEqual(w.run().delivery, old.delivery); assert.deepEqual(w.run().materials, old.materials);
  assert.throws(() => finishReview(w.root, { id: 'T-0001', reviewId: old.id, result: 'pass', report: old.reportPath }), /no longer current/);
  w.running(); w.write(w.run().reportPath, '# reject\n证据不符合 RR');
  finishReview(w.root, { id: 'T-0001', reviewId: w.run().id, result: 'reject', report: w.run().reportPath, errorReport: w.run().reportPath });
  assert.equal(w.task().status, 'reject');
});

test('Git dirty and untracked delivery bytes are frozen; live source changes prevent false pass but allow blocked', async t => {
  const w = fixture(t);
  execFileSync('git', ['init'], { cwd: w.root, stdio: 'ignore' });
  execFileSync('git', ['add', 'answer.txt'], { cwd: w.root }); w.write('answer.txt', 'dirty 42'); w.write('extra.txt', 'untracked');
  chmodSync(path.join(w.root, 'answer.txt'), 0o755);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  startReview(w.root, { id: 'T-0001' }); const frozen = w.run();
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: frozen.delivery.workspace }).toString().trim();
  assert.equal(statSync(top).ino, statSync(frozen.delivery.workspace).ino);
  assert.equal(statSync(path.join(frozen.delivery.workspace, 'answer.txt')).mode & 0o777, statSync(path.join(w.root, 'answer.txt')).mode & 0o777);
  assert.ok(frozen.delivery.files.some(f => f.path === 'extra.txt')); assert.equal(w.read(path.relative(w.root, path.join(frozen.delivery.workspace, 'answer.txt'))), 'dirty 42');
  failReview(w.root, 'T-0001', frozen.id, 'test failure');
  // A separate project exercises live validation without changing submission mode on restart.
  const live = fixture(t); startTask(live.root, { id: 'T-0001' }); completeTask(live.root, { id: 'T-0001' });
  startReview(live.root, { id: 'T-0001', config: { mode: 'live' } }); live.running();
  live.write('answer.txt', 'changed'); live.write(live.run().reportPath, '# 环境变化');
  const opts = { id: 'T-0001', reviewId: live.run().id, report: live.run().reportPath };
  assert.throws(() => finishReview(live.root, { ...opts, result: 'pass' }), /changed/);
  finishReview(live.root, { ...opts, result: 'blocked' }); assert.equal(live.task().status, 'blocked');
});

test('dead worker recovery warns once, refuses live process restart and cancels obsolete review notifications', async t => {
  const w = fixture(t); await watchGraph(w.root, 'G-001', '11111111-2222-3333-4444-555555555555', adapter);
  configureReview(w.root, 'T-0001', true, {}); startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  w.running(); recoverReviews(w.root); recoverReviews(w.root);
  assert.equal(w.run().state, 'failed'); assert.equal(readWatchLedger(w.root)!.events.length, 1);
  updateRun(w.root, w.run().id, r => { r.childPid = process.pid; }); assert.throws(() => restartReview(w.root, 'T-0001'), /still be alive/);
  updateRun(w.root, w.run().id, r => { r.childPid = undefined; }); restartReview(w.root, 'T-0001');
  await deliverWatch(w.root, adapter, { singlePass: true }); assert.equal(readWatchLedger(w.root)!.events[0]!.state, 'cancelled');
});

test('real subprocess exit without finish is failed, with durable log and model arguments', async t => {
  const w = fixture(t);
  w.write('fake.cjs', `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-id'}));console.log(JSON.stringify({args:process.argv.slice(2),prompt:s,thread:process.env.CODEX_THREAD_ID}));});`);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  startReview(w.root, { id: 'T-0001', config: { executable: path.join(w.root, 'fake.cjs') } });
  await executeReview(w.root, w.run().id);
  assert.equal(w.run().state, 'failed'); assert.equal(w.task().status, 'blocked'); assert.equal(w.run().sessionId, 'fixture-id');
  assert.ok(w.task().history.some(h => h.event === 'review_running' && h.extra['session_id'] === 'fixture-id'));
  assert.match(w.read(w.run().log), /gpt-6-sol/); assert.match(w.read(w.run().log), /xhigh/); assert.match(w.run().error!, /without review finish/);
});

test('review subprocess uses actual CLI finish; nonzero exit afterwards retains committed pass', async t => {
  const w = fixture(t);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  w.write('finish.cjs', `const fs=require('fs'),cp=require('child_process');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const p=${JSON.stringify(w.root)};const state=JSON.parse(fs.readFileSync(require('path').join(p,'.task-graph/review.json'),'utf8'));const r=state.runs.at(-1);fs.writeFileSync(require('path').join(p,r.reportPath),'# passed\\nverified 42');cp.execFileSync(process.execPath,[${JSON.stringify(cli)},'task[T-0001].review','finish','--review-id',r.id,'--result','pass','--report',r.reportPath,'--cwd',p,'--json'],{env:{...process.env,TASK_GRAPH_REVIEW_NO_SPAWN:'1'}});process.exitCode=3;});`);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  startReview(w.root, { id: 'T-0001', config: { executable: path.join(w.root, 'finish.cjs') } });
  await executeReview(w.root, w.run().id);
  assert.equal(w.run().state, 'pass'); assert.equal(w.task().status, 'done'); assert.equal(w.run().exitCode, 3);
});

test('interrupted result transaction becomes a recoverable failure rather than a false pass', t => {
  const w = fixture(t); configureReview(w.root, 'T-0001', true, {});
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' }); w.running();
  const pending = w.read('.task-graph/tasks/T-0001.md');
  w.write(w.run().reportPath, '# pass\nverified');
  finishReview(w.root, { id: 'T-0001', reviewId: w.run().id, result: 'pass', report: w.run().reportPath });
  w.write('.task-graph/tasks/T-0001.md', pending); // simulate interruption before task history persisted
  recoverReviews(w.root);
  assert.equal(w.task().status, 'blocked'); assert.equal(w.run().state, 'failed'); assert.ok(w.run().report);
  restartReview(w.root, 'T-0001'); assert.equal(w.run().state, 'queued');
});

test('Recovery adopts a live legacy reviewer without another thread or notification', async t => {
  const w=fixture(t);await watchGraph(w.root,'G-001','11111111-2222-3333-4444-555555555555',adapter);
  configureReview(w.root,'T-0001',true,{});startTask(w.root,{id:'T-0001'});completeTask(w.root,{id:'T-0001'});
  const id=w.run().id;
  updateRun(w.root,id,r=>{r.state='running';r.sessionId='legacy-session';r.workerPid=process.pid;r.childPid=process.pid;});
  recoverReviews(w.root);recoverReviews(w.root);
  assert.equal(w.task().status,'reviewing');assert.equal(w.run().id,id);
  assert.equal(w.task().history.filter(h=>h.event==='review_running').length,1);
  assert.equal(readWatchLedger(w.root)!.events.length,0);
});

test('different tasks execute concurrently while duplicate execution of one round is ignored', async t => {
  const w = fixture(t), signal = path.join(w.root, '.task-graph/started.txt');
  w.write('concurrent.cjs', `const fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(signal)},'started\\n');let n=0;const timer=setInterval(()=>{if(fs.readFileSync(${JSON.stringify(signal)},'utf8').trim().split('\\n').length===2){clearInterval(timer);process.exit(0);}if(n++>150){clearInterval(timer);process.exit(4);}},50);});`);
  const other = (await w.cli('task', 'add', '--summary', 'Concurrent')).task.id;
  attachDocument(w.root, { id: other, path: 'rr.md', kind: 'review-requirement' });
  for (const id of ['T-0001', other]) { startTask(w.root, { id }); completeTask(w.root, { id }); startReview(w.root, { id, config: { executable: path.join(w.root, 'concurrent.cjs') } }); }
  const second = currentReview(readReviewState(w.root), other)!;
  await Promise.all([executeReview(w.root, w.run().id), executeReview(w.root, second.id), executeReview(w.root, w.run().id)]);
  assert.equal(w.run().exitCode, 0); assert.equal(currentReview(readReviewState(w.root), other)!.exitCode, 0);
  assert.equal(w.read('.task-graph/started.txt').trim().split('\n').length, 2);
});
