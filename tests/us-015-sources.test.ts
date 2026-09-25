import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_USAGE } from '../src/cli/context.js';
import { TaskGraphError } from '../src/core/errors.js';
import { initializeProject } from '../src/core/init.js';
import { addTask } from '../src/core/taskops.js';
import { registerSource } from '../src/core/sources.js';
import { readProjectManifest } from '../src/core/project.js';
import { computeReadiness } from '../src/core/readiness.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { validateRepository } from '../src/core/validate.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const AT = '2026-09-21T10:00:00+08:00';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

function seed(workspace: TempWorkspace): void {
  initializeProject(workspace.root, { name: 'sources', task: '根任务' });
}

interface Projected {
  sources: Record<string, unknown>[];
  tasks: { id: string; derivedFrom: string[]; readiness: string }[];
  relationships: { derives: { from: string; to: string }[] };
}
function projection(workspace: TempWorkspace): Projected {
  return JSON.parse(workspace.read('.task-graph/generated/graph.json')) as Projected;
}

test('US-015: a command registers a source ID, file and confirmation time', () => {
  const workspace = useTempWorkspace(test, 'us-015-register');
  seed(workspace);

  const source = registerSource(workspace.root, {
    id: 'PRD-001',
    file: 'docs/prd-login.md',
    confirmedAt: AT,
    now: fixedClock(),
  });
  assert.deepEqual(source, { id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: AT });

  const manifest = readProjectManifest(workspace.root);
  assert.deepEqual(manifest.sources, [
    { id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: AT },
  ]);
  assert.ok(workspace.read('.task-graph/project.yaml').includes('confirmed_at: 2026-09-21T10:00:00+08:00'));
  assert.deepEqual(validateRepository(workspace.root).issues, []);

  // Without an explicit timestamp the clock is used.
  const derived = registerSource(workspace.root, {
    id: 'PRD-002',
    file: 'docs/prd-中文 路径.md',
    now: fixedClock(),
  });
  assert.equal(derived.confirmedAt, AT);
});

