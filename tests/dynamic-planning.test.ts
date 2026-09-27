import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { useTempWorkspace } from './helpers/temp.js';
import path from 'node:path';

test('Dynamic JSON plans support multiple requirements; added prerequisites require fresh review and replacement preserves mode', async t => {
  const w = useTempWorkspace(t, 'dynamic-plan');
  initializeProject(w.root, { name: 'Dynamic plan', task: 'Parent' });
  w.write('goal.md', '# Goal'); w.write('criteria.md', '# Criteria'); w.write('ref.md', '# Delivery reference');
  w.write('plan.json', JSON.stringify({ tasks: [
    { key: 'consumer', summary: 'Consumer', parent_task: 'T-0001', planning: 'dynamic', kind: 'acceptance', content: ['goal.md', 'criteria.md'] },
    { key: 'research', summary: 'Research', parent_task: 'T-0001' },
  ] }));
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  const added = await run('task', 'add', '--from', path.join(w.root, 'plan.json'));
  assert.equal(added.code, 0);
  const b = added.keys.consumer, c = added.keys.research;
  assert.equal((await run('task', 'show', b)).context.contents.length, 2);
  assert.equal((await run('task', 'refine', b, '--reason', 'Initial inspection')).code, 0);
  assert.equal((await run('task', 'link', b, '--depends-on', c)).code, 0);
  assert.notEqual((await run('task', 'start', b)).code, 0);
  assert.equal((await run('task', 'start', c)).code, 0);
  assert.equal((await run('task', 'complete', c)).code, 0);
  assert.notEqual((await run('task', 'start', b)).code, 0);
  assert.equal((await run('task', 'refine', b, '--reason', 'Research reviewed')).code, 0);
  assert.equal((await run('task', 'start', b)).code, 0);
  assert.equal((await run('task', 'reference', 'attach', b, '--path', 'ref.md')).code, 0);
  assert.equal((await run('task', 'show', b)).task.planningState, 'refined');
  w.write('report.md', '# Verified');
  assert.equal((await run('task', 'complete', b, '--result', 'pass', '--report', 'report.md')).code, 0);
  w.write('criteria.md', '# Updated criteria');
  assert.notEqual((await run('task', 'reopen', b)).code, 0);
  assert.equal((await run('task', 'refine', b, '--reason', 'Rework criteria confirmed')).code, 0);
  assert.equal((await run('task', 'reopen', b)).code, 0);
  const replacement = await run('task', 'revise', b, '--replace', '--summary', 'Replacement', '--content', 'goal.md');
  assert.equal(replacement.code, 0);
  const listed = (await run('task', 'list')).tasks;
  const next = listed.find((v: {title: string}) => v.title === 'Replacement');
  assert.ok(next);
  const replaced = (await run('task', 'show', next.id)).task;
  assert.equal(replaced.planning, 'dynamic'); assert.equal(replaced.kind, 'acceptance');
  assert.notEqual((await run('task', 'start', next.id)).code, 0);
});

test('Dynamic tasks need explicit assessment and changed requirements/upstream references invalidate it', async t => {
  const w = useTempWorkspace(t, 'dynamic');
  initializeProject(w.root, { name: 'Dynamic', task: 'Upstream' });
  w.write('goal.md', '# Goal'); w.write('ref.md', '# API one');
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  const b = (await run('task', 'add', '--summary', 'Consumer', '--content', 'goal.md', '--planning', 'dynamic', '--depends-on', 'T-0001')).task.id;
  assert.notEqual((await run('task', 'refine', b, '--reason', 'too early')).code, 0);
  await run('task', 'reference', 'attach', 'T-0001', '--path', 'ref.md');
  await run('task', 'start', 'T-0001'); await run('task', 'complete', 'T-0001');
  assert.equal((await run('task', 'show', b)).task.planningState, 'awaiting_review');
  assert.ok((await run('task', 'list', '--needs-refinement')).tasks.some((v: {id: string}) => v.id === b));
  assert.notEqual((await run('task', 'start', b)).code, 0);
  assert.notEqual((await run('task', 'claim', b, '--role', 'worker', '--session-id', 'worker')).code, 0);
  assert.equal((await run('task', 'refine', b, '--reason', 'API and acceptance verified')).code, 0);
  assert.equal((await run('task', 'show', b)).task.planningState, 'refined');
  w.write('ref.md', '# API two');
  assert.equal((await run('task', 'show', b)).task.planningState, 'stale');
  assert.notEqual((await run('task', 'start', b)).code, 0);
  await run('task', 'refine', b, '--reason', 'updated API verified');
  w.write('acceptance.md', '# Acceptance');
  await run('task', 'content', 'attach', b, '--path', 'acceptance.md');
  assert.notEqual((await run('task', 'start', b)).code, 0);
  await run('task', 'refine', b, '--reason', 'all current requirements verified');
  assert.equal((await run('task', 'start', b)).code, 0);
  assert.notEqual((await run('task', 'content', 'remove', b, '--path', 'acceptance.md')).code, 0);
});

test('Reject preserves evidence, blocks successors/parent and supports explicit retest', async t => {
  const w = useTempWorkspace(t, 'reject');
  initializeProject(w.root, { name: 'Verification', task: 'Parent' });
  w.write('report.md', '# Evidence\nFailed scenario A');
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  const v = (await run('task', 'add', '--summary', 'Acceptance', '--parent-task', 'T-0001', '--kind', 'acceptance')).task.id;
  const next = (await run('task', 'add', '--summary', 'Successor', '--parent-task', 'T-0001', '--depends-on', v)).task.id;
  await run('task', 'start', 'T-0001');
  await run('task', 'start', v, '--role', 'tester', '--session-id', 'test-session');
  assert.notEqual((await run('task', 'complete', v)).code, 0);
  assert.equal((await run('task', 'reject', v, '--report', 'report.md')).code, 0);
  const rejected = (await run('task', 'show', v)).task;
  assert.equal(rejected.status, 'reject'); assert.equal(rejected.claim, null);
  assert.notEqual((await run('task', 'start', next)).code, 0);
  assert.notEqual((await run('task', 'complete', 'T-0001')).code, 0);
  assert.notEqual((await run('task', 'start', v)).code, 0);
  assert.equal((await run('task', 'reopen', v)).code, 0);
  w.write('report.md', '# Evidence\nPass after repair');
  assert.equal((await run('task', 'complete', v, '--result', 'pass', '--report', 'report.md')).code, 0);
  assert.equal((await run('task', 'show', v)).context.reports.length, 2);
  assert.equal((await run('task', 'start', next)).code, 0);
});
