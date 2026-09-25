import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { main } from '../src/cli/main.js';
import { type GitHubClient } from '../src/core/github-client.js';
import { readGitHubState } from '../src/core/github-state.js';
import { useTempWorkspace } from './helpers/temp.js';
import { createGraphProjection } from '../src/core/projection.js';
import { openViewer, click, taskNode } from './helpers/viewer-dom.js';

type Issue = { id: number; number: number; html_url: string; title: string; body: string; state: string; state_reason?: string };
class FakeGitHub implements GitHubClient {
  issues: Issue[] = [];
  comments = new Map<number, { id: number; body: string }[]>();
  children = new Map<number, number[]>();
  dependencies = new Map<number, number[]>();
  calls: { method: string; endpoint: string; body?: Record<string, unknown> }[] = [];
  offline = false;
  dropIssue = false;
  dropComment = false;
  duringRequest?: () => void;
  request(method: string, endpoint: string, body?: Record<string, unknown>): unknown {
    this.calls.push({ method, endpoint, body });
    if (this.offline) throw new Error('Simulated network unavailable');
    this.duringRequest?.();
    const url = new URL('https://api.github.com/' + endpoint);
    const match = /^\/repos\/([^/]+\/[^/]+)\/issues(?:\/(\d+))?(.*)$/.exec(url.pathname);
    assert.ok(match, endpoint);
    const repo = match[1]!; const number = Number(match[2]); const suffix = match[3];
    const paged = <T>(items: T[]): T[] => items.slice((Number(url.searchParams.get('page') ?? 1) - 1) * 100, Number(url.searchParams.get('page') ?? 1) * 100);
    if (!number) {
      if (method === 'GET') return structuredClone(paged(this.issues.filter(i => i.html_url.startsWith('https://github.com/' + repo + '/'))));
      assert.equal(method, 'POST');
      const issue: Issue = { id: this.issues.length + 1001, number: this.issues.length + 1,
        html_url: `https://github.com/${repo}/issues/${this.issues.length + 1}`, title: String(body?.title), body: String(body?.body), state: 'open' };
      this.issues.push(issue);
      if (this.dropIssue) { this.dropIssue = false; throw new Error('Issue response lost'); }
      return structuredClone(issue);
    }
    const issue = this.issues.find(i => i.number === number)!;
    assert.ok(issue, endpoint);
    if (!suffix) {
      if (method === 'PATCH') Object.assign(issue, body);
      else assert.equal(method, 'GET');
      return structuredClone(issue);
    }
    if (suffix === '/comments') {
      const comments = this.comments.get(number) ?? []; this.comments.set(number, comments);
      if (method === 'GET') return structuredClone(paged(comments));
      const comment = { id: comments.length + 1, body: String(body?.body) }; comments.push(comment);
      if (this.dropComment) { this.dropComment = false; throw new Error('Comment response lost'); }
      return structuredClone(comment);
    }
    if (suffix === '/sub_issues') {
      const children = this.children.get(number) ?? []; this.children.set(number, children);
      if (method === 'GET') return structuredClone(paged(this.issues.filter(i => children.includes(i.id))));
      assert.equal(method, 'POST'); assert.equal(typeof body?.sub_issue_id, 'number');
      assert.ok(!children.includes(Number(body?.sub_issue_id)), 'duplicate child request');
      children.push(Number(body?.sub_issue_id)); return {};
    }
    if (suffix?.startsWith('/dependencies/blocked_by')) {
      const deps = this.dependencies.get(number) ?? []; this.dependencies.set(number, deps);
      if (method === 'GET') return structuredClone(paged(deps.map(id => ({ id }))));
      if (method === 'POST') { assert.ok(!deps.includes(Number(body?.issue_id)), 'duplicate dependency request'); deps.push(Number(body?.issue_id)); }
      else if (method === 'DELETE') this.dependencies.set(number, deps.filter(id => id !== Number(suffix.split('/').at(-1))));
      return {};
    }
    throw new Error('Unhandled fake request ' + endpoint);
  }
}
function setup(t: TestContext) {
  const ws = useTempWorkspace(t, 'github-sync'); const remote = new FakeGitHub();
  async function run(...args: string[]) {
    const out: string[] = []; const err: string[] = [];
    const code = await main([...args, '--json'], { cwd: ws.root, githubClient: remote, io: { out: text => out.push(text), err: text => err.push(text) } });
    assert.equal(code, 0, err.join('\n'));
    return JSON.parse(out.join('\n'));
  }
  const issue = (key: string): Issue => { const state = readGitHubState(ws.root); return remote.issues.find(i => i.number === (state?.issues[key] ?? state?.issues[`graph:${key}`])?.number)!; };
  return { ws, remote, run, issue };
}

