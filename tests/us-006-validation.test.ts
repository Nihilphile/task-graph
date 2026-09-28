import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_OK } from '../src/cli/context.js';
import { main } from '../src/cli/main.js';
import {
  createTaskDocument,
  serializeTaskDocument,
  type TaskDocument,
} from '../src/core/task.js';
import { validateRepository } from '../src/core/validate.js';
import { writeProjectManifest, type ProjectManifest } from '../src/core/project.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const MANIFEST: ProjectManifest = {
  version: 1,
  name: 'validate-test',
  entryGraphs: ['G-001', 'G-003'],
  graphs: [
    { id: 'G-001', title: '核心产品' },
    { id: 'G-002', title: '登录能力子图' },
    { id: 'G-003', title: '官网发布' },
  ],
  sources: [{ id: 'PRD-001', file: 'docs/prd.md', confirmedAt: '2026-09-21T10:00:00+08:00' }],
};

function seed(workspace: TempWorkspace, manifest: ProjectManifest = MANIFEST): void {
  writeProjectManifest(workspace.root, manifest);
  workspace.mkdir('.task-graph/tasks');
}

/** Writes a task without validating it, so invalid fixtures can be built. */
function putTask(workspace: TempWorkspace, changes: Partial<TaskDocument> & { id: string }): void {
  const base = createTaskDocument({
    id: changes.id,
    graph: changes.graph ?? 'G-001',
    title: `任务 ${changes.id}`,
  });
  const document: TaskDocument = { ...base, ...changes };
  workspace.write(
    `.task-graph/tasks/${changes.id}.md`,
    serializeTaskDocument(document),
  );
}

function issueCodes(workspace: TempWorkspace): string[] {
  return validateRepository(workspace.root).issues.map((issue) => issue.code);
}

test('US-006: a well-formed multi-graph project validates cleanly', () => {
  const workspace = useTempWorkspace(test, 'us-006-ok');
  seed(workspace);
  putTask(workspace, {
    id: 'T-0001',
    graph: 'G-001',
    subgraph: { graph: 'G-002', completionRequires: ['T-0002'], exposes: [] },
  });
  putTask(workspace, { id: 'T-0002', graph: 'G-002' });
  putTask(workspace, { id: 'T-0003', graph: 'G-001', dependsOn: [{ task: 'T-0001', mode: 'full' }] });
  putTask(workspace, { id: 'T-0004', graph: 'G-003' });

  const report = validateRepository(workspace.root);
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
});

test('US-006: rejects tasks whose graph is not registered', () => {
  const workspace = useTempWorkspace(test, 'us-006-unknown-graph');
  seed(workspace);
  putTask(workspace, { id: 'T-0001', graph: 'G-404' });
  const report = validateRepository(workspace.root);
  const issue = report.issues.find((entry) => entry.code === 'E_UNKNOWN_TASK_GRAPH');
  assert.ok(issue, `expected E_UNKNOWN_TASK_GRAPH, got ${issueCodes(workspace).join(', ')}`);
  assert.equal(issue.file, '.task-graph/tasks/T-0001.md');
  assert.equal(issue.field, 'graph');
});

test('US-006: rejects a graph used as both entry graph and subgraph', () => {
  const workspace = useTempWorkspace(test, 'us-006-entry-subgraph');
  seed(workspace);
  putTask(workspace, {
    id: 'T-0001',
    graph: 'G-001',
    subgraph: { graph: 'G-003', completionRequires: ['T-0002'], exposes: [] },
  });
  putTask(workspace, { id: 'T-0002', graph: 'G-003' });
  const issue = validateRepository(workspace.root).issues.find(
    (entry) => entry.code === 'E_ENTRY_IS_SUBGRAPH',
  );
  assert.ok(issue, `expected E_ENTRY_IS_SUBGRAPH, got ${issueCodes(workspace).join(', ')}`);
  assert.equal(issue.field, 'subgraph.graph');
  assert.equal(issue.file, '.task-graph/tasks/T-0001.md');
});