test('US-015: duplicate or invalid sources are rejected without writing', () => {
  const workspace = useTempWorkspace(test, 'us-015-rejects');
  seed(workspace);
  registerSource(workspace.root, {
    id: 'PRD-001',
    file: 'docs/prd.md',
    confirmedAt: AT,
  });
  const before = workspace.read('.task-graph/project.yaml');

  assert.throws(
    () => registerSource(workspace.root, { id: 'PRD-001', file: 'docs/other.md', confirmedAt: AT }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_SOURCE',
  );
  assert.throws(
    () => registerSource(workspace.root, { id: 'PRD-002', file: 'docs/prd.md', confirmedAt: AT }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_DUP_SOURCE_FILE',
  );
  assert.throws(
    () => registerSource(workspace.root, { id: '  ', file: 'docs/x.md', confirmedAt: AT }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SOURCE_ID',
  );
  assert.throws(
    () => registerSource(workspace.root, { id: 'PRD-003', file: '   ', confirmedAt: AT }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SOURCE_FILE',
  );
  assert.throws(
    () =>
      registerSource(workspace.root, {
        id: 'PRD-003',
        file: 'docs/y.md',
        confirmedAt: '2026-09-21 10:00',
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SOURCE_TIMESTAMP',
  );
  assert.equal(workspace.read('.task-graph/project.yaml'), before);
  assert.deepEqual(readProjectManifest(workspace.root).sources.length, 1);
});

test('US-015: source ordering in project.yaml is deterministic', () => {
  const first = useTempWorkspace(test, 'us-015-order-a');
  const second = useTempWorkspace(test, 'us-015-order-b');
  seed(first);
  seed(second);

  registerSource(first.root, { id: 'PRD-002', file: 'docs/b.md', confirmedAt: AT });
  registerSource(first.root, { id: 'PRD-001', file: 'docs/a.md', confirmedAt: AT });

  registerSource(second.root, { id: 'PRD-001', file: 'docs/a.md', confirmedAt: AT });
  registerSource(second.root, { id: 'PRD-002', file: 'docs/b.md', confirmedAt: AT });

  assert.equal(
    first.read('.task-graph/project.yaml'),
    second.read('.task-graph/project.yaml'),
  );
});

test('US-015: a task can declare derived_from sources and missing ones fail validation', () => {
  const workspace = useTempWorkspace(test, 'us-015-derives');
  seed(workspace);
  registerSource(workspace.root, { id: 'PRD-001', file: 'docs/prd.md', confirmedAt: AT });

  const task = addTask(workspace.root, {
    graph: 'G-001',
    title: '实现登录',
    derivedFrom: ['PRD-001'],
    now: fixedClock(),
  });
  assert.deepEqual(task.derivedFrom, ['PRD-001']);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
  assert.deepEqual(projection(workspace).relationships.derives, [
    { from: 'PRD-001', to: task.id },
  ]);

  // An unknown source reference rolls the whole creation back.
  const filesBefore = workspace.listFiles();
  assert.throws(
    () =>
      addTask(workspace.root, {
        graph: 'G-001',
        title: '未确认来源',
        derivedFrom: ['PRD-999'],
        now: fixedClock(),
      }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_VALIDATE',
  );
  assert.deepEqual(workspace.listFiles(), filesBefore);

  // A hand-written reference is reported by the validator with file and field.
  const file = `.task-graph/tasks/${task.id}.md`;
  workspace.write(file, workspace.read(file).replace('derived_from:\n  - PRD-001', 'derived_from:\n  - PRD-404'));
  const issues = validateRepository(workspace.root).issues;
  assert.equal(issues.some((issue) => issue.code === 'E_UNKNOWN_SOURCE_REF'), true);
});

test('US-015: sources have no status, claim or readiness', () => {
  const workspace = useTempWorkspace(test, 'us-015-not-a-task');
  seed(workspace);
  registerSource(workspace.root, { id: 'PRD-001', file: 'docs/prd.md', confirmedAt: AT });
  const task = addTask(workspace.root, {
    graph: 'G-001',
    title: '实现登录',
    derivedFrom: ['PRD-001'],
    now: fixedClock(),
  });

  const data = projection(workspace);
  assert.deepEqual(Object.keys(data.sources[0]!).sort(), ['confirmedAt', 'file', 'id']);
  assert.equal(data.sources[0]!['status'], undefined);
  assert.equal(data.sources[0]!['claim'], undefined);
  assert.equal(data.sources[0]!['readiness'], undefined);
  assert.equal(
    data.tasks.some((entry) => entry.id === 'PRD-001'),
    false,
  );

  const repository = loadTaskRepository(workspace.root);
  assert.equal(repository.taskById('PRD-001'), undefined);
  assert.equal(computeReadiness(repository).has('PRD-001'), false);
  assert.equal(workspace.exists('.task-graph/tasks/PRD-001.md'), false);
});

test('US-015: derives relations never affect task readiness', () => {
  const workspace = useTempWorkspace(test, 'us-015-no-readiness');
  seed(workspace);
  const plain = addTask(workspace.root, { graph: 'G-001', title: '没有来源的任务', now: fixedClock() });
  const readinessOf = (id: string): string =>
    computeReadiness(loadTaskRepository(workspace.root)).get(id)?.readiness ?? 'missing';
  assert.equal(readinessOf(plain.id), 'ready');

  registerSource(workspace.root, { id: 'PRD-001', file: 'docs/prd.md', confirmedAt: AT });
  const derived = addTask(workspace.root, {
    graph: 'G-001',
    title: '来自 PRD 的任务',
    derivedFrom: ['PRD-001'],
    now: fixedClock(),
  });
  assert.equal(readinessOf(derived.id), 'ready');
  assert.deepEqual(
    computeReadiness(loadTaskRepository(workspace.root)).get(derived.id)?.blockedBy,
    [],
  );
  assert.equal(projection(workspace).tasks.find((entry) => entry.id === derived.id)?.readiness, 'ready');
});

test('US-015: projects without any source remain valid', () => {
  const workspace = useTempWorkspace(test, 'us-015-no-sources');
  seed(workspace);
  assert.deepEqual(readProjectManifest(workspace.root).sources, []);
  assert.deepEqual(validateRepository(workspace.root).issues, []);
  assert.deepEqual(projection(workspace).sources, []);
  assert.deepEqual(projection(workspace).relationships.derives, []);
});

test('US-015: source add works through the CLI', () => {
  const workspace = useTempWorkspace(test, 'us-015-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });

  const add = runCliProcess(
    ['source', 'add', '--id', 'PRD-001', '--file', 'docs/prd.md', '--confirmed-at', AT, '--json'],
    { cwd: workspace.root },
  );
  assert.equal(add.code, 0, add.stderr);
  const payload = JSON.parse(add.stdout) as { source: { id: string; file: string; confirmedAt: string } };
  assert.deepEqual(payload.source, { id: 'PRD-001', file: 'docs/prd.md', confirmedAt: AT });

  const duplicate = runCliProcess(
    ['source', 'add', '--id', 'PRD-001', '--file', 'docs/other.md'],
    { cwd: workspace.root },
  );
  assert.equal(duplicate.code, EXIT_FAILURE);
  assert.match(duplicate.stderr, /E_DUP_SOURCE/);

  const missingId = runCliProcess(['source', 'add', '--file', 'docs/x.md'], { cwd: workspace.root });
  assert.equal(missingId.code, EXIT_USAGE);
  assert.match(missingId.stderr, /source ID is required/);

  const missingFile = runCliProcess(['source', 'add', '--id', 'PRD-009'], { cwd: workspace.root });
  assert.equal(missingFile.code, EXIT_USAGE);
  assert.match(missingFile.stderr, /source file path is required/);

  assert.deepEqual(readProjectManifest(workspace.root).sources.length, 1);
});
