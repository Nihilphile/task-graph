import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  CLI_ENTRY,
  runCliProcess,
  runNodeAsync,
  useTempWorkspace,
  type CliResult,
  type TempWorkspace,
} from './helpers/temp.js';
import { openViewer, taskNode, taskNodes } from './helpers/viewer-dom.js';

/** Frozen timestamp so the generated fixture stays deterministic. */
const AT = '2026-09-21T10:00:00+08:00';

const INDEX = '.task-graph/generated/index.html';
const GRAPH_JSON = '.task-graph/generated/graph.json';

interface E2EIds {
  readonly root: string;
  readonly childComposite: string;
  readonly leaf: string;
  readonly partialSuccessor: string;
  readonly blocked: string;
  readonly ready: string;
  readonly convergence: string;
}

interface E2EGraphs {
  readonly entryA: string;
  readonly child: string;
  readonly grandchild: string;
  readonly entryB: string;
}

interface E2EFixture {
  readonly workspace: TempWorkspace;
  readonly indexFile: string;
  readonly ids: E2EIds;
  readonly graphs: E2EGraphs;
}

interface Projection {
  version: number;
  project: { name: string; entryGraphs: string[] };
  graphs: { id: string; title: string; entry: boolean; parentTask: string | null }[];
  sources: { id: string; file: string; confirmedAt: string }[];
  tasks: {
    id: string;
    graph: string;
    title: string;
    status: string;
    claim: { role: string; sessionId: string; claimedAt: string } | null;
    dependsOn: { task: string; mode: string; gate?: string }[];
    manualBlockers: string[];
    subgraph: { graph: string; completionRequires: string[]; exposes: { name: string }[] } | null;
    derivedFrom: string[];
    readiness: string;
    html: string;
  }[];
  relationships: {
    full: { from: string; to: string }[];
    partial: { from: string; to: string; gate?: string }[];
    derives: { from: string; to: string }[];
    parent: { from: string; to: string }[];
  };
}

function cli(workspace: TempWorkspace, args: readonly string[], expected = 0): CliResult {
  const result = runCliProcess(args, { cwd: workspace.root });
  assert.equal(
    result.code,
    expected,
    `task-graph ${args.join(' ')} exited ${result.code} (expected ${expected})\n${result.stderr}${result.stdout}`,
  );
  return result;
}

function cliJson<T>(workspace: TempWorkspace, args: readonly string[]): T {
  return JSON.parse(cli(workspace, [...args, '--json']).stdout) as T;
}

function readProjection(workspace: TempWorkspace): Projection {
  return JSON.parse(workspace.read(GRAPH_JSON)) as Projection;
}

/** Every file byte, so a rejected mutation can be proven to change nothing. */
function snapshot(workspace: TempWorkspace): [string, string][] {
  return workspace.listFiles().map((file) => [file, workspace.readBuffer(file).toString('base64')]);
}

/**
 * Builds the end-to-end fixture exclusively through the public CLI: two entry
 * graphs, a two-level subgraph hierarchy, full dependencies, a named partial
 * dependency, a PRD source, claims and a manual blocker.
 */
