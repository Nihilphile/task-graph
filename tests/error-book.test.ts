import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { errorBookEntries } from '../src/core/error-book.js';
import { useTempWorkspace } from './helpers/temp.js';
import { openViewer, click } from './helpers/viewer-dom.js';

function runner(root: string) {
  return async (...args: string[]) => {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: root, env: {}, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  };
}

test('error-book appends each rejection atomically, preserves snapshots after retest and rebuild, and scopes descendants', async t => {
  const w = useTempWorkspace(t, 'error-book');
  initializeProject(w.root, { name: 'Errors', task: 'Parent' });
  const run = runner(w.root);
  const discovery = await run('graph[G-001]', 'describe', '--detail');
  assert.ok(discovery.children.includes('graph[G-001].errorbook'));
  assert.deepEqual((await run('graph[G-001].errorbook', 'describe', '--detail')).operations, ['list', 'show', 'describe']);
  w.write('evidence.md', '# Evidence\nFailed empty input.');
  w.write('error.md', '# Empty input\n\nFailure: crashes.\nMode: missing boundary check.\nAnalysis: cover empty input before delivery.');
  const added = await run('task', 'add', '--summary', 'Reviewer', '--parent-task', 'T-0001', '--kind', 'acceptance');
  const id = added.task.id;
  const address = `task[${id}]`;
  assert.equal((await run(address, 'start', '--role', 'reviewer', '--session-id', 'review-1')).code, 0);
  const before = w.listFiles().map(f => [f, w.read(f)]);
  assert.notEqual((await run(address, 'reject', '--report', 'evidence.md')).code, 0);
  assert.notEqual((await run(address, 'reject', '--report', 'missing.md', '--error-report', 'error.md')).code, 0);
  assert.deepEqual(w.listFiles().map(f => [f, w.read(f)]), before);
  assert.equal((await run(address, 'reject', '--report', 'evidence.md', '--error-report', 'error.md')).code, 0);
  const first = (await run('graph[G-001].errorbook', 'show')).entries[0];
  assert.match(first.report.body, /missing boundary check/);
  assert.match(w.read(first.evidence[0]), /Failed empty input/);
  assert.equal((await run(address, 'reject', '--report', 'evidence.md', '--error-report', 'error.md')).ok, false);
  assert.equal((await run(address, 'reopen')).code, 0);
  w.write('evidence.md', '# Evidence for the second rejection');
  w.write('error.md', '# Second failure\nFailure mode: incomplete fix.\nAnalysis: validate all branches.');
  assert.equal((await run(address, 'complete', '--result', 'reject', '--report', 'evidence.md', '--error-report', 'error.md')).code, 0);
  assert.equal((await run(address, 'reopen')).code, 0);
  w.write('evidence.md', '# Passed');
  assert.equal((await run(address, 'complete', '--result', 'pass', '--report', 'evidence.md')).code, 0);
  await run('.', 'build');
  const entries = (await run('errorbook', 'show')).entries;
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].id, entries[1].id);
  assert.equal(entries[0].report.body, first.report.body);
  assert.match(entries[1].report.body, /Second failure/);
  assert.equal((await run('errorbook', 'list')).entries[0].report.body, undefined);
  assert.equal((await run('graph[G-002].errorbook', 'list')).entries.length, 2);
  await run('graph', 'add', '--title', 'Unrelated', '--entry');
  assert.equal((await run('graph[G-003].errorbook', 'list')).entries.length, 0);
  assert.notEqual((await run('graph[unknown].errorbook', 'show')).code, 0);
  assert.equal(errorBookEntries(loadTaskRepository(w.root)).length, 2);
});

test('empty or non-Markdown error reports and pass misuse leave state unchanged', async t => {
  const w = useTempWorkspace(t, 'error-book-invalid');
  initializeProject(w.root, { name: 'Errors', task: 'Review' });
  const run = runner(w.root);
  w.write('empty.md', '  \n'); w.write('bad.txt', 'Failure');
  await run('task[T-0001]', 'start');
  for (const file of ['empty.md', 'bad.txt', '../escape.md']) {
    assert.notEqual((await run('task[T-0001]', 'reject', '--error-report', file)).code, 0);
  }
  assert.notEqual((await run('task[T-0001]', 'complete', '--error-report', 'empty.md')).code, 0);
  assert.equal((await run('task[T-0001]', 'show')).task.status, 'in_progress');
  assert.equal((await run('errorbook', 'list')).entries.length, 0);
});

test('viewer exposes an independent error-book node, reads escaped Markdown and navigates to the source task', async t => {
  const w = useTempWorkspace(t, 'error-book-viewer');
  initializeProject(w.root, { name: 'Errors', task: 'Review' });
  const run = runner(w.root);
  w.write('error.md', '# Failure analysis\n\n**Boundary case** needs a test. <script>window.hacked=true</script>');
  await run('task[T-0001]', 'start');
  assert.equal((await run('task[T-0001]', 'reject', '--error-report', 'error.md')).code, 0);
  const page = await openViewer(w.file('.task-graph/generated/index.html'));
  t.after(() => page.close());
  const node = page.document.querySelector('[data-kind="error-book"]')!;
  assert.ok(node);
  assert.equal(node.hasAttribute('data-task'), false);
  click(page, node);
  assert.match(page.document.getElementById('details-body')!.textContent!, /Boundary case/);
  assert.equal(page.document.querySelectorAll('#details-body script').length, 0);
  assert.match(page.window.location.hash, /panel=error-book/);
  click(page, page.document.querySelector('[data-error-task]')!);
  assert.match(page.window.location.hash, /task=T-0001/);
  assert.deepEqual(page.errors, []);
  const linked = await openViewer(w.file('.task-graph/generated/index.html'), { hash: '#graph=G-001&panel=error-book' });
  t.after(() => linked.close());
  assert.match(linked.document.getElementById('details-body')!.textContent!, /Failure analysis/);
});