test('US-006: rejects a non-entry graph with zero or several parent tasks', () => {
  const orphan = useTempWorkspace(test, 'us-006-orphan');
  seed(orphan);
  putTask(orphan, { id: 'T-0001', graph: 'G-002' });
  const orphanIssue = validateRepository(orphan.root).issues.find(
    (entry) => entry.code === 'E_SUBGRAPH_ORPHAN',
  );
  assert.ok(orphanIssue, `expected E_SUBGRAPH_ORPHAN, got ${issueCodes(orphan).join(', ')}`);
  assert.match(orphanIssue.message, /G-002/);

  const multi = useTempWorkspace(test, 'us-006-multi-parent');
  seed(multi);
  putTask(multi, {
    id: 'T-0001',
    graph: 'G-001',
    subgraph: { graph: 'G-002', completionRequires: [], exposes: [] },
  });
  putTask(multi, {
    id: 'T-0002',
    graph: 'G-001',
    subgraph: { graph: 'G-002', completionRequires: [], exposes: [] },
  });
  const multiIssue = validateRepository(multi.root).issues.find(
    (entry) => entry.code === 'E_SUBGRAPH_MULTI_PARENT',
  );
  assert.ok(multiIssue, `expected E_SUBGRAPH_MULTI_PARENT, got ${issueCodes(multi).join(', ')}`);
  assert.match(multiIssue.message, /T-0001, T-0002/);
});

test('US-006: rejects missing task, graph, source and supersedes references', () => {
  const workspace = useTempWorkspace(test, 'us-006-refs');
  seed(workspace);
  putTask(workspace, { id: 'T-0001', graph: 'G-001', dependsOn: [{ task: 'T-0404', mode: 'full' }] });
  putTask(workspace, {
    id: 'T-0002',
    graph: 'G-001',
    subgraph: { graph: 'G-404', completionRequires: [], exposes: [] },
  });
  putTask(workspace, { id: 'T-0003', graph: 'G-001', derivedFrom: ['PRD-404'] });
  putTask(workspace, { id: 'T-0004', graph: 'G-001', supersedes: ['T-0404'] });
  putTask(workspace, { id: 'T-0005', graph: 'G-001', derivedFrom: ['PRD-001'] });

  const report = validateRepository(workspace.root);
  const codes = report.issues.map((issue) => issue.code);
  assert.ok(codes.includes('E_UNKNOWN_TASK_REF'), codes.join(', '));
  assert.ok(codes.includes('E_UNKNOWN_GRAPH_REF'), codes.join(', '));
  assert.ok(codes.includes('E_UNKNOWN_SOURCE_REF'), codes.join(', '));
  assert.equal(
    report.issues.filter((issue) => issue.code === 'E_UNKNOWN_TASK_REF').length,
    2,
    'depends_on and supersedes references are both reported',
  );

  const dependsIssue = report.issues.find((issue) => issue.field === 'depends_on[0].task');
  assert.ok(dependsIssue);
  assert.equal(dependsIssue.file, '.task-graph/tasks/T-0001.md');
  assert.match(dependsIssue.message, /T-0404/);

  // A registered source reference is accepted.
  assert.ok(!validateRepository(workspace.root).issues.some((issue) => issue.file.endsWith('T-0005.md')));
});

test('US-006: rejects dependencies between different entry graph trees', () => {
  const workspace = useTempWorkspace(test, 'us-006-cross-entry');
  seed(workspace);
  putTask(workspace, { id: 'T-0001', graph: 'G-001' });
  putTask(workspace, { id: 'T-0002', graph: 'G-003', dependsOn: [{ task: 'T-0001', mode: 'full' }] });

  const issue = validateRepository(workspace.root).issues.find(
    (entry) => entry.code === 'E_CROSS_ENTRY_DEP',
  );
  assert.ok(issue, `expected E_CROSS_ENTRY_DEP, got ${issueCodes(workspace).join(', ')}`);
  assert.equal(issue.file, '.task-graph/tasks/T-0002.md');
  assert.equal(issue.field, 'depends_on[0].task');
  assert.match(issue.message, /different entry graph tree/);
});

test('US-006: rejects direct dependencies that cross a subgraph boundary', () => {
  const workspace = useTempWorkspace(test, 'us-006-cross-layer');
  seed(workspace);
  putTask(workspace, {
    id: 'T-0001',
    graph: 'G-001',
    subgraph: { graph: 'G-002', completionRequires: ['T-0002'], exposes: [] },
  });
  putTask(workspace, { id: 'T-0002', graph: 'G-002' });
  putTask(workspace, { id: 'T-0003', graph: 'G-001', dependsOn: [{ task: 'T-0002', mode: 'full' }] });

  const issue = validateRepository(workspace.root).issues.find(
    (entry) => entry.code === 'E_CROSS_LAYER_DEP',
  );
  assert.ok(issue, `expected E_CROSS_LAYER_DEP, got ${issueCodes(workspace).join(', ')}`);
  assert.match(issue.message, /nested graph "G-002"/);
});

