import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { linkTask } from '../src/core/deps.js';
import { exposeCompletionPoint, setCompletionRequires } from '../src/core/composites.js';
import { completeTask, startTask } from '../src/core/lifecycle.js';
import { computeReadiness } from '../src/core/readiness.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { readTaskDocument } from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

interface Fixture {
  readonly workspace: TempWorkspace;
  readonly inner: string;
  readonly inner2: string;
  readonly successor: string;
}

function seedComposite(workspace: TempWorkspace): Fixture {
  initializeProject(workspace.root, { name: 'gates', task: '复合任务' });
  const child = addGraph(workspace.root, { title: '登录子图', parentTask: 'T-0001' });
  const inner = addTask(workspace.root, { graph: child.graph.id, title: '实现接口', now: fixedClock() });
  const inner2 = addTask(workspace.root, { graph: child.graph.id, title: '补齐测试', now: fixedClock() });
  setCompletionRequires(workspace.root, { task: 'T-0001', requires: [inner.id, inner2.id] });
  const successor = addTask(workspace.root, { graph: 'G-001', title: '外层后继', now: fixedClock() });
  return { workspace, inner: inner.id, inner2: inner2.id, successor: successor.id };
}

function readinessOf(workspace: TempWorkspace, id: string): string {
  return computeReadiness(loadTaskRepository(workspace.root)).get(id)?.readiness ?? 'missing';
}

function done(workspace: TempWorkspace, id: string): void {
  startTask(workspace.root, { id, now: fixedClock() });
  completeTask(workspace.root, { id, now: fixedClock() });
}

test('US-014: expose-gate creates a unique named completion point', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-expose'));
  const { workspace } = fixture;

  const updated = exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [fixture.inner],
  });
  assert.deepEqual(updated.subgraph?.exposes, [{ name: 'api-ready', requires: [fixture.inner] }]);
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  const second = exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'tests-ready',
    requires: [fixture.inner2],
  });
  assert.deepEqual(
    second.subgraph?.exposes.map((point) => point.name),
    ['api-ready', 'tests-ready'],
  );
  assert.equal(readTaskDocument(workspace.root, 'T-0001').subgraph?.exposes.length, 2);
});

