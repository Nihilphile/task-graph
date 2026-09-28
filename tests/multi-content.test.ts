import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { useTempWorkspace } from './helpers/temp.js';
import { click, openViewer, taskNode } from './helpers/viewer-dom.js';

test('Multiple requirements survive creation, incremental binding, handoff, HTML and removal', async t => {
  const w = useTempWorkspace(t, 'multi-content');
  initializeProject(w.root, { name: 'Requirements', task: 'Root' });
  for (const name of ['goal', 'implementation', 'acceptance']) w.write(`${name}.md`, `# ${name}\n${name.toUpperCase()}_BODY`);
  async function run(...args: string[]) {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: () => {} } });
    return { code, ...JSON.parse(output.join('\n')) };
  }
  const added = await run('task', 'add', '--summary', 'Multi', '--content', 'goal.md', '--content', 'implementation.md');
  assert.equal(added.code, 0);
  const id = added.task.id;
  assert.equal((await run('task', 'content', 'attach', id, '--path', 'acceptance.md', '--summary', 'User acceptance')).code, 0);
  const manifest = await run('task', 'show', id);
  assert.deepEqual(manifest.context.contents.map((f: {read_path: string}) => f.read_path), ['goal.md', 'implementation.md', 'acceptance.md']);
  assert.ok(!JSON.stringify(manifest).includes('ACCEPTANCE_BODY'));
  const expanded = await run('task', 'show', id, '--handoff', '--expand', 'content');
  for (const name of ['GOAL', 'IMPLEMENTATION', 'ACCEPTANCE']) assert.ok(expanded.handoff.includes(name + '_BODY'));
  const started = await run('task', 'start', id);
  assert.equal(started.code, 0);
  const page = await openViewer(path.join(w.root, '.task-graph/generated/index.html'));
  t.after(() => page.close());
  click(page, taskNode(page, id).querySelector('[data-panel="content"]')!);
  assert.equal(page.document.querySelectorAll('.document-item').length, 3);
  click(page, page.document.querySelector('.document-item')!);
  assert.ok(page.document.querySelector('.document-content'));
  assert.equal((await run('task', 'content', 'remove', id, '--path', 'goal.md')).code, 0);
  assert.equal((await run('task', 'show', id)).context.contents.length, 2);
  assert.equal((await run('task', 'content', 'remove', id, '--path', 'implementation.md')).code, 0);
  assert.notEqual((await run('task', 'content', 'remove', id, '--path', 'acceptance.md')).code, 0);
  assert.equal(w.read('goal.md'), '# goal\nGOAL_BODY');
});
