import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { unlinkSync } from 'node:fs';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { attachDocument } from '../src/core/documents.js';
import { addTask } from '../src/core/taskops.js';
import { updateRun } from '../src/core/review.js';
import { currentReview, readReviewState } from '../src/core/review-state.js';
import { readWatchLedger } from '../src/core/watch.js';
import { useTempWorkspace } from './helpers/temp.js';

function fixture(t: TestContext) {
  const w = useTempWorkspace(t, 'compact-output');
  initializeProject(w.root, { name: 'Output contracts', task: 'Producer' });
  const adapter = { inspect: async () => ({ executable: 'fixture', version: 'fixture', home: 'fixture' }),
    submit: async () => ({ state: 'accepted' as const, receipt: 'fixture' }) };
  const raw = async (...args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { cwd: w.root, env: { TASK_GRAPH_REVIEW_NO_SPAWN: '1' }, desktopAdapter: adapter,
      io: { out: s => out.push(s), err: s => err.push(s) } });
    return { code, out, err };
  };
  const run = async (...args: string[]) => {
    const result = await raw(...args, '--json');
    assert.equal(result.code, 0, result.out.join('\n') + result.err.join('\n'));
    assert.equal(result.out.length, 1);
    return JSON.parse(result.out[0]!);
  };
  return { ...w, run, raw };
}