test('GitHub opt-in persists, subgraphs reuse parent issues, full and partial dependencies use database IDs', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init'); await run('graph', 'add', '--entry', '--title', 'Delivery', '--gh', '--repo', 'example/project');
  await run('task', 'add', '--graph', 'G-001', '--summary', 'Parent');
  await run('task', 'add', '--parent-task', 'T-0001', '--summary', 'Child');
  await run('task', 'expose-gate', 'T-0001', '--name', 'phase', '--requires', 'T-0002');
  await run('task', 'add', '--graph', 'G-001', '--summary', 'Follow-up', '--depends-on', 'T-0001:phase');
  await run('task', 'add', '--graph', 'G-001', '--summary', 'Final', '--depends-on', 'T-0001', '--depends-on', 'T-0003');
  assert.equal(remote.issues.length, 5);
  assert.deepEqual(remote.children.get(issue('T-0001').number), [issue('T-0002').id]);
  assert.deepEqual(remote.dependencies.get(issue('T-0003').number), [issue('T-0002').id]);
  assert.deepEqual(remote.dependencies.get(issue('T-0004').number), [issue('T-0001').id, issue('T-0003').id]);
  const view = createGraphProjection(ws.root);
  assert.equal(view.graphs.find(g => !g.entry)?.github?.url, issue('T-0001').html_url);
  assert.equal(view.tasks[0]?.github?.status, 'synced');
});

test('Reports and logs are posted before closure, immutable snapshots survive source edits, reopen preserves human text/comments', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init', '--task', 'Work'); await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  await run('task', 'start', 'T-0001', '--role', 'tester', '--session-id', 'session');
  assert.match(issue('T-0001').body, /in_progress[\s\S]*tester \/ session/);
  ws.write('report.md', '# Original report\nPassed.');
  await run('task', 'complete', 'T-0001', '--report', 'report.md', '--log', 'Validated both cases');
  assert.equal(issue('T-0001').state, 'closed'); assert.equal(issue('G-001').state, 'closed');
  const number = issue('T-0001').number;
  const comments = remote.comments.get(number)!;
  assert.equal(comments.filter(c => c.body.includes('Validated both cases')).length, 1);
  assert.equal(comments.filter(c => c.body.startsWith('## report') && c.body.includes('Original report')).length, 1);
  const reportCall = remote.calls.findIndex(c => c.method === 'POST' && c.endpoint.endsWith('/comments') && String(c.body?.body).includes('Original report'));
  const closeCall = remote.calls.findIndex(c => c.method === 'PATCH' && c.endpoint.endsWith('/' + number) && c.body?.state === 'closed');
  assert.ok(reportCall < closeCall);
  ws.write('report.md', '# Rewritten later');
  comments.push({ id: 9000, body: 'Human review' });
  issue('T-0001').body += '\nHuman appendix';
  await run('build'); await run('task', 'reopen', 'T-0001', '--reason', 'More checks');
  assert.equal(issue('T-0001').state, 'open'); assert.equal(issue('G-001').state, 'open');
  assert.ok(issue('T-0001').body.endsWith('Human appendix'));
  assert.equal(comments.filter(c => c.body.startsWith('## report') && c.body.includes('Original report')).length, 1);
  assert.ok(!comments.some(c => c.body.includes('Rewritten later')));
  assert.ok(comments.some(c => c.body === 'Human review'));
});

