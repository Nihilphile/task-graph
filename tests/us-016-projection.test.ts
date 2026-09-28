import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { linkTask } from '../src/core/deps.js';
import { exposeCompletionPoint, setCompletionRequires } from '../src/core/composites.js';
import { claimTask } from '../src/core/claims.js';
import { addManualBlocker } from '../src/core/blockers.js';
import { startTask, completeTask } from '../src/core/lifecycle.js';
import { registerSource } from '../src/core/sources.js';
import { buildProject } from '../src/core/build.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const AT = '2026-09-21T10:00:00+08:00';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

interface Projection {
  version: number;
  project: { name: string; schemaVersion: number; entryGraphs: string[] };
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
    blockedBy: { kind: string }[];
    body: string;
    html: string;
  }[];
  relationships: {
    full: { from: string; to: string }[];
    partial: { from: string; to: string; gate?: string }[];
    derives: { from: string; to: string }[];
    parent: { from: string; to: string }[];
  };
}

function readProjection(workspace: TempWorkspace): Projection {
  return JSON.parse(workspace.read('.task-graph/generated/graph.json')) as Projection;
}

/** Deletes the whole generated directory, as a fresh checkout would. */
function removeGenerated(workspace: TempWorkspace): void {
  rmSync(path.join(workspace.root, '.task-graph', 'generated'), {
    recursive: true,
    force: true,
  });
}

interface Fixture {
  readonly workspace: TempWorkspace;
  readonly composite: string;
  readonly inner: string;
  readonly inner2: string;
  readonly successor: string;
}

/** A project exercising every projection feature at once. */
function buildFixture(workspace: TempWorkspace): Fixture {
  initializeProject(workspace.root, { name: '投影项目', task: '交付登录能力' });
  registerSource(workspace.root, { id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: AT });
  const child = addGraph(workspace.root, { title: '登录子图', parentTask: 'T-0001' });
  addGraph(workspace.root, { title: '官网发布', entry: true });
  const inner = addTask(workspace.root, {
    graph: child.graph.id,
    title: '实现接口',
    derivedFrom: ['PRD-001'],
    now: fixedClock(),
  });
  const inner2 = addTask(workspace.root, { graph: child.graph.id, title: '补齐测试', now: fixedClock() });
  setCompletionRequires(workspace.root, { task: 'T-0001', requires: [inner.id, inner2.id] });
  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [inner.id],
  });
  const successor = addTask(workspace.root, {
    graph: 'G-001',
    title: '接入前端',
    now: fixedClock(),
  });
  linkTask(workspace.root, { successor: successor.id, predecessor: 'T-0001', gate: 'api-ready' });
  claimTask(workspace.root, {
    id: successor.id,
    role: 'implementer',
    sessionId: 'thread-1',
    now: fixedClock(),
  });
  addManualBlocker(workspace.root, { id: successor.id, reason: '等待设计稿', now: fixedClock() });
  const extra = addTask(workspace.root, { graph: 'G-001', title: '发布公告', now: fixedClock() });
  linkTask(workspace.root, { successor: extra.id, predecessor: successor.id });
  completeTask(workspace.root, {
    id: startTask(workspace.root, { id: inner.id, now: fixedClock() }).id,
    now: fixedClock(),
  });
  return {
    workspace,
    composite: 'T-0001',
    inner: inner.id,
    inner2: inner2.id,
    successor: successor.id,
  };
}

test('US-016: build writes the full deterministic projection', () => {
  const fixture = buildFixture(useTempWorkspace(test, 'us-016-shape'));
  const { workspace } = fixture;
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  const data = readProjection(workspace);
  assert.equal(data.version, 2);
  assert.deepEqual(data.project, {
    name: '投影项目',
    schemaVersion: 1,
    entryGraphs: ['G-001', 'G-003'],
  });
  assert.deepEqual(
    data.graphs.map((graph) => graph.id),
    ['G-001', 'G-002', 'G-003'],
  );
  assert.deepEqual(
    data.graphs.find((graph) => graph.id === 'G-002'),
    { id: 'G-002', title: '登录子图', entry: false, parentTask: 'T-0001' },
  );
  assert.deepEqual(data.sources, [
    { id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: AT },
  ]);

  const successor = data.tasks.find((task) => task.id === fixture.successor)!;
  assert.equal(successor.graph, 'G-001');
  assert.equal(successor.status, 'blocked');
  assert.deepEqual(successor.claim, {
    role: 'implementer',
    sessionId: 'thread-1',
    claimedAt: AT,
  });
  assert.deepEqual(successor.dependsOn, [
    { task: 'T-0001', mode: 'partial', gate: 'api-ready' },
  ]);
  assert.deepEqual(successor.manualBlockers, ['等待设计稿']);
  assert.equal(successor.readiness, 'ready');
  assert.deepEqual(
    successor.blockedBy.map((reason) => reason.kind),
    ['manual'],
  );

  const composite = data.tasks.find((task) => task.id === fixture.composite)!;
  assert.deepEqual(composite.subgraph, {
    graph: 'G-002',
    completionRequires: [fixture.inner, fixture.inner2],
    exposes: [{ name: 'api-ready', requires: [fixture.inner] }],
  });

  // Rendered Markdown plus the untouched source body.
  const inner = data.tasks.find((task) => task.id === fixture.inner)!;
  assert.equal(inner.status, 'done');
  assert.ok(inner.body.startsWith('# 实现接口'));
  assert.ok(inner.html.includes('<h1'));
  assert.ok(inner.html.includes('实现接口'));
  assert.ok(inner.html.includes('<h2'));
});

