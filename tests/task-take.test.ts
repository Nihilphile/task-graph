import assert from 'node:assert/strict';
import path from 'node:path';
import { cpSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { initializeProject } from '../src/core/init.js';
import { addTask } from '../src/core/taskops.js';
import { useTempWorkspace, SKILL_ROOT, runNodeAsync } from './helpers/temp.js';

test('Start/show guidance is readable from a different project and stays out of persisted data', async t => {
  const w = useTempWorkspace(t, '接手项目');
  initializeProject(w.root, { name: 'Take', task: 'Work' });
  const run = async (...args: string[]) => {
    const output: string[] = [];
    const code = await main([...args, '--json'], { cwd: w.root, io: { out: s => output.push(s), err: s => output.push(s) } });
    assert.equal(code, 0, output.join('\n'));
    return JSON.parse(output.join('\n'));
  };
  const started = await run('task', 'start', 'T-0001', '--role', 'worker', '--session-id', 'test-worker');
  const guide = started.guidance;
  assert.ok(guide.skill_path);
  assert.ok(path.isAbsolute(guide.skill_path));
  assert.equal(guide.skill_path, path.join(SKILL_ROOT, 'skills', 'task-take', 'SKILL.md'));
  assert.match(readFileSync(guide.skill_path, 'utf8'), /name: task-take/);
  assert.equal(started.context.project_root, w.root);
  const before = new Map(w.listFiles().map(file => [file, w.readBuffer(file)]));
  assert.equal((await run('task', 'show', 'T-0001')).guidance, undefined);
  assert.equal((await run('task', 'show', 'T-0001', '--detail')).guidance.skill_path, guide.skill_path);
  assert.equal((await run('task', 'show', 'T-0001', '--handoff')).guidance, undefined);
  assert.deepEqual(w.listFiles(), [...before.keys()]);
  for (const [file, bytes] of before) {
    assert.deepEqual(w.readBuffer(file), bytes);
    assert.ok(!bytes.toString().includes(guide.skill_path));
    assert.ok(!bytes.toString().includes(JSON.stringify(guide.skill_path).slice(1, -1)));
  }
  assert.equal((await run('task', 'complete', 'T-0001')).guidance, undefined);
  assert.deepEqual((await run('task', 'reopen', 'T-0001')).guidance, guide);
});

test('Guidance respects text/quiet output and a rejected start preserves the task', async t => {
  const w = useTempWorkspace(t, 'task-take-output');
  initializeProject(w.root, { name: 'Take', task: 'Work' });
  const run = async (...args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { cwd: w.root, io: { out: s => out.push(s), err: s => err.push(s) } });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const started = await run('task', 'start', 'T-0001');
  assert.equal(started.code, 0, started.err);
  assert.ok(started.out.includes(path.join(SKILL_ROOT, 'skills', 'task-take', 'SKILL.md')));
  const before = w.read('.task-graph/tasks/T-0001.md');
  const failed = await run('task', 'start', 'T-0001', '--json');
  assert.notEqual(failed.code, 0);
  assert.equal(JSON.parse(failed.out).guidance, undefined);
  assert.equal(w.read('.task-graph/tasks/T-0001.md'), before);
  const second = addTask(w.root, { graph: 'G-001', title: 'Quiet' });
  const quiet = await run('task', 'start', second.id, '--quiet');
  assert.equal(quiet.code, 0, quiet.err);
  assert.equal(quiet.out, '');
});

test('Relocated CLI uses its own bundled skill; a missing guide fails before starting', async t => {
  const install = useTempWorkspace(t, '工具安装');
  const project = useTempWorkspace(t, '执行目录');
  for (const file of ['dist/src', 'skills', 'package.json']) cpSync(path.join(SKILL_ROOT, file), install.file(file), { recursive: true });
  symlinkSync(path.join(SKILL_ROOT, 'node_modules'), install.file('node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  initializeProject(project.root, { name: 'Relocated', task: 'Work' });
  const invoke = (...args: string[]) => runNodeAsync([install.file('dist/src/cli.js'), ...args, '--cwd', project.root, '--json'], { cwd: project.root });
  const result = await invoke('task', 'start', 'T-0001');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).guidance.skill_path, install.file('skills/task-take/SKILL.md'));
  const second = addTask(project.root, { graph: 'G-001', title: 'Missing guide' });
  const before = project.read(`.task-graph/tasks/${second.id}.md`);
  unlinkSync(install.file('skills/task-take/SKILL.md'));
  const failed = await invoke('task', 'start', second.id);
  assert.notEqual(failed.code, 0);
  assert.equal(JSON.parse(failed.stdout).error.code, 'E_TASK_TAKE_SKILL');
  assert.equal(project.read(`.task-graph/tasks/${second.id}.md`), before);
});