function buildFixture(workspace: TempWorkspace): E2EFixture {
  cli(workspace, [
    'init',
    '--name',
    '交付平台',
    '--task',
    '交付登录能力',
    '--graph-title',
    '登录能力交付',
    '--goal',
    '交付可用的登录能力',
    '--condition',
    '登录可用',
    '--work-log',
    '已立项',
  ]);
  cli(workspace, [
    'source',
    'add',
    '--id',
    'PRD-001',
    '--file',
    'docs/prd-login.md',
    '--confirmed-at',
    AT,
  ]);

  const child = cliJson<{ graph: { id: string } }>(workspace, [
    'graph',
    'add',
    '--title',
    '登录子图',
    '--parent-task',
    'T-0001',
  ]).graph.id;
  const childComposite = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    child,
    '--title',
    '完成登录接口',
    '--goal',
    '实现登录接口',
    '--condition',
    '接口通过联调',
    '--derived-from',
    'PRD-001',
  ]).task.id;
  const grandchild = cliJson<{ graph: { id: string } }>(workspace, [
    'graph',
    'add',
    '--title',
    '接口联调',
    '--parent-task',
    childComposite,
  ]).graph.id;
  const leaf = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    grandchild,
    '--title',
    '联调接口',
    '--goal',
    '完成三方联调',
    '--condition',
    '联调通过',
  ]).task.id;
  cli(workspace, ['task', 'set-completion', childComposite, '--requires', leaf]);
  cli(workspace, ['task', 'set-completion', 'T-0001', '--requires', childComposite]);
  cli(workspace, ['task', 'expose-gate', 'T-0001', '--name', 'api-ready', '--requires', childComposite]);
  const entryB = cliJson<{ graph: { id: string } }>(workspace, [
    'graph',
    'add',
    '--title',
    '官网发布',
    '--entry',
  ]).graph.id;

  const partialSuccessor = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    'G-001',
    '--title',
    '接入前端',
    '--goal',
    '前端接入登录',
    '--condition',
    '页面可登录',
    '--depends-on',
    'T-0001:api-ready',
  ]).task.id;
  cli(workspace, [
    'task',
    'claim',
    partialSuccessor,
    '--role',
    'implementer',
    '--session-id',
    'thread-1',
  ]);
  const blocked = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    'G-001',
    '--title',
    '接入支付',
    '--goal',
    '接入支付渠道',
  ]).task.id;
  cli(workspace, ['task', 'block', blocked, '--reason', '等待设计稿']);
  const ready = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    'G-001',
    '--title',
    '编写发布说明',
    '--goal',
    '整理发布说明',
  ]).task.id;
  const convergence = cliJson<{ task: { id: string } }>(workspace, [
    'task',
    'add',
    '--graph',
    'G-001',
    '--title',
    '上线评审',
    '--goal',
    '完成上线评审',
  ]).task.id;
  cli(workspace, ['task', 'link', convergence, '--depends-on', blocked]);
  cli(workspace, ['task', 'link', convergence, '--depends-on', ready]);

  cli(workspace, ['task', 'start', leaf]);
  cli(workspace, ['task', 'complete', leaf]);
  cli(workspace, ['task', 'start', childComposite]);
  cli(workspace, ['task', 'complete', childComposite]);
  cli(workspace, ['task', 'start', partialSuccessor]);

  return {
    workspace,
    indexFile: path.join(workspace.root, '.task-graph', 'generated', 'index.html'),
    ids: {
      root: 'T-0001',
      childComposite,
      leaf,
      partialSuccessor,
      blocked,
      ready,
      convergence,
    },
    graphs: { entryA: 'G-001', child, grandchild, entryB },
  };
}

test('US-023: the CLI builds a full fixture and validates it', (t) => {
  const workspace = useTempWorkspace(test, '任务图-端到端');
  assert.ok(workspace.root.includes('任务图'), `temp workspace must use a Chinese path: ${workspace.root}`);
  const fixture = buildFixture(workspace);

  const validation = cliJson<{ ok: boolean; issues: unknown[] }>(workspace, ['validate']);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.issues, []);

  const data = readProjection(workspace);
  assert.equal(data.project.name, '交付平台');
  assert.deepEqual(data.project.entryGraphs, [fixture.graphs.entryA, fixture.graphs.entryB]);
  assert.deepEqual(
    data.graphs.map((graph) => graph.id),
    [fixture.graphs.entryA, fixture.graphs.child, fixture.graphs.grandchild, fixture.graphs.entryB],
  );
  assert.equal(data.graphs.find((graph) => graph.id === fixture.graphs.child)?.parentTask, fixture.ids.root);
  assert.equal(
    data.graphs.find((graph) => graph.id === fixture.graphs.grandchild)?.parentTask,
    fixture.ids.childComposite,
  );
  assert.deepEqual(data.sources, [{ id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: AT }]);
  assert.deepEqual(data.relationships.parent, [
    { from: fixture.ids.root, to: fixture.graphs.child },
    { from: fixture.ids.childComposite, to: fixture.graphs.grandchild },
  ]);
  assert.deepEqual(data.relationships.partial, [
    { from: fixture.ids.root, to: fixture.ids.partialSuccessor, gate: 'api-ready' },
  ]);
  assert.deepEqual(data.relationships.derives, [
    { from: 'PRD-001', to: fixture.ids.childComposite },
  ]);
  assert.deepEqual(data.relationships.full, [
    { from: fixture.ids.blocked, to: fixture.ids.convergence },
    { from: fixture.ids.ready, to: fixture.ids.convergence },
  ]);

  const successor = data.tasks.find((task) => task.id === fixture.ids.partialSuccessor)!;
  assert.equal(successor.status, 'in_progress');
  assert.equal(successor.claim?.role, 'implementer');
  assert.equal(successor.claim?.sessionId, 'thread-1');
  assert.match(successor.claim?.claimedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(successor.readiness, 'ready', 'the named completion point is satisfied');
  const blocked = data.tasks.find((task) => task.id === fixture.ids.blocked)!;
  assert.deepEqual(blocked.manualBlockers, ['等待设计稿']);
  assert.equal(blocked.readiness, 'blocked');
  assert.equal(data.tasks.find((task) => task.id === fixture.ids.convergence)?.readiness, 'blocked');
  const composite = data.tasks.find((task) => task.id === fixture.ids.childComposite)!;
  assert.equal(composite.status, 'done');
  assert.deepEqual(composite.subgraph, {
    graph: fixture.graphs.grandchild,
    completionRequires: [fixture.ids.leaf],
    exposes: [],
  });
  assert.equal(workspace.exists(INDEX), true);
});

