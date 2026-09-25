import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertValidProjectManifest,
  emptyProjectManifest,
  parseProjectManifest,
  readProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
  writeProjectManifest,
  type ProjectManifest,
} from '../src/core/project.js';
import { TaskGraphError } from '../src/core/errors.js';
import { useTempWorkspace } from './helpers/temp.js';

const PRD_EXAMPLE = [
  'version: 1',
  'name: 示例项目',
  '',
  'entry_graphs:',
  '  - G-001',
  '  - G-003',
  '',
  'graphs:',
  '  - id: G-001',
  '    title: 核心产品',
  '  - id: G-002',
  '    title: 登录能力子图',
  '  - id: G-003',
  '    title: 官网发布',
  '',
  'sources:',
  '  - id: PRD-001',
  '    file: docs/prd.md',
  '    confirmed_at: 2026-09-21T10:00:00+08:00',
  '',
].join('\n');

function fullManifest(): ProjectManifest {
  return {
    version: 1,
    name: '示例项目',
    entryGraphs: ['G-001', 'G-003'],
    graphs: [
      { id: 'G-001', title: '核心产品' },
      { id: 'G-002', title: '登录能力子图' },
      { id: 'G-003', title: '官网发布' },
    ],
    sources: [{ id: 'PRD-001', file: 'docs/prd.md', confirmedAt: '2026-09-21T10:00:00+08:00' }],
  };
}

function expectIssue(manifest: ProjectManifest, code: string): void {
  const issues = validateProjectManifest(manifest, 'project.yaml');
  assert.ok(
    issues.some((issue) => issue.code === code),
    `expected issue ${code}, got ${issues.map((issue) => issue.code).join(', ') || 'none'}`,
  );
}

test('US-002: parses the PRD project.yaml example completely', () => {
  const manifest = parseProjectManifest(PRD_EXAMPLE);
  assert.deepEqual(manifest, fullManifest());
  assert.equal(manifest.version, 1);
  assert.equal(manifest.name, '示例项目');
  assert.deepEqual(manifest.entryGraphs, ['G-001', 'G-003']);
  assert.deepEqual(manifest.sources, [
    { id: 'PRD-001', file: 'docs/prd.md', confirmedAt: '2026-09-21T10:00:00+08:00' },
  ]);
});

test('US-002: serialisation is deterministic and key/list ordered', () => {
  const first = serializeProjectManifest(fullManifest());
  const second = serializeProjectManifest({
    ...fullManifest(),
    graphs: [...fullManifest().graphs].reverse(),
    entryGraphs: ['G-003', 'G-001'],
  });
  assert.equal(first, second);
  assert.equal(serializeProjectManifest(fullManifest()), first);

  const lines = first.split('\n');
  assert.equal(lines[0], 'version: 1');
  assert.equal(lines[1], 'name: 示例项目');
  assert.ok(first.includes('entry_graphs:'));
  assert.ok(first.includes('graphs:'));
  assert.ok(first.includes('sources:'));
  assert.ok(first.includes('confirmed_at: 2026-09-21T10:00:00+08:00'));
  assert.ok(first.endsWith('\n'));
  // Graph list ordering follows the graph ID, not insertion order.
  assert.ok(first.indexOf('id: G-001') < first.indexOf('id: G-002'));
  assert.ok(first.indexOf('id: G-002') < first.indexOf('id: G-003'));
});