test('US-016: the projection carries every relationship kind', () => {
  const fixture = buildFixture(useTempWorkspace(test, 'us-016-relationships'));
  const { workspace } = fixture;
  const data = readProjection(workspace);

  assert.deepEqual(data.relationships.partial, [
    { from: 'T-0001', to: fixture.successor, gate: 'api-ready' },
  ]);
  assert.deepEqual(data.relationships.derives, [
    { from: 'PRD-001', to: fixture.inner },
  ]);
  assert.deepEqual(data.relationships.parent, [{ from: 'T-0001', to: 'G-002' }]);
  assert.deepEqual(data.relationships.full, [
    { from: fixture.successor, to: data.tasks.find((task) => task.title === '发布公告')!.id },
  ]);

  // Task and graph ordering is derived from IDs, not file order.
  assert.deepEqual(
    data.tasks.map((task) => task.id),
    [...data.tasks.map((task) => task.id)].sort(),
  );
});

test('US-016: identical input produces byte-identical projections', () => {
  const first = buildFixture(useTempWorkspace(test, 'us-016-determinism-a')).workspace;
  const second = buildFixture(useTempWorkspace(test, 'us-016-determinism-b')).workspace;
  assert.equal(
    first.read('.task-graph/generated/graph.json'),
    second.read('.task-graph/generated/graph.json'),
  );

  // Rebuilding the same project is stable as well.
  const before = first.read('.task-graph/generated/graph.json');
  buildProject(first.root);
  assert.equal(first.read('.task-graph/generated/graph.json'), before);
});

test('US-016: deleting generated output and rebuilding recreates it', () => {
  const fixture = buildFixture(useTempWorkspace(test, 'us-016-rebuild'));
  const { workspace } = fixture;
  const before = workspace.read('.task-graph/generated/graph.json');

  removeGenerated(workspace);
  assert.equal(workspace.exists('.task-graph/generated/graph.json'), false);

  const result = buildProject(workspace.root);
  assert.equal(result.file, '.task-graph/generated/graph.json');
  assert.equal(workspace.read('.task-graph/generated/graph.json'), before);
  assert.equal(result.taskCount, readProjection(workspace).tasks.length);
  assert.equal(result.graphCount, 3);
});

test('US-016: graph.json is never read as source data', () => {
  const fixture = buildFixture(useTempWorkspace(test, 'us-016-not-source'));
  const { workspace } = fixture;

  // A hand-written generated file must not influence validation or the task set.
  workspace.write(
    '.task-graph/generated/graph.json',
    JSON.stringify({ tasks: [{ id: 'T-9999', status: 'done' }], relationships: {} }),
  );
  assert.deepEqual(validateRepository(workspace.root).issues, []);
  assert.equal(loadTaskRepository(workspace.root).taskById('T-9999'), undefined);

  buildProject(workspace.root);
  const rebuilt = readProjection(workspace);
  assert.equal(rebuilt.tasks.some((task) => task.id === 'T-9999'), false);
  assert.equal(rebuilt.tasks.length, loadTaskRepository(workspace.root).tasks.length);
});

test('US-016: the build command refreshes generated data through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-016-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });
  removeGenerated(workspace);

  const build = runCliProcess(['build', '--json'], { cwd: workspace.root });
  assert.equal(build.code, 0, build.stderr);
  assert.ok(workspace.exists('.task-graph/generated/graph.json'));
  const payload = JSON.parse(build.stdout) as { ok: boolean; file: string; tasks: number };
  assert.equal(payload.ok, true);
  assert.equal(payload.file, '.task-graph/generated/graph.json');
  assert.equal(payload.tasks, 1);
});