test('US-014: invalid completion points are rejected without writing', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-expose-rejects'));
  const { workspace } = fixture;
  const before = workspace.read('.task-graph/tasks/T-0001.md');

  assert.throws(
    () => exposeCompletionPoint(workspace.root, { task: 'T-0001', name: '  ', requires: [fixture.inner] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_GATE_NAME',
  );
  assert.throws(
    () => exposeCompletionPoint(workspace.root, { task: 'T-0001', name: 'api-ready', requires: [] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_EMPTY_GATE',
  );
  assert.throws(
    () =>
      exposeCompletionPoint(workspace.root, {
        task: 'T-0001',
        name: 'api-ready',
        requires: [fixture.successor],
      }),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_COMPLETION_OUTSIDE_SUBGRAPH',
  );
  assert.throws(
    () => exposeCompletionPoint(workspace.root, { task: 'T-0001', name: 'api-ready', requires: ['T-9999'] }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_TASK_REF',
  );
  assert.throws(
    () =>
      exposeCompletionPoint(workspace.root, {
        task: 'T-0001',
        name: 'api-ready',
        requires: [fixture.inner, fixture.inner],
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_COMPLETION',
  );
  assert.throws(
    () =>
      exposeCompletionPoint(workspace.root, {
        task: fixture.successor,
        name: 'api-ready',
        requires: [fixture.inner],
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_SUBGRAPH',
  );
  assert.equal(workspace.read('.task-graph/tasks/T-0001.md'), before);

  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [fixture.inner],
  });
  const withGate = workspace.read('.task-graph/tasks/T-0001.md');
  assert.throws(
    () =>
      exposeCompletionPoint(workspace.root, {
        task: 'T-0001',
        name: 'api-ready',
        requires: [fixture.inner2],
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_GATE',
  );
  assert.equal(workspace.read('.task-graph/tasks/T-0001.md'), withGate);
});

test('US-014: a partial dependency stores the composite task and gate name', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-partial-dep'));
  const { workspace } = fixture;
  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [fixture.inner],
  });

  const linked = linkTask(workspace.root, {
    successor: fixture.successor,
    predecessor: 'T-0001',
    gate: 'api-ready',
  });
  assert.deepEqual(linked.dependsOn, [
    { task: 'T-0001', mode: 'partial', gate: 'api-ready' },
  ]);
  assert.ok(workspace.read(`.task-graph/tasks/${fixture.successor}.md`).includes('gate: api-ready'));
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  const projection = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    relationships: { partial: { from: string; to: string; gate?: string }[] };
  };
  assert.deepEqual(projection.relationships.partial, [
    { from: 'T-0001', to: fixture.successor, gate: 'api-ready' },
  ]);
});

test('US-014: a missing or invalid gate is rejected', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-missing-gate'));
  const { workspace } = fixture;

  const before = workspace.read(`.task-graph/tasks/${fixture.successor}.md`);
  assert.throws(
    () =>
      linkTask(workspace.root, {
        successor: fixture.successor,
        predecessor: 'T-0001',
        gate: 'api-ready',
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskGraphError);
      assert.equal(error.code, 'E_UNKNOWN_GATE');
      assert.match(error.details.join(' '), /exposes no completion points/);
      return true;
    },
  );
  assert.throws(
    () =>
      linkTask(workspace.root, {
        successor: fixture.successor,
        predecessor: fixture.inner,
        gate: 'anything',
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_UNKNOWN_GATE',
  );
  assert.equal(workspace.read(`.task-graph/tasks/${fixture.successor}.md`), before);

  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [fixture.inner],
  });
  assert.throws(
    () =>
      linkTask(workspace.root, {
        successor: fixture.successor,
        predecessor: 'T-0001',
        gate: 'tests-ready',
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskGraphError);
      assert.equal(error.code, 'E_UNKNOWN_GATE');
      assert.match(error.details.join(' '), /Available completion points: api-ready/);
      return true;
    },
  );

  // A direct outer dependency on a child task is a cross-layer dependency.
  assert.throws(
    () => linkTask(workspace.root, { successor: fixture.successor, predecessor: fixture.inner }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_CROSS_LAYER_DEP',
  );
});

test('US-014: the validator rejects hand-written bad gates', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-validator'));
  const { workspace } = fixture;
  const file = `.task-graph/tasks/${fixture.successor}.md`;
  const original = workspace.read(file);

  // Unknown gate name on a real composite task.
  workspace.write(
    file,
    original.replace(
      'depends_on: []',
      'depends_on:\n  - task: T-0001\n    mode: partial\n    gate: nope',
    ),
  );
  let issues = validateRepository(workspace.root).issues;
  assert.equal(issues.some((issue) => issue.code === 'E_UNKNOWN_GATE'), true);

  // Partial dependency on a task that is not composite.
  workspace.write(
    file,
    original.replace(
      'depends_on: []',
      `depends_on:\n  - task: ${fixture.inner}\n    mode: partial\n    gate: x`,
    ),
  );
  issues = validateRepository(workspace.root).issues;
  assert.equal(
    issues.some(
      (issue) => issue.code === 'E_UNKNOWN_GATE' && /not a composite task/.test(issue.message),
    ),
    true,
  );

  // Empty gate name: the task document itself is rejected with the field context.
  workspace.write(
    file,
    original.replace('depends_on: []', 'depends_on:\n  - task: T-0001\n    mode: partial\n    gate: ""'),
  );
  issues = validateRepository(workspace.root).issues;
  assert.equal(issues.length > 0, true);
  assert.equal(
    issues.some((issue) => /gate/.test(`${issue.field} ${issue.message}`)),
    true,
  );

  // A partial dependency without any gate field is rejected as well.
  workspace.write(
    file,
    original.replace('depends_on: []', 'depends_on:\n  - task: T-0001\n    mode: partial'),
  );
  issues = validateRepository(workspace.root).issues;
  assert.equal(issues.length > 0, true);
  assert.equal(
    issues.some((issue) => /gate/.test(`${issue.field} ${issue.message}`)),
    true,
  );

  workspace.write(file, original);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
});

test('US-014: a partial dependency becomes satisfied when its gate members are done', () => {
  const fixture = seedComposite(useTempWorkspace(test, 'us-014-satisfied'));
  const { workspace } = fixture;
  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'api-ready',
    requires: [fixture.inner],
  });
  linkTask(workspace.root, {
    successor: fixture.successor,
    predecessor: 'T-0001',
    gate: 'api-ready',
  });

  assert.equal(readinessOf(workspace, fixture.successor), 'blocked');
  assert.deepEqual(
    computeReadiness(loadTaskRepository(workspace.root)).get(fixture.successor)?.blockedBy,
    [{ kind: 'gate', task: 'T-0001', gate: 'api-ready', tasks: [fixture.inner] }],
  );

  // The composite task itself stays open, but the exposed portion is enough.
  done(workspace, fixture.inner);
  assert.equal(loadTaskRepository(workspace.root).taskById('T-0001')?.status, 'todo');
  assert.equal(readinessOf(workspace, fixture.successor), 'ready');

  // A gate that needs two tasks waits for both.
  exposeCompletionPoint(workspace.root, {
    task: 'T-0001',
    name: 'tests-ready',
    requires: [fixture.inner, fixture.inner2],
  });
  const other = addTask(workspace.root, { graph: 'G-001', title: '另一个后继', now: fixedClock() });
  linkTask(workspace.root, {
    successor: other.id,
    predecessor: 'T-0001',
    gate: 'tests-ready',
  });
  assert.equal(readinessOf(workspace, other.id), 'blocked');
  done(workspace, fixture.inner2);
  assert.equal(readinessOf(workspace, other.id), 'ready');
});

test('US-014: task expose-gate works through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-014-cli');
  runCliProcess(['init', '--name', 'p', '--task', '复合任务'], { cwd: workspace.root });
  runCliProcess(['graph', 'add', '--title', '子图', '--parent-task', 'T-0001'], {
    cwd: workspace.root,
  });
  runCliProcess(['task', 'add', '--graph', 'G-002', '--title', '子任务'], { cwd: workspace.root });
  runCliProcess(['task', 'add', '--graph', 'G-001', '--title', '外层任务'], { cwd: workspace.root });

  const expose = runCliProcess(
    ['task', 'expose-gate', 'T-0001', '--name', 'api-ready', '--requires', 'T-0002', '--json'],
    { cwd: workspace.root },
  );
  assert.equal(expose.code, 0, expose.stderr);
  const payload = JSON.parse(expose.stdout) as {
    task: { subgraph: { exposes: { name: string; requires: string[] }[] } };
  };
  assert.deepEqual(payload.task.subgraph.exposes, [
    { name: 'api-ready', requires: ['T-0002'] },
  ]);

  const link = runCliProcess(
    ['task', 'link', 'T-0003', '--depends-on', 'T-0001', '--gate', 'api-ready'],
    { cwd: workspace.root },
  );
  assert.equal(link.code, 0, link.stderr);
  assert.match(link.stdout, /Linked T-0001 -> T-0003/);

  const badGate = runCliProcess(
    ['task', 'link', 'T-0003', '--depends-on', 'T-0001', '--gate', 'nope'],
    { cwd: workspace.root },
  );
  assert.equal(badGate.code, EXIT_FAILURE);
  assert.match(badGate.stderr, /E_UNKNOWN_GATE/);

  const noName = runCliProcess(['task', 'expose-gate', 'T-0001', '--requires', 'T-0002'], {
    cwd: workspace.root,
  });
  assert.equal(noName.code, EXIT_USAGE);
  assert.match(noName.stderr, /completion point name is required/);

  const noRequires = runCliProcess(['task', 'expose-gate', 'T-0001', '--name', 'x'], {
    cwd: workspace.root,
  });
  assert.equal(noRequires.code, EXIT_USAGE);
  assert.match(noRequires.stderr, /required task is needed/);
});
