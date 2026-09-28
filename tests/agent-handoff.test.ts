import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { addTask } from '../src/core/taskops.js';
import { attachDocument } from '../src/core/documents.js';
import { startTask, completeTask } from '../src/core/lifecycle.js';
import { useTempWorkspace } from './helpers/temp.js';
import { readTaskDocument } from '../src/core/task.js';
import { mutateTaskDocument } from '../src/core/mutate.js';

async function invoke(root: string, ...args: string[]) {
  const output: string[] = [];
  const code = await main([...args, '--json', '--detail'], { cwd: root, io: { out: s => output.push(s), err: () => {} } });
  return { code, value: JSON.parse(output.join('\n')), text: output.join('\n') };
}

test('Default show and handoff keep attachment bodies out of agent output', async t => {
  const w = useTempWorkspace(t, 'agent-handoff');
  initializeProject(w.root, { name: 'Manifest', task: 'Producer' });
  w.write('report.md', '# Implementation\nIMPLEMENTATION_BODY');
  w.write('task-graph-feedback.md', '# Feedback\nUSER_FEEDBACK_BODY');
  for (const file of ['report.md', 'task-graph-feedback.md']) attachDocument(w.root, { id: 'T-0001', kind: 'report', path: file });
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  const consumer = addTask(w.root, { summary: 'Consumer', dependsOnSpecs: ['T-0001'] });
  for (const flags of [[], ['--handoff']]) {
    const out: string[] = [];
    const code = await main(['task', 'show', consumer.id, ...flags, '--json'], { cwd: w.root, io: { out: s => out.push(s), err: () => {} } });
    assert.equal(code, 0);
    assert.ok(!out.join('').includes('USER_FEEDBACK_BODY'), 'feedback body must not be automatically expanded');
    assert.ok(!out.join('').includes('IMPLEMENTATION_BODY'), 'reports must be read on demand');
  }
});

test('User audience stays in HTML but out of manifests, expansions and new start snapshots', async t => {
  const w = useTempWorkspace(t, 'audience');
  initializeProject(w.root, { name: 'Audience', task: 'Producer' });
  w.write('implementation.md', 'IMPLEMENTATION_BODY');
  w.write('feedback.md', 'USER_FEEDBACK_BODY');
  w.write('types.ts', 'REFERENCE_BODY');
  assert.equal((await invoke(w.root, 'task', 'report', 'attach', 'T-0001', '--path', 'feedback.md', '--audience', 'user', '--summary', 'USER_SUMMARY')).code, 0);
  attachDocument(w.root, { id: 'T-0001', kind: 'report', path: 'implementation.md', summary: 'API report' });
  attachDocument(w.root, { id: 'T-0001', kind: 'reference', path: 'types.ts', summary: 'Code entry', snapshot: true });
  startTask(w.root, { id: 'T-0001' }); completeTask(w.root, { id: 'T-0001' });
  const consumer = addTask(w.root, { summary: 'Consumer', dependsOnSpecs: ['T-0001'] });
  const shown = await invoke(w.root, 'task', 'show', consumer.id);
  const listed = await invoke(w.root, 'task', 'list');
  assert.equal(listed.code, 0);
  assert.ok(!listed.text.includes('USER_SUMMARY'));
  assert.equal(shown.value.output_mode, 'manifest');
  assert.equal(shown.value.context.reports.length, 1);
  const report = shown.value.context.reports[0];
  assert.equal(report.source_task, 'T-0001'); assert.equal(report.mode, 'snapshot');
  assert.notEqual(report.path, report.read_path); assert.equal(report.summary, 'API report');
  assert.equal(shown.value.context.references[0].summary, 'Code entry');
  for (const args of [[], ['--handoff'], ['--handoff', '--expand', 'report', '--expand', 'reference'], ['--expand-path', 'feedback.md']]) {
    const result = await invoke(w.root, 'task', 'show', consumer.id, ...args);
    assert.equal(result.code, 0);
    assert.ok(!result.text.includes('USER_FEEDBACK_BODY'));
    assert.ok(!result.text.includes('USER_SUMMARY'));
    assert.ok(result.value.context.excluded.some((e: {reason: string}) => e.reason === 'audience_user'));
  }
  const expanded = await invoke(w.root, 'task', 'show', consumer.id, '--handoff', '--expand', 'report', '--expand', 'reference');
  assert.ok(expanded.value.handoff.includes('IMPLEMENTATION_BODY'));
  assert.ok(expanded.value.handoff.includes('REFERENCE_BODY'));
  const started = startTask(w.root, { id: consumer.id });
  const saved = w.read(started.outputs.find(o => o.kind === 'handoff')!.snapshot!);
  assert.ok(!saved.includes('USER_FEEDBACK_BODY'));
  assert.ok(!saved.includes('IMPLEMENTATION_BODY'));
  assert.ok(w.read('.task-graph/generated/index.html').includes('USER_FEEDBACK_BODY'));
});

