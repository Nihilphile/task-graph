import assert from 'node:assert/strict';
import { statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TaskGraphError } from '../src/core/errors.js';
import { acquireProjectLock, lockExists, sweepStaleTempFiles } from '../src/core/lock.js';
import { ProjectTransaction, runProjectTransaction } from '../src/core/transaction.js';
import { emptyProjectManifest, writeProjectManifest } from '../src/core/project.js';
import { serializeTaskDocument, createTaskDocument } from '../src/core/task.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { SKILL_ROOT, runNodeAsync, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const WORKER_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  'const core = await import(pathToFileURL(process.argv[2]).href);',
  'const root = process.argv[3];',
  'const label = process.argv[4];',
  'core.runProjectTransaction(',
  '  root,',
  '  (tx) => {',
  '    // Allocation happens inside the lock so concurrent Agents cannot clash.',
  '    const repo = core.loadTaskRepository(root);',
  '    const id = repo.nextTaskId();',
  '    const document = core.createTaskDocument({',
  "      id, graph: 'G-001', title: `并发任务 ${label}`, goal: '并发创建测试',",
  '    });',
  '    tx.write(`.task-graph/tasks/${id}.md`, core.serializeTaskDocument(document));',
  '    process.stdout.write(`created ${id}\\n`);',
  '  },',
  '  { validate: () => { core.loadTaskRepository(root); } },',
  ');',
  '',
].join('\n');

function seedProject(workspace: TempWorkspace): void {
  writeProjectManifest(workspace.root, {
    ...emptyProjectManifest('tx-test'),
    entryGraphs: ['G-001'],
    graphs: [{ id: 'G-001', title: '核心产品' }],
  });
  workspace.mkdir('.task-graph/tasks');
}

function bytes(workspace: TempWorkspace, relative: string): Buffer {
  return workspace.readBuffer(relative);
}

function tempFiles(workspace: TempWorkspace): string[] {
  return workspace.listFiles().filter((file) => file.includes('.tmp-'));
}

test('US-005: a project-scoped lock serialises structured mutations', () => {
  const workspace = useTempWorkspace(test, 'us-005-lock');
  seedProject(workspace);

  const first = acquireProjectLock(workspace.root);
  assert.ok(first.acquired);
  assert.ok(lockExists(workspace.root));
  assert.ok(statSync(workspace.file('.task-graph/lock')).isDirectory());

  assert.throws(
    () => acquireProjectLock(workspace.root, { timeoutMs: 150, retryMs: 10, staleMs: 60_000 }),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_LOCK_TIMEOUT',
  );

  first.release();
  assert.ok(!lockExists(workspace.root));

  const second = acquireProjectLock(workspace.root, { timeoutMs: 200 });
  second.release();
  assert.ok(!lockExists(workspace.root));
});

test('US-005: an abandoned lock is broken so a crashed Agent cannot block work', () => {
  const workspace = useTempWorkspace(test, 'us-005-stale-lock');
  seedProject(workspace);
  const lockDir = workspace.mkdir('.task-graph/lock');
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(lockDir, old, old);

  const lock = acquireProjectLock(workspace.root, { staleMs: 1_000, timeoutMs: 500 });
  assert.ok(lock.acquired);
  lock.release();
});

test('US-005: the lock is released even when the mutation fails', () => {
  const workspace = useTempWorkspace(test, 'us-005-release');
  seedProject(workspace);
  assert.throws(() =>
    runProjectTransaction(workspace.root, () => {
      throw new Error('boom');
    }),
  );
  assert.ok(!lockExists(workspace.root));
});

test('US-005: writes go through temporary files and atomic replacement', () => {
  const workspace = useTempWorkspace(test, 'us-005-atomic');
  seedProject(workspace);
  workspace.write('.task-graph/tasks/T-0001.md', 'old content');

  runProjectTransaction(workspace.root, (tx) => {
    tx.write('.task-graph/tasks/T-0001.md', 'new content');
  });

  assert.equal(workspace.read('.task-graph/tasks/T-0001.md'), 'new content');
  assert.deepEqual(tempFiles(workspace), [], 'no scratch file may survive a commit');
});

test('US-005: validateBefore runs before anything is written', () => {
  const workspace = useTempWorkspace(test, 'us-005-validate-before');
  seedProject(workspace);
  workspace.write('.task-graph/tasks/T-0001.md', 'original');
  const before = bytes(workspace, '.task-graph/tasks/T-0001.md');

  assert.throws(
    () =>
      runProjectTransaction(
        workspace.root,
        (tx) => {
          tx.write('.task-graph/tasks/T-0001.md', 'changed');
          tx.write('.task-graph/tasks/T-0002.md', 'created');
        },
        {
          validateBefore: () => {
            throw new TaskGraphError('E_VALIDATE', 'rejected before writing');
          },
        },
      ),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_VALIDATE',
  );

  assert.deepEqual(bytes(workspace, '.task-graph/tasks/T-0001.md'), before);
  assert.ok(!workspace.exists('.task-graph/tasks/T-0002.md'));
});