test('US-023: Chinese task content round-trips through the CLI and the projection', (t) => {
  const fixture = buildFixture(useTempWorkspace(test, '任务图-中文内容'));
  const { workspace, ids } = fixture;

  const markdown = workspace.read(`.task-graph/tasks/${ids.partialSuccessor}.md`);
  for (const text of ['# 接入前端', '## 目标', '前端接入登录', '## 完成条件', '页面可登录']) {
    assert.ok(markdown.includes(text), `task Markdown lost "${text}"`);
  }
  assert.ok(markdown.includes('role: implementer'));

  const data = readProjection(workspace);
  const task = data.tasks.find((entry) => entry.id === ids.partialSuccessor)!;
  assert.equal(task.title, '接入前端');
  assert.ok(task.html.includes('前端接入登录'), 'rendered Markdown must keep UTF-8 content');

  // The generated viewer is written next to the Chinese workspace path too.
  assert.ok(workspace.read(INDEX).includes('交付平台'));
});

test('US-023: reopening the fixture reloads persisted state from disk', (t) => {
  const fixture = buildFixture(useTempWorkspace(test, '任务图-重开'));
  const { workspace, ids } = fixture;
  const before = workspace.read(`.task-graph/tasks/${ids.childComposite}.md`);
  assert.ok(before.includes('status: done'));

  // A fresh CLI process validates and reopens the finished composite task.
  const reopened = cliJson<{ task: { id: string; status: string } }>(workspace, [
    'task',
    'reopen',
    ids.childComposite,
    '--reason',
    '回归验证',
  ]);
  assert.equal(reopened.task.status, 'in_progress');
  assert.equal(readProjection(workspace).tasks.find((task) => task.id === ids.childComposite)?.status, 'in_progress');

  cli(workspace, ['task', 'complete', ids.childComposite]);
  assert.equal(readProjection(workspace).tasks.find((task) => task.id === ids.childComposite)?.status, 'done');
  // Rebuilding an unchanged fixture is byte-stable, which is how "reopen" proves
  // it read the same source state again.
  const snapshotAfter = workspace.read(GRAPH_JSON);
  cli(workspace, ['build']);
  assert.equal(workspace.read(GRAPH_JSON), snapshotAfter);
});

test('US-023: a rejected cyclic mutation leaves every source byte unchanged', (t) => {
  const fixture = buildFixture(useTempWorkspace(test, '任务图-环'));
  const { workspace, ids } = fixture;
  const before = snapshot(workspace);

  // The convergence task already depends on the blocked task, so the reverse
  // edge closes a cycle and must be refused before anything is written.
  const result = cli(workspace, ['task', 'link', ids.blocked, '--depends-on', ids.convergence], 1);
  assert.match(result.stderr, /Cycle path/);
  assert.ok(result.stderr.includes(ids.blocked));
  assert.ok(result.stderr.includes(ids.convergence));
  assert.deepEqual(snapshot(workspace), before);

  // The rejected command also left the graph valid and completable.
  assert.equal(cliJson<{ ok: boolean }>(workspace, ['validate']).ok, true);
  cli(workspace, ['task', 'unlink', ids.convergence, '--depends-on', ids.ready]);
  assert.equal(cliJson<{ ok: boolean }>(workspace, ['validate']).ok, true);
});