test('US-002: round-trips every supported manifest value including UTF-8', () => {
  const manifest = fullManifest();
  const text = serializeProjectManifest(manifest);
  const reparsed = parseProjectManifest(text);
  assert.deepEqual(reparsed, manifest);
  assert.equal(serializeProjectManifest(reparsed), text);

  const chinesePath = {
    ...manifest,
    name: '中文项目名',
    sources: [
      { id: 'PRD-001', file: '文档/需求说明.md', confirmedAt: '2026-01-02T03:04:05Z' },
      { id: 'PRD-002', file: 'docs/spec with spaces.md', confirmedAt: '2026-01-02T03:04:05+08:00' },
    ],
  };
  const chineseText = serializeProjectManifest(chinesePath);
  assert.deepEqual(parseProjectManifest(chineseText), {
    ...chinesePath,
    sources: [...chinesePath.sources].sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
});

test('US-002: projects without sources remain valid and round-trip', () => {
  const manifest: ProjectManifest = {
    version: 1,
    name: 'no sources',
    entryGraphs: ['G-001'],
    graphs: [{ id: 'G-001', title: 'Root' }],
    sources: [],
  };
  const text = serializeProjectManifest(manifest);
  assert.match(text, /sources: \[\]/);
  assert.deepEqual(parseProjectManifest(text), manifest);
  assert.deepEqual(validateProjectManifest(manifest), []);
});

test('US-002: rejects duplicate graph IDs', () => {
  const manifest = {
    ...fullManifest(),
    graphs: [
      { id: 'G-001', title: 'a' },
      { id: 'G-001', title: 'b' },
    ],
    entryGraphs: [],
  };
  expectIssue(manifest, 'E_DUP_GRAPH');
  assert.throws(() => assertValidProjectManifest(manifest), TaskGraphError);
});

test('US-002: rejects duplicate entry graph IDs', () => {
  expectIssue({ ...fullManifest(), entryGraphs: ['G-001', 'G-001'] }, 'E_DUP_ENTRY');
});

test('US-002: rejects entry graph IDs missing from the graph registry', () => {
  expectIssue({ ...fullManifest(), entryGraphs: ['G-001', 'G-404'] }, 'E_UNKNOWN_ENTRY');
});

test('US-002: rejects duplicate source IDs and duplicate source files', () => {
  const duplicateId = {
    ...fullManifest(),
    sources: [
      { id: 'PRD-001', file: 'docs/a.md', confirmedAt: '2026-09-21T10:00:00+08:00' },
      { id: 'PRD-001', file: 'docs/b.md', confirmedAt: '2026-09-21T10:00:00+08:00' },
    ],
  };
  expectIssue(duplicateId, 'E_DUP_SOURCE');

  const duplicateFile = {
    ...fullManifest(),
    sources: [
      { id: 'PRD-001', file: 'docs/a.md', confirmedAt: '2026-09-21T10:00:00+08:00' },
      { id: 'PRD-002', file: 'docs/a.md', confirmedAt: '2026-09-21T10:00:00+08:00' },
    ],
  };
  expectIssue(duplicateFile, 'E_DUP_SOURCE_FILE');
});

test('US-002: rejects sources missing an ID, file, or valid confirmed_at', () => {
  expectIssue(
    { ...fullManifest(), sources: [{ id: '', file: 'docs/a.md', confirmedAt: '2026-01-01T00:00:00Z' }] },
    'E_SOURCE_ID',
  );
  expectIssue(
    { ...fullManifest(), sources: [{ id: 'PRD-001', file: '', confirmedAt: '2026-01-01T00:00:00Z' }] },
    'E_SOURCE_FILE',
  );
  expectIssue(
    { ...fullManifest(), sources: [{ id: 'PRD-001', file: 'docs/a.md', confirmedAt: 'yesterday' }] },
    'E_SOURCE_TIMESTAMP',
  );
  expectIssue(
    {
      ...fullManifest(),
      sources: [{ id: 'PRD-001', file: 'docs/a.md', confirmedAt: '2026-01-01T00:00:00' }],
    },
    'E_SOURCE_TIMESTAMP',
  );
});

test('US-002: rejects malformed and unsupported manifests with context', () => {
  assert.throws(
    () => parseProjectManifest('version: 2\nname: x\ngraphs: []\n', 'project.yaml'),
    (error: unknown) =>
      error instanceof TaskGraphError && error.code === 'E_VERSION' && /unsupported/.test(error.message),
  );
  assert.throws(
    () => parseProjectManifest('not-a-mapping\n', 'project.yaml'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SCHEMA',
  );
  assert.throws(
    () => parseProjectManifest('version: 1\nname: ""\n', 'project.yaml'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_SCHEMA',
  );
  assert.throws(
    () => parseProjectManifest('version: 1\nname: x\ngraphs:\n  - id: G-001\n', 'project.yaml'),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_SCHEMA' &&
      /graphs\[0\]\.title/.test(error.message),
  );
});

test('US-002: an error reports every issue with file and field context', () => {
  const manifest: ProjectManifest = {
    version: 1,
    name: 'broken',
    entryGraphs: ['G-999'],
    graphs: [
      { id: 'G-001', title: 'a' },
      { id: 'G-001', title: 'b' },
    ],
    sources: [],
  };
  try {
    assertValidProjectManifest(manifest, '.task-graph/project.yaml');
    assert.fail('expected validation to throw');
  } catch (error) {
    assert.ok(error instanceof TaskGraphError);
    assert.equal(error.code, 'E_PROJECT');
    assert.ok(error.details.length >= 2, `expected multiple details, got ${error.details.length}`);
    assert.ok(error.details.some((line) => line.includes('graphs[1].id')));
    assert.ok(error.details.some((line) => line.includes('entry_graphs[0]')));
    assert.match(error.format(), /\.task-graph\/project\.yaml/);
  }
});

test('US-002: reads and writes project.yaml under a real project root', () => {
  const workspace = useTempWorkspace(test, 'us-002-project');
  const manifest = writeProjectManifest(workspace.root, fullManifest());
  assert.ok(workspace.exists('.task-graph/project.yaml'));
  assert.deepEqual(readProjectManifest(workspace.root), manifest);

  const onDisk = workspace.read('.task-graph/project.yaml');
  assert.equal(onDisk, serializeProjectManifest(fullManifest()));
  assert.deepEqual(parseProjectManifest(onDisk), manifest);
});

test('US-002: reading a missing project reports a helpful error', () => {
  const workspace = useTempWorkspace(test, 'us-002-missing');
  assert.throws(
    () => readProjectManifest(workspace.root),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_PROJECT',
  );
});

test('US-002: empty manifest helper carries the schema version', () => {
  assert.deepEqual(emptyProjectManifest('new'), {
    version: 1,
    name: 'new',
    entryGraphs: [],
    graphs: [],
    sources: [],
  });
});
