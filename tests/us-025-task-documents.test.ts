import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli/main.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addTask, reviseTask } from '../src/core/taskops.js';
import { addPlannedTasks } from '../src/core/planning.js';
import { attachDocument, createHandoff, handoffText, taskDocuments } from '../src/core/documents.js';
import { addWorkLog } from '../src/core/annotations.js';
import { completeTask, startTask } from '../src/core/lifecycle.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { createGraphProjection } from '../src/core/projection.js';
import { useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

async function cli(workspace: TempWorkspace, ...args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { cwd: workspace.root, io: { out: (s) => out.push(s), err: (s) => err.push(s) } });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}
const now = () => new Date('2026-09-24T09:00:00Z');

test('content is a single external source; summary, free-form Markdown and dependency arrays work through CLI', async (t) => {
  const w = useTempWorkspace(t, 'us-025-content');
  initializeProject(w.root, { name: 'docs', task: '前置' });
  w.write('说明/验证.md', '# 给测试代理\n\n任意结构，原生证据必须保存。');
  const result = await cli(w, 'task', 'add', '--summary', '验证任务', '--content', '说明/验证.md', '--depends-on', 'T-0001', '--json');
  assert.equal(result.code, 0, result.stderr);
  const id = JSON.parse(result.stdout).task.id as string;
  assert.equal(JSON.parse(result.stdout).task.readiness, 'unready');
  let task = loadTaskRepository(w.root).taskById(id)!;
  assert.equal(task.content, '说明/验证.md');
  assert.ok(!task.body.includes('原生证据'));
  assert.ok(!task.body.includes('## 完成条件'));
  assert.match(taskDocuments(w.root, task).content.body!, /原生证据/);
  w.write('说明/验证.md', '# 修订要求\n\n新增第二场景。');
  assert.match(handoffText(w.root, task, { expand: ['content'] }), /新增第二场景/);
  reviseTask(w.root, { id, summary: '验证两场景' });
  task = loadTaskRepository(w.root).taskById(id)!;
  assert.equal(task.summary, '验证两场景');
  assert.equal(task.title, '验证两场景');
  const before = w.read(`.task-graph/tasks/${id}.md`);
  const missing = await cli(w, 'task', 'revise', id, '--content', 'missing.md', '--json');
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'E_DOCUMENT_FILE');
  assert.equal(w.read(`.task-graph/tasks/${id}.md`), before);
});

test('batch creation resolves forward and parent references, gates, and retries without duplicate tasks', async (t) => {
  const w = useTempWorkspace(t, 'us-025-plan');
  initializeProject(w.root, { name: 'plan', task: '已有任务' });
  const plan = {
    graph: 'G-001',
    tasks: [
      { key: 'verify', summary: '验证', depends_on: ['@implement', '@parent:api-ready'] },
      { key: 'implement', summary: '实现' },
      { key: 'child', summary: '子任务', parent_task: '@parent' },
      { key: 'parent', summary: '复合任务', exposes: { 'api-ready': { requires: ['@child'] } } },
    ],
  };
  w.write('plan.json', JSON.stringify(plan));
  const result = await cli(w, 'task', 'add', '--from', 'plan.json', '--json');
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const repo = loadTaskRepository(w.root);
  assert.equal(repo.tasks.length, 5);
  assert.deepEqual(repo.taskById(payload.keys.verify)?.dependsOn, [
    { task: payload.keys.implement, mode: 'full' }, { task: payload.keys.parent, mode: 'partial', gate: 'api-ready' },
  ]);
  assert.equal(repo.taskById(payload.keys.child)?.graph, repo.taskById(payload.keys.parent)?.subgraph?.graph);
  assert.deepEqual(repo.taskById(payload.keys.parent)?.subgraph?.completionRequires, [payload.keys.child]);
  const again = await cli(w, 'task', 'add', '--from', 'plan.json', '--json');
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(JSON.parse(again.stdout).keys, payload.keys);
  assert.equal(loadTaskRepository(w.root).tasks.length, 5);
  plan.tasks[1]!.summary = '改变请求';
  w.write('plan.json', JSON.stringify(plan));
  assert.equal((await cli(w, 'task', 'add', '--from', 'plan.json', '--json')).code, 1);
  assert.equal(loadTaskRepository(w.root).tasks.length, 5);
});

test('a rejected batch restores all sources including an automatically created child graph', (t) => {
  const w = useTempWorkspace(t, 'us-025-rollback');
  initializeProject(w.root, { name: 'plan', task: '根任务' });
  const before = w.listFiles().map((file) => [file, w.read(file)]);
  assert.throws(() => addPlannedTasks(w.root, [
    { summary: '子任务一', key: 'one', parentTask: 'T-0001', dependsOnSpecs: ['@two'] },
    { summary: '子任务二', key: 'two', parentTask: 'T-0001', dependsOnSpecs: ['@one'] },
  ]), (error: unknown) => error instanceof TaskGraphError && /cycle/i.test(error.details.join(' ')));
  assert.deepEqual(w.listFiles().map((file) => [file, w.read(file)]), before);
});