test('Preview and exact path filters preserve snapshot provenance without reading bodies into output', async t => {
  const w = useTempWorkspace(t, 'preview');
  initializeProject(w.root, { name: 'Preview', task: 'Work' });
  w.write('docs/one.md', 'ONE_BODY 😀 中文'); w.write('docs/two.md', 'TWO_BODY');
  for (const file of ['docs/one.md', 'docs/two.md']) attachDocument(w.root, { id: 'T-0001', kind: 'report', path: file });
  const before = new Map(w.listFiles().map(file => [file, w.readBuffer(file)]));
  const preview = await invoke(w.root, 'task', 'show', 'T-0001', '--handoff', '--expand', 'report', '--preview');
  assert.ok(!preview.text.includes('ONE_BODY')); assert.ok(!preview.text.includes('TWO_BODY'));
  assert.equal(preview.value.preview.selected_files.length, 2);
  assert.ok(preview.value.preview.selected_bytes > 0);
  const expanded = await invoke(w.root, 'task', 'show', 'T-0001', '--handoff', '--expand', 'report');
  assert.ok(preview.value.preview.estimated_chars_upper_bound >= expanded.value.handoff.length);
  const filtered = await invoke(w.root, 'task', 'show', 'T-0001', '--expand', 'report', '--exclude-path', 'docs\\two.md');
  assert.ok(filtered.text.includes('ONE_BODY')); assert.ok(!filtered.text.includes('TWO_BODY'));
  const snapshotPath = preview.value.preview.selected_files[0].read_path;
  const only = await invoke(w.root, 'task', 'show', 'T-0001', '--expand-path', snapshotPath);
  assert.ok(only.text.includes('ONE_BODY')); assert.ok(!only.text.includes('TWO_BODY'));
  const denied = await invoke(w.root, 'task', 'show', 'T-0001', '--expand-path', 'docs/one.md', '--exclude-path', snapshotPath);
  assert.ok(!denied.text.includes('ONE_BODY'));
  assert.notEqual((await invoke(w.root, 'task', 'show', 'T-0001', '--manifest', '--expand', 'report')).code, 0);
  assert.notEqual((await invoke(w.root, 'task', 'show', 'T-0001', '--expand', 'everything')).code, 0);
  for (const [file, bytes] of before) assert.deepEqual(w.readBuffer(file), bytes);
  assert.deepEqual(w.listFiles(), [...before.keys()]);
});

test('Existing attachment audience changes preserve every frozen version; old generated aggregates need review', async t => {
  const w = useTempWorkspace(t, 'existing-audience');
  initializeProject(w.root, { name: 'Existing', task: 'Work' });
  for (const text of ['FIRST_BODY', 'SECOND_BODY']) {
    w.write('feedback.md', text);
    attachDocument(w.root, { id: 'T-0001', kind: 'report', path: 'feedback.md' });
  }
  const old = '.task-graph/snapshots/old-handoff.md';
  w.write(old, 'OLD_COPIED_FEEDBACK');
  mutateTaskDocument(w.root, 'T-0001', current => ({ ...current, outputs: [...current.outputs, { kind: 'handoff', path: old, snapshot: old }] }));
  const initial = readTaskDocument(w.root, 'T-0001');
  const marked = await invoke(w.root, 'task', 'output', 'set-audience', 'T-0001', '--path', 'feedback.md', '--audience', 'user');
  assert.equal(marked.code, 0);
  const after = readTaskDocument(w.root, 'T-0001');
  assert.deepEqual(after.outputs.map(o => o.snapshot), initial.outputs.map(o => o.snapshot));
  assert.deepEqual(after.outputs.filter(o => o.kind === 'report').map(o => o.audience), ['user', 'user']);
  const show = await invoke(w.root, 'task', 'show', 'T-0001', '--handoff', '--expand', 'report', '--expand', 'handoff');
  for (const body of ['FIRST_BODY', 'SECOND_BODY', 'OLD_COPIED_FEEDBACK']) assert.ok(!show.text.includes(body));
  assert.ok(show.value.context.excluded.some((e: {reason: string}) => e.reason === 'legacy_aggregate'));
  const beforeInvalid = w.read('.task-graph/tasks/T-0001.md');
  assert.notEqual((await invoke(w.root, 'task', 'output', 'set-audience', 'T-0001', '--path', 'feedback.md', '--audience', 'invalid')).code, 0);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), beforeInvalid);
});