test('US-006: rejects completion targets outside the referenced child graph', () => {
  const workspace = useTempWorkspace(test, 'us-006-completion');
  seed(workspace);
  putTask(workspace, {
    id: 'T-0001',
    graph: 'G-001',
    subgraph: { graph: 'G-002', completionRequires: ['T-0003'], exposes: [] },
  });
  putTask(workspace, { id: 'T-0002', graph: 'G-002' });
  putTask(workspace, { id: 'T-0003', graph: 'G-001' });

  const issue = validateRepository(workspace.root).issues.find(
    (entry) => entry.code === 'E_COMPLETION_OUTSIDE_SUBGRAPH',
  );
  assert.ok(issue, `expected E_COMPLETION_OUTSIDE_SUBGRAPH, got ${issueCodes(workspace).join(', ')}`);
  assert.equal(issue.field, 'subgraph.completion_requires[0]');
});

test('US-006: reports invalid task documents and file naming problems', () => {
  const workspace = useTempWorkspace(test, 'us-006-invalid-docs');
  seed(workspace);
  workspace.write('.task-graph/tasks/notes.md', '# not a task\n');
  workspace.write(
    '.task-graph/tasks/T-0001.md',
    serializeTaskDocument(
      createTaskDocument({ id: 'T-0001', graph: 'G-001', title: 'x' }),
    ).replace('status: todo', 'status: unsupported'),
  );
  const codes = issueCodes(workspace);
  assert.ok(codes.includes('E_TASK_FILENAME'), codes.join(', '));
  assert.ok(codes.includes('E_TASK_STATUS'), codes.join(', '));
});

test('US-006: reports every discovered error with file and field context', async () => {
  const workspace = useTempWorkspace(test, 'us-006-report');
  seed(workspace);
  putTask(workspace, { id: 'T-0001', graph: 'G-404' });
  putTask(workspace, { id: 'T-0002', graph: 'G-001', dependsOn: [{ task: 'T-0404', mode: 'full' }] });
  putTask(workspace, { id: 'T-0003', graph: 'G-003', dependsOn: [{ task: 'T-0001', mode: 'full' }] });

  const lines: string[] = [];
  const code = await main(['validate'], {
    cwd: workspace.root,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_FAILURE);
  const output = lines.join('\n');
  assert.match(output, /\.task-graph\/tasks\/T-0001\.md -> graph:/);
  assert.match(output, /\.task-graph\/tasks\/T-0002\.md -> depends_on\[0\]\.task:/);
  assert.match(output, /Found \d+ problem\(s\)\./);

  const child = runCliProcess(['validate'], { cwd: workspace.root });
  assert.equal(child.code, EXIT_FAILURE);
  assert.match(child.stderr, /T-0001\.md -> graph:/);
  assert.equal(child.stdout, '');
});

test('US-006: a valid project passes the validate command with --json output', async () => {
  const workspace = useTempWorkspace(test, 'us-006-cli-ok');
  seed(workspace, {
    ...MANIFEST,
    graphs: [
      { id: 'G-001', title: '核心产品' },
      { id: 'G-003', title: '官网发布' },
    ],
    sources: [],
  });
  putTask(workspace, { id: 'T-0001', graph: 'G-001' });

  const lines: string[] = [];
  const code = await main(['validate', '--json'], {
    cwd: workspace.root,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_OK);
  const payload = JSON.parse(lines.join('\n')) as { ok: boolean; issues: unknown[] };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);

  const child = runCliProcess(['validate'], { cwd: workspace.root });
  assert.equal(child.code, EXIT_OK);
  assert.match(child.stdout, /Task graph is valid\./);
});

test('US-006: validate explains a missing project instead of crashing', async () => {
  const workspace = useTempWorkspace(test, 'us-006-no-project');
  const lines: string[] = [];
  const code = await main(['validate'], {
    cwd: workspace.root,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_FAILURE);
  assert.match(lines.join('\n'), /E_NO_PROJECT|No Task Graph project/);
});