test('reports snapshot their bytes, logs remain live, and saved handoffs preserve the original requirements', (t) => {
  const w = useTempWorkspace(t, 'us-025-snapshots');
  initializeProject(w.root, { name: 'docs', task: '根' });
  w.write('brief.md', '# 原任务要求\n\n验证四势击杀。');
  w.write('report.md', '# 原始报告\n\n通过。');
  w.write('worker-log.md', '# 代理记录\n\n第一轮。');
  const task = addTask(w.root, { summary: '验证', content: 'brief.md' });
  attachDocument(w.root, { id: task.id, kind: 'report', path: 'report.md', title: '首次验证', now });
  attachDocument(w.root, { id: task.id, kind: 'log', path: 'worker-log.md', now });
  addWorkLog(w.root, { id: task.id, text: '主控记录', actor: 'controller', now });
  createHandoff(w.root, { id: task.id, title: '转交测试代理', now });
  w.write('brief.md', '# 新要求');
  w.write('report.md', '# 修改后的报告');
  w.write('worker-log.md', '# 代理记录\n\n第二轮。');
  const docs = taskDocuments(w.root, loadTaskRepository(w.root).taskById(task.id)!);
  assert.match(docs.content.body!, /新要求/);
  assert.match(docs.reports[0]!.body!, /原始报告/);
  assert.equal(docs.logs.length, 2);
  assert.ok(docs.logs.some((log) => log.body!.includes('第二轮')));
  assert.ok(docs.logs.some((log) => log.body!.includes('主控记录')));
  assert.match(docs.handoffs[0]!.body!, /原任务要求/);
  assert.ok(!docs.handoffs[0]!.body!.includes('原始报告'));
  assert.ok(docs.handoffs[0]!.body!.includes(docs.reports[0]!.snapshot!));
});

test('start claims and snapshots atomically; complete attaches reports, logs and releases ownership', async (t) => {
  const w = useTempWorkspace(t, 'us-025-lifecycle');
  initializeProject(w.root, { name: 'life', task: '根' });
  w.write('brief.md', '# 任务要求');
  w.write('report.md', '# 验证通过');
  const task = addTask(w.root, { summary: '执行', content: 'brief.md' });
  const started = await cli(w, 'task', 'start', task.id, '--role', 'tester', '--session-id', 'session-real', '--json');
  assert.equal(started.code, 0, started.stderr);
  const running = loadTaskRepository(w.root).taskById(task.id)!;
  assert.equal(running.claim?.sessionId, 'session-real');
  assert.equal(taskDocuments(w.root, running).handoffs.length, 1);
  const before = w.listFiles().map((file) => [file, w.read(file)]);
  const failure = await cli(w, 'task', 'complete', task.id, '--report', 'report.md', '--report', 'missing.md', '--log', '完成', '--json');
  assert.equal(failure.code, 1);
  assert.deepEqual(w.listFiles().map((file) => [file, w.read(file)]), before);
  const completed = await cli(w, 'task', 'complete', task.id, '--report', 'report.md', '--log', '完成并清理', '--json');
  assert.equal(completed.code, 0, completed.stderr);
  const done = loadTaskRepository(w.root).taskById(task.id)!;
  assert.equal(done.status, 'done');
  assert.equal(done.claim, null);
  assert.ok(done.history.some((event) => event.event === 'released' && event.extra['session_id'] === 'session-real'));
  const docs = taskDocuments(w.root, done);
  assert.equal(docs.reports.length, 1);
  assert.match(docs.logs[0]!.body!, /完成并清理/);
});

test('available excludes blocked, claimed and completed work; handoff preview writes nothing', async (t) => {
  const w = useTempWorkspace(t, 'us-025-available');
  initializeProject(w.root, { name: 'available', task: '前置' });
  const blocked = addTask(w.root, { summary: '后续', dependsOnSpecs: ['T-0001'] });
  assert.throws(() => startTask(w.root, { id: blocked.id, role: 'tester', sessionId: 'a' }), /unready/i);
  const started = startTask(w.root, { id: 'T-0001' });
  completeTask(w.root, { id: started.id });
  const available = await cli(w, 'task', 'list', '--available', '--json');
  assert.deepEqual(JSON.parse(available.stdout).tasks.map((task: { id: string }) => task.id), [blocked.id]);
  const files = w.listFiles().map((file) => [file, w.read(file)]);
  const handoff = await cli(w, 'task', 'show', blocked.id, '--handoff', '--json');
  assert.equal(handoff.code, 0, handoff.stderr);
  assert.match(JSON.parse(handoff.stdout).handoff, /前置/);
  assert.deepEqual(w.listFiles().map((file) => [file, w.read(file)]), files);
});

test('unreadable bindings produce an actionable viewer entry and attachments never execute raw HTML', (t) => {
  const w = useTempWorkspace(t, 'us-025-doc-errors');
  initializeProject(w.root, { name: 'docs', task: '根' });
  w.write('report.md', '# 安全报告\n\n<script>window.reportExecuted=true</script>\n[链接](javascript:alert(1))');
  attachDocument(w.root, { id: 'T-0001', kind: 'report', path: 'report.md' });
  const task = loadTaskRepository(w.root).taskById('T-0001')!;
  const docs = taskDocuments(w.root, task);
  assert.ok(!docs.reports[0]!.html!.includes('<script>'));
  assert.ok(!docs.reports[0]!.html!.includes('href="javascript:'));
  const missing = taskDocuments(w.root, { ...task, content: 'missing.md' });
  assert.match(missing.content.error!, /Cannot read document/);
  assert.equal(createGraphProjection(w.root).tasks[0]!.documents!.reports.length, 1);
});