test('US-023: concurrent task creation yields unique IDs and valid output', async (t) => {
  const fixture = buildFixture(useTempWorkspace(test, '任务图-并发'));
  const { workspace } = fixture;

  const [left, right] = await Promise.all([
    runNodeAsync([CLI_ENTRY, 'task', 'add', '--graph', 'G-001', '--title', '并发任务甲', '--json'], {
      cwd: workspace.root,
    }),
    runNodeAsync([CLI_ENTRY, 'task', 'add', '--graph', 'G-001', '--title', '并发任务乙', '--json'], {
      cwd: workspace.root,
    }),
  ]);
  assert.equal(left.code, 0, left.stderr);
  assert.equal(right.code, 0, right.stderr);
  const leftId = (JSON.parse(left.stdout) as { task: { id: string } }).task.id;
  const rightId = (JSON.parse(right.stdout) as { task: { id: string } }).task.id;
  assert.notEqual(leftId, rightId, 'concurrent creation must not reuse an ID');

  assert.equal(cliJson<{ ok: boolean }>(workspace, ['validate']).ok, true);
  const built = cliJson<{ ok: boolean; file: string; tasks: number }>(workspace, ['build']);
  assert.equal(built.ok, true);
  assert.equal(built.file, GRAPH_JSON);

  const data = readProjection(workspace);
  for (const id of [leftId, rightId]) {
    const task = data.tasks.find((entry) => entry.id === id);
    assert.ok(task, `${id} is missing from the projection`);
    assert.equal(task.graph, 'G-001');
    assert.ok(workspace.read(`.task-graph/tasks/${id}.md`).includes(`id: ${id}`));
  }
  assert.equal(data.tasks.length, built.tasks);

  // No temporary scratch file survived the concurrent writes.
  assert.deepEqual(
    workspace.listFiles().filter((file) => file.includes('.tmp-')),
    [],
  );
});

test('US-023: the generated viewer runs offline through the file protocol', async (t) => {
  const fixture = buildFixture(useTempWorkspace(test, '任务图-离线'));
  const { workspace, ids } = fixture;

  const html = workspace.read(INDEX);
  assert.equal(/<script[^>]+src=/.test(html), false, 'the viewer must inline every script');
  assert.equal(html.includes('<link '), false, 'the viewer must not load external styles');

  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());
  assert.deepEqual([...page.errors], []);
  assert.equal(page.window.location.protocol, 'file:');

  // The whole fixture is navigable offline: entry graph, both nesting levels,
  // state colours, claims and the PRD source lane.
  assert.deepEqual(
    [...page.document.querySelectorAll('#graph-list button')].map((button) => button.textContent),
    ['G-001 \u00b7 登录能力交付', 'G-004 \u00b7 官网发布'],
  );
  assert.equal(taskNodes(page).length, 5);
  assert.ok((taskNode(page, ids.blocked).getAttribute('class') ?? '').includes('readiness-blocked'));

  const drill = (taskId: string): void => {
    taskNode(page, taskId).dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const button = page.document.querySelector('#details-body .composite-button');
    assert.ok(button, `task ${taskId} must expose its child graph`);
    button.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  drill(ids.root);
  assert.equal(page.window.location.hash, `#graph=${fixture.graphs.child}`);
  drill(ids.childComposite);
  assert.equal(page.window.location.hash, `#graph=${fixture.graphs.grandchild}`);
  assert.deepEqual(
    taskNodes(page).map((node) => node.getAttribute('data-task')),
    [ids.leaf],
  );
  assert.equal(page.document.querySelectorAll('#graph g.node.source').length, 0);

  // Back in the child graph the PRD source node is part of the offline render.
  page.window.location.hash = `#graph=${fixture.graphs.child}`;
  page.window.dispatchEvent(new page.window.HashChangeEvent('hashchange'));
  assert.equal(page.document.querySelectorAll('#graph g.node.source').length, 1);
  assert.equal(page.document.querySelectorAll('#graph path.edge-derives').length, 1);
});