test('US-005: validation fails after writing and the exact bytes are restored', () => {
  const workspace = useTempWorkspace(test, 'us-005-rollback');
  seedProject(workspace);
  workspace.write('.task-graph/tasks/T-0001.md', 'original one\n');
  workspace.write('.task-graph/project.yaml', 'original project\n');
  const before = [
    bytes(workspace, '.task-graph/tasks/T-0001.md'),
    bytes(workspace, '.task-graph/project.yaml'),
  ];

  assert.throws(
    () =>
      runProjectTransaction(
        workspace.root,
        (tx) => {
          tx.write('.task-graph/tasks/T-0001.md', 'rewritten one\n');
          tx.write('.task-graph/project.yaml', 'rewritten project\n');
          tx.write('.task-graph/tasks/T-0002.md', 'brand new\n');
          tx.delete('.task-graph/project.yaml');
        },
        {
          validate: () => {
            throw new TaskGraphError('E_VALIDATE', 'rejected after writing');
          },
        },
      ),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_VALIDATE',
  );

  assert.deepEqual(bytes(workspace, '.task-graph/tasks/T-0001.md'), before[0]);
  assert.deepEqual(bytes(workspace, '.task-graph/project.yaml'), before[1]);
  assert.ok(!workspace.exists('.task-graph/tasks/T-0002.md'));
  assert.deepEqual(tempFiles(workspace), []);
});

test('US-005: a failing write rolls earlier writes back', () => {
  const workspace = useTempWorkspace(test, 'us-005-write-failure');
  seedProject(workspace);
  workspace.write('.task-graph/tasks/T-0001.md', 'original\n');
  // A regular file where a directory is required makes the second write fail.
  workspace.write('.task-graph/blocker', 'not a directory');
  const before = bytes(workspace, '.task-graph/tasks/T-0001.md');

  assert.throws(() =>
    runProjectTransaction(workspace.root, (tx) => {
      tx.write('.task-graph/tasks/T-0001.md', 'changed\n');
      tx.write('.task-graph/blocker/child.md', 'impossible\n');
    }),
  );

  assert.deepEqual(bytes(workspace, '.task-graph/tasks/T-0001.md'), before);
  assert.ok(!workspace.exists('.task-graph/blocker/child.md'));
  assert.equal(workspace.read('.task-graph/blocker'), 'not a directory');
});

test('US-005: transactions refuse paths outside the project root', () => {
  const workspace = useTempWorkspace(test, 'us-005-escape');
  seedProject(workspace);
  const tx = new ProjectTransaction(workspace.root);
  assert.throws(
    () => tx.write(path.join(workspace.root, '..', 'escape.txt'), 'nope'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_PATH',
  );
});

test('US-005: stale temporary files are swept and never become source data', () => {
  const workspace = useTempWorkspace(test, 'us-005-temp');
  seedProject(workspace);
  const staleTemp = workspace.write('.task-graph/tasks/.T-0009.md.tmp-999-1-abc', 'garbage');
  const old = new Date(Date.now() - 60 * 60_000);
  utimesSync(staleTemp, old, old);
  const freshTemp = workspace.write('.task-graph/tasks/.T-0008.md.tmp-999-2-def', 'in flight');

  const removed = sweepStaleTempFiles(workspace.root, 60_000);
  assert.deepEqual(removed, [staleTemp]);
  assert.ok(!workspace.exists('.task-graph/tasks/.T-0009.md.tmp-999-1-abc'));

  // A fresh scratch file belongs to a live writer and is left alone.
  const lock = acquireProjectLock(workspace.root);
  lock.release();
  assert.ok(workspace.exists('.task-graph/tasks/.T-0008.md.tmp-999-2-def'));

  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual(repo.tasks, []);
  assert.equal(repo.nextTaskId(), 'T-0001');
  assert.equal(tempFiles(workspace).length, 1);

  workspace.write(
    '.task-graph/tasks/T-0001.md',
    serializeTaskDocument(
      createTaskDocument({ id: 'T-0001', graph: 'G-001', title: '真实任务' }),
    ),
  );
  assert.equal(loadTaskRepository(workspace.root).tasks.length, 1);
});

test('US-005: two concurrent task creations get distinct IDs and valid files', async () => {
  const workspace = useTempWorkspace(test, 'us-005-concurrent');
  seedProject(workspace);
  workspace.write('worker.mjs', WORKER_SOURCE);
  const coreIndex = path.join(SKILL_ROOT, 'dist', 'src', 'index.js');

  const results = await Promise.all([
    runNodeAsync([path.join(workspace.root, 'worker.mjs'), coreIndex, workspace.root, 'A'], {
      cwd: workspace.root,
    }),
    runNodeAsync([path.join(workspace.root, 'worker.mjs'), coreIndex, workspace.root, 'B'], {
      cwd: workspace.root,
    }),
  ]);

  for (const result of results) {
    assert.equal(result.code, 0, `worker failed: ${result.stdout}${result.stderr}`);
  }

  const reported = results.map((result) => result.stdout.trim());
  assert.equal(new Set(reported).size, 2, `expected two distinct IDs, got ${reported.join(', ')}`);
  for (const line of reported) assert.match(line, /^created T-\d{4,}$/);

  const repo = loadTaskRepository(workspace.root);
  assert.deepEqual(
    repo.tasks.map((task) => task.id),
    ['T-0001', 'T-0002'],
  );
  assert.deepEqual(
    repo.tasks.map((task) => task.graph),
    ['G-001', 'G-001'],
  );
  for (const task of repo.tasks) {
    // Every created file is valid source that round-trips byte-for-byte.
    assert.equal(serializeTaskDocument(task), workspace.read(`.task-graph/tasks/${task.id}.md`));
  }
  assert.deepEqual(tempFiles(workspace), []);
  assert.ok(!lockExists(workspace.root));
});