test('Network failures keep local success and durable outbox; lost create and comment responses retry without duplication', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init'); remote.dropIssue = true;
  const created = await run('graph', 'add', '--entry', '--title', 'Delivery', '--gh', '--repo', 'example/project');
  assert.equal(created.github.status, 'pending'); assert.equal(remote.issues.length, 1);
  await run('github', 'sync'); assert.equal(remote.issues.length, 1);
  await run('task', 'add', '--summary', 'Test'); remote.offline = true;
  const saved = await run('task', 'log', 'T-0001', '--text', 'Offline progress');
  assert.equal(saved.ok, true); assert.equal(saved.github.status, 'pending'); assert.equal(saved.github.pendingComments, 1);
  assert.match(ws.read('.task-graph/logs/T-0001.md'), /Offline progress/);
  remote.offline = false; remote.dropComment = true;
  assert.equal((await run('github', 'sync')).github.status, 'pending');
  assert.equal((await run('github', 'sync')).github.status, 'synced');
  assert.equal(remote.comments.get(issue('T-0001').number)?.length, 1);
});

test('No opt-in means no network; queries remain read-only, build publishes direct content edits', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init', '--task', 'Old'); await run('build'); assert.equal(remote.calls.length, 0); assert.equal(ws.exists('.task-graph/github-sync.json'), false);
  ws.write('requirements.md', '# Version one');
  await run('task', 'add', '--summary', 'Content', '--content', 'requirements.md');
  await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  ws.write('requirements.md', '# Version two');
  const saved = ws.read('.task-graph/github-sync.json'); const calls = remote.calls.length;
  await run('task', 'list'); await run('task', 'show', 'T-0002'); await run('validate');
  assert.equal(remote.calls.length, calls); assert.equal(ws.read('.task-graph/github-sync.json'), saved);
  assert.equal(createGraphProjection(ws.root).tasks[1]?.github?.status, 'pending');
  await run('build'); assert.match(issue('T-0002').body, /Version two/);
});

test('Removing dependencies deletes only tool-owned edges', async t => {
  const { remote, run, issue } = setup(t);
  await run('init', '--task', 'First'); await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  await run('task', 'add', '--summary', 'Second', '--depends-on', 'T-0001');
  remote.dependencies.get(issue('T-0002').number)!.push(9999);
  await run('task', 'unlink', 'T-0002', '--depends-on', 'T-0001');
  assert.deepEqual(remote.dependencies.get(issue('T-0002').number), [9999]);
});

test('Large reports are chunked without truncation; lost responses found beyond first page', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init', '--task', 'Report'); await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  const number = issue('T-0001').number;
  remote.comments.set(number, Array.from({ length: 110 }, (_, i) => ({ id: i + 1, body: 'Human ' + i })));
  ws.write('report.md', '# Long report\n' + '中文🍀'.repeat(18000) + '\nREPORT-END');
  remote.dropComment = true; await run('task', 'report', 'attach', 'T-0001', '--path', 'report.md');
  await run('github', 'sync');
  const posted = remote.comments.get(number)!.slice(110);
  assert.ok(posted.length >= 3); assert.ok(posted.every(c => c.body.length < 65536));
  assert.equal(posted.filter(c => c.body.includes('# Long report')).length, 1);
  assert.ok(posted.at(-1)?.body.includes('REPORT-END'));
});

test('Corrupt state and busy sync stop remote writes without rolling back local work', async t => {
  const { ws, remote, run } = setup(t);
  await run('init', '--task', 'Work'); await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  const good = ws.read('.task-graph/github-sync.json'); const count = remote.calls.length;
  ws.write('.task-graph/github-sync.json', '{broken');
  const result = await run('task', 'log', 'T-0001', '--text', 'Still saved');
  assert.equal(result.github.status, 'pending'); assert.equal(ws.read('.task-graph/github-sync.json'), '{broken'); assert.equal(remote.calls.length, count);
  ws.write('.task-graph/github-sync.json', good);
  ws.write('.task-graph/github-sync.lock', JSON.stringify({ pid: process.pid, token: 'another' }));
  const busy = await run('github', 'sync'); assert.equal(busy.github.status, 'pending'); assert.equal(remote.calls.length, count);
});