test('compact manifests retain all files, source tasks, frozen paths and read errors without mirrors or bodies', async t => {
  const w = fixture(t);
  w.write('api.ts', 'PRIVATE_IMPLEMENTATION');
  attachDocument(w.root, { id: 'T-0001', kind: 'reference', path: 'api.ts', summary: 'Live API' });
  attachDocument(w.root, { id: 'T-0001', kind: 'reference', path: 'api.ts', snapshot: true, summary: 'Frozen API' });
  const task = addTask(w.root, { summary: 'Consumer', dependsOnSpecs: ['T-0001'] });
  for (let i = 0; i < 12; i++) {
    w.write(`requirement${i}.md`, `PRIVATE_REQUIREMENT_${i}`);
    attachDocument(w.root, { id: task.id, kind: 'content', path: `requirement${i}.md`, summary: `Requirement ${i}` });
  }
  w.write('feedback.md', 'PRIVATE_USER_BODY');
  attachDocument(w.root, { id: task.id, kind: 'report', path: 'feedback.md', audience: 'user' });
  const shown = await w.run(`task[${task.id}]`, 'show');
  assert.equal(shown.context.contents.length, 12);
  assert.equal(shown.context.project_root, w.root);
  assert.equal(shown.context.content, undefined);
  assert.equal(shown.task.documents, undefined);
  assert.equal(shown.task.outputs, undefined);
  assert.equal(shown.preview, undefined);
  assert.equal(shown.context.references[0].source_task, 'T-0001');
  assert.equal(shown.context.references[0].read_path, 'api.ts');
  assert.equal(shown.context.references[1].mode, 'snapshot');
  assert.match(shown.context.references[1].read_path, /^\.task-graph\/snapshots\//);
  assert.doesNotMatch(JSON.stringify(shown), /PRIVATE_|feedback.md|sha256|size_bytes/);
  const files = await w.run(`task[${task.id}].content`, 'list');
  assert.equal(files.files.length, 12);
  assert.deepEqual(files.files, shown.context.contents);
  const detailed = await w.run(`task[${task.id}]`, 'show', '--detail');
  assert.ok(detailed.context.references[1].sha256);
  assert.doesNotMatch(JSON.stringify(detailed), /PRIVATE_/);
  const handoff = await w.run(`task[${task.id}]`, 'show', '--handoff');
  assert.equal(handoff.context, undefined);
  assert.doesNotMatch(handoff.handoff, /feedback.md|PRIVATE_/);
  const expanded = await w.run(`task[${task.id}]`, 'show', '--expand-path', 'requirement11.md');
  assert.equal(expanded.context.contents[11].body, 'PRIVATE_REQUIREMENT_11');
  unlinkSync(w.file('api.ts'));
  const refs = (await w.run(`task[${task.id}].reference`, 'list')).files;
  assert.match(refs[0].error, /Cannot read/);
  assert.equal(refs[1].error, undefined);
});

test('write receipts describe only their change; start returns required context and skill entry', async t => {
  const w = fixture(t);
  w.write('requirement.md', 'PRIVATE_REQUIREMENT'); w.write('report.md', 'PRIVATE_REPORT');
  await w.run('task[T-0001].content', 'attach', '--path', 'requirement.md');
  const start = await w.run('task[T-0001]', 'start', '--role', 'worker', '--session-id', 'fixture');
  assert.equal(start.task.claim.sessionId, 'fixture');
  assert.ok(start.guidance.skill_path.endsWith('SKILL.md'));
  assert.equal(start.context.contents[0].read_path, 'requirement.md');
  const attached = await w.run('task[T-0001].report', 'attach', '--path', 'report.md', '--summary', 'Verified behavior');
  assert.equal(attached.task.outputs, undefined);
  assert.equal(attached.attachment.summary, 'Verified behavior');
  assert.match(attached.attachment.read_path, /snapshots/);
  const logged = await w.run('task[T-0001].log', 'add', 'PRIVATE_LOG_ENTRY');
  assert.ok(logged.log.read_path);
  assert.doesNotMatch(JSON.stringify(logged), /PRIVATE_|report.md|outputs|body/);
  const detailedLog = await w.run('task[T-0001].log', 'add', 'Another entry', '--detail');
  assert.doesNotMatch(JSON.stringify(detailedLog), /PRIVATE_/);
  w.write('report.md', 'PRIVATE_REPORT_FINAL');
  const completed = await w.run('task[T-0001]', 'complete', '--report', './report.md');
  assert.equal(completed.task.status, 'done');
  assert.equal(completed.reports[0].path, 'report.md');
  const listed = await w.run('graph[G-001].task', 'list');
  assert.equal(listed.tasks[0].outputs, undefined);
  assert.equal(listed.tasks[0].graph, undefined);
});

test('review policy, current execution and final receipt stay separate; final review notifies once', async t => {
  const w = fixture(t);
  w.write('rr.md', 'Verify the delivered result'); w.write('review.md', 'PASS: verified');
  await w.run('task[T-0001].review-requirement', 'attach', '--path', 'rr.md');
  await w.run('graph[G-001].watch', 'add', '--thread', '01a0d067-d9fc-7cd1-b278-4b068b7a7169');
  await w.run('task[T-0001].auto-review', 'enable');
  const policy = await w.run('task[T-0001].auto-review', 'status');
  assert.deepEqual(policy.review, { enabled: true });
  await w.run('task[T-0001]', 'start');
  const complete = await w.run('task[T-0001]', 'complete');
  assert.equal(complete.task.status, 'pending_review');
  assert.equal(readWatchLedger(w.root)!.events.length, 0);
  const run = currentReview(readReviewState(w.root), 'T-0001')!;
  const status = await w.run('task[T-0001].review', 'status');
  assert.equal(status.review.current.id, run.id);
  assert.equal(status.review.current.materials, undefined);
  assert.equal(status.runs, undefined);
  assert.ok((await w.run('task[T-0001].review', 'status', '--detail')).runs);
  updateRun(w.root, run.id, r => { r.state = 'running'; r.startedAt = new Date().toISOString(); });
  const done = await w.run('task[T-0001].review', 'finish', '--review-id', run.id, '--result', 'pass', '--report', 'review.md');
  assert.equal(done.task.status, 'done');
  assert.equal(done.review.result, 'pass');
  assert.match(done.review.report.read_path, /snapshots/);
  assert.equal(done.review.current, undefined);
  assert.equal(readWatchLedger(w.root)!.events.length, 1);
});

test('both syntaxes honor detail, quiet, single JSON errors and action-specific help', async t => {
  const w = fixture(t);
  const legacy = await w.run('task', 'show', 'T-0001');
  const resource = await w.run('task[T-0001]', 'show');
  delete resource.resource; delete resource.task.resource;
  assert.deepEqual(resource, legacy);
  assert.deepEqual(await w.run('task', 'show', 'T-0001', '--detail=false'), legacy);
  assert.ok((await w.run('task', 'show', 'T-0001', '--detail')).task.documents);
  const describe = await w.run('task[T-0001]', 'describe');
  assert.ok(describe.actions.some((a: { action: string }) => a.action === 'show'));
  assert.equal(describe.operations, undefined);
  assert.equal(describe.actions[0].usage, undefined);
  assert.ok((await w.run('task[T-0001]', 'describe', '--detail')).actions[0].usage);
  const help = await w.raw('task[T-0001].review', 'status', '--help');
  assert.match(help.out.join(''), /status/);
  assert.doesNotMatch(help.out.join(''), /--error-report/);
  for (const args of [['task', 'show', 'T-0001'], ['task[T-0001]', 'show'], ['task[T-0001].content', 'list']]) {
    assert.deepEqual((await w.raw(...args, '--quiet', '--json')).out, []);
    const error = await w.raw(...args, '--detial', '--quiet', '--json');
    assert.notEqual(error.code, 0);
    assert.equal(error.out.length, 1);
    assert.equal(JSON.parse(error.out[0]!).ok, false);
    assert.deepEqual(error.err, []);
  }
  const text = await w.raw('task', 'show', 'T-0001');
  assert.match(text.out.join(''), /project_root:/);
  assert.doesNotMatch(text.out.join(''), /sha256|documents:/);
});
