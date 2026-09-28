import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { readWatchLedger, deliverWatch } from '../src/core/watch.js';
import { useTempWorkspace } from './helpers/temp.js';
import { startTask, completeTask } from '../src/core/lifecycle.js';
import { claimTask, reassignClaim } from '../src/core/claims.js';
import { addManualBlocker } from '../src/core/blockers.js';
import { addTask } from '../src/core/taskops.js';
import { attachDocument } from '../src/core/documents.js';
import { configureReview, failReview, finishReview, updateRun } from '../src/core/review.js';
import { currentReview, readReviewState } from '../src/core/review-state.js';
import { computeReadiness } from '../src/core/readiness.js';
import { loadTaskRepository } from '../src/core/repo.js';

for (const action of ['start', 'reopen', 'claim', 'reassign']) test(`blocked ${action} starts repair and a repeated blocker notifies again`, async t => {
  const w = useTempWorkspace(t, 'blocked-repair');
  initializeProject(w.root, { name: 'Repair', task: 'Work' });
  const sent: string[] = [];
  const adapter = { inspect: async () => ({ executable: 'fixture', version: 'fixture', home: 'fixture' }),
    submit: async (_binding: unknown, _thread: string, message: string) => { sent.push(message); return { state: 'accepted' as const, receipt: 'fixture' }; } };
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, env: { TASK_GRAPH_REVIEW_NO_SPAWN: '1' }, desktopAdapter: adapter,
      io: { out: s => out.push(s), err: () => {} } });
    assert.equal(code, 0, out.join('\n'));
    return JSON.parse(out.join('\n'));
  };
  await run('graph[G-001].watch', 'add', '--thread', '01a0d067-d9fc-7cd1-b278-4b068b7a7169');
  await run('task[T-0001]', 'block', '--reason', 'Missing test environment');
  assert.equal((await run('task[T-0001]', 'show')).task.readiness, 'ready');
  await deliverWatch(w.root, adapter, { singlePass: true });
  assert.equal(sent.length, 1);
  const taken = await run('task[T-0001]', action, '--role', 'repairer', '--session-id', 'repair-session');
  assert.equal(taken.task.status, 'in_progress');
  assert.deepEqual(taken.repair.previous_blockers, ['Missing test environment']);
  assert.ok(taken.context.contents.length);
  assert.ok(taken.guidance.skill_path);
  assert.equal((await run('task[T-0001]', 'show')).task.status, 'in_progress', 'status must survive reload');
  assert.match(w.read('.task-graph/tasks/T-0001.md'), /Missing test environment/, 'old reason remains auditable');
  await run('task[T-0001]', 'block', '--reason', 'Missing test environment');
  await run('task[T-0001].log', 'add', 'Still waiting');
  await deliverWatch(w.root, adapter, { singlePass: true });
  await deliverWatch(w.root, adapter, { singlePass: true });
  assert.equal(sent.length, 2);
  assert.deepEqual(readWatchLedger(w.root)!.events.map(e => e.result), ['blocked', 'blocked']);
});

for (const outcome of ['blocked', 'failed']) test(`repairing a ${outcome} review invalidates the old round and resubmits fresh delivery`, t => {
  const w = useTempWorkspace(t, 'review-repair');
  initializeProject(w.root, { name: 'Review repair', task: 'Work' });
  w.write('rr.md', '# Verify result'); w.write('report.md', '# Environment missing');
  attachDocument(w.root, { id: 'T-0001', kind: 'review-requirement', path: 'rr.md' });
  configureReview(w.root, 'T-0001', true, {});
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  const old = currentReview(readReviewState(w.root), 'T-0001')!;
  updateRun(w.root, old.id, run => { run.state = 'running'; });
  if (outcome === 'blocked') finishReview(w.root, { id: 'T-0001', reviewId: old.id, result: 'blocked', report: 'report.md' });
  else failReview(w.root, 'T-0001', old.id, 'Reviewer exited');
  updateRun(w.root, old.id, run => { run.workerPid = process.pid; });
  const before = w.read('.task-graph/tasks/T-0001.md');
  assert.throws(() => startTask(w.root, { id: 'T-0001' }), /still be active/);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), before);
  updateRun(w.root, old.id, run => { run.workerPid = undefined; });
  const resumed = claimTask(w.root, { id: 'T-0001', role: 'repairer', sessionId: 'repair' });
  assert.equal(resumed.status, 'in_progress');
  assert.equal(resumed.blockedFrom, undefined);
  assert.equal(currentReview(readReviewState(w.root), 'T-0001'), undefined);
  assert.equal(readReviewState(w.root).runs.find(r => r.id === old.id)!.state, outcome);
  assert.throws(() => finishReview(w.root, { id: 'T-0001', reviewId: old.id, result: 'blocked', report: 'report.md' }), /no longer current/);
  addManualBlocker(w.root, { id: 'T-0001', reason: 'Still missing environment' });
  reassignClaim(w.root, { id: 'T-0001', role: 'repairer', sessionId: 'next-repair', takeover: true });
  w.write('fixed.txt', 'Environment repaired');
  assert.equal(completeTask(w.root, { id: 'T-0001' }).status, 'pending_review');
  const next = currentReview(readReviewState(w.root), 'T-0001')!;
  assert.notEqual(next.id, old.id); assert.notEqual(next.submission, old.submission);
});

test('failed ownership or prerequisite checks leave blocked work and its reasons intact', t => {
  const w = useTempWorkspace(t, 'repair-guards');
  initializeProject(w.root, { name: 'Guards', task: 'Work' });
  startTask(w.root, { id: 'T-0001', role: 'worker', sessionId: 'owner' });
  addManualBlocker(w.root, { id: 'T-0001', reason: 'Need help' });
  const before = w.read('.task-graph/tasks/T-0001.md');
  assert.throws(() => startTask(w.root, { id: 'T-0001', role: 'worker', sessionId: 'other' }), /claimed/);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), before);
  assert.equal(reassignClaim(w.root, { id: 'T-0001', role: 'worker', sessionId: 'other', takeover: true }).status, 'in_progress');
  for (const task of [
    addTask(w.root, { summary: 'Unmet dependency', dependsOnSpecs: ['T-0001'], manualBlockers: ['Need input'] }),
    addTask(w.root, { summary: 'Unrefined', planning: 'dynamic', manualBlockers: ['Need input'] }),
  ]) {
    const file = `.task-graph/tasks/${task.id}.md`, bytes = w.read(file);
    assert.equal(computeReadiness(loadTaskRepository(w.root)).get(task.id)!.readiness, 'unready');
    assert.throws(() => claimTask(w.root, { id: task.id, role: 'worker', sessionId: 'repair' }), /unready/);
    assert.equal(w.read(file), bytes);
  }
});

test('unmet prerequisites are unready and stay todo until the producer completes', async t => {
  const w = useTempWorkspace(t, 'unready-semantics');
  initializeProject(w.root, { name: 'Prerequisites', task: 'Producer' });
  const task = addTask(w.root, { summary: 'Consumer', dependsOnSpecs: ['T-0001'] });
  assert.equal(task.status, 'todo');
  assert.equal(computeReadiness(loadTaskRepository(w.root)).get(task.id)!.readiness, 'unready');
  assert.throws(() => startTask(w.root, { id: task.id }), /unready/);
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  assert.equal(computeReadiness(loadTaskRepository(w.root)).get(task.id)!.readiness, 'ready');
  assert.equal(startTask(w.root, { id: task.id }).status, 'in_progress');
});