test('Concurrent source edits remain pending until the next sync', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init'); await run('graph', 'add', '--title', 'Work', '--entry');
  ws.write('content.md', 'Initial'); await run('task', 'add', '--summary', 'Changing', '--content', 'content.md');
  remote.duringRequest = () => { ws.write('content.md', 'Changed while syncing'); remote.duringRequest = undefined; };
  const result = await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  assert.equal(result.github.status, 'pending');
  await run('github', 'sync'); assert.match(issue('T-0001').body, /Changed while syncing/);
});

test('Offline HTML shows graph/task links and pending status without network', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init', '--task', 'Work'); await run('graph', 'publish', 'G-001', '--repo', 'example/project');
  await run('task', 'output', 'add', 'T-0001', '--path', 'not-yet-created.txt');
  assert.equal(readGitHubState(ws.root)?.status, 'synced');
  const page = await openViewer(ws.paths.indexHtmlFile); t.after(() => page.close());
  assert.equal(page.document.querySelector('.github-sync a')?.getAttribute('href'), issue('G-001').html_url);
  click(page, taskNode(page, 'T-0001'));
  assert.equal(page.document.querySelector('.github-sync a')?.getAttribute('href'), issue('T-0001').html_url);
  assert.match(page.document.querySelector('.github-sync')?.textContent ?? '', /已同步/); assert.deepEqual(page.errors, []);
  remote.offline = true; await run('task', 'log', 'T-0001', '--text', 'Queued');
  const pending = await openViewer(ws.paths.indexHtmlFile, { hash: '#graph=G-001&task=T-0001' }); t.after(() => pending.close());
  assert.match(pending.document.querySelector('.github-sync')?.textContent ?? '', /待同步/); assert.deepEqual(pending.errors, []);
});

test('Batch forward references and replay keep one remote issue per task', async t => {
  const { ws, remote, run, issue } = setup(t);
  await run('init'); await run('graph', 'add', '--entry', '--title', 'Batch', '--gh', '--repo', 'example/project');
  ws.write('plan.json', JSON.stringify({ tasks: [
    { key: 'second', summary: 'Second', graph: 'G-001', depends_on: ['@first'] },
    { key: 'first', summary: 'First', graph: 'G-001' },
  ] }));
  await run('task', 'add', '--from', ws.file('plan.json'));
  await run('task', 'add', '--from', ws.file('plan.json'));
  assert.equal(remote.issues.length, 3);
  assert.deepEqual(remote.dependencies.get(issue('T-0001').number), [issue('T-0002').id]);
});

test('Invalid repo or missing opt-in fails before graph creation; published repo cannot be switched', async t => {
  const { ws, remote, run } = setup(t);
  await run('init');
  const invoke = (args: string[]) => main(args, { cwd: ws.root, githubClient: remote, io: { out: () => {}, err: () => {} } });
  for (const args of [ ['--gh', '--repo', 'example/..'], ['--repo', 'example/project'] ]) {
    assert.notEqual(await invoke(['graph', 'add', '--entry', '--title', 'Invalid', ...args]), 0);
  }
  assert.equal(createGraphProjection(ws.root).graphs.length, 0); assert.equal(remote.calls.length, 0);
  await run('graph', 'add', '--entry', '--title', 'Valid', '--gh', '--repo', 'example/project');
  assert.notEqual(await invoke(['graph', 'publish', 'G-001', '--repo', 'example/another']), 0);
  assert.equal(readGitHubState(ws.root)?.issues['graph:G-001']?.repo, 'example/project');
});

test('Custom graph IDs cannot collide with task issue identities', async t => {
  const { ws, remote, run } = setup(t);
  await run('init');
  await run('graph', 'add', '--id', 'T-0001', '--title', 'Custom graph', '--entry', '--gh', '--repo', 'example/project');
  await run('task', 'add', '--graph', 'T-0001', '--summary', 'Actual task');
  const state = readGitHubState(ws.root)!;
  assert.equal(remote.issues.length, 2);
  assert.notEqual(state.issues['graph:T-0001']?.id, state.issues['T-0001']?.id);
});
