import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REQUIRED_BODY_SECTIONS,
  appendHistory,
  buildTaskBody,
  createTaskDocument,
  extractTaskTitle,
  historyEntry,
  missingBodySections,
  parseTaskDocument,
  readTaskDocument,
  replaceTaskTitle,
  serializeTaskDocument,
  validateTaskDocument,
  writeTaskDocument,
  type TaskDocument,
} from '../src/core/task.js';
import { TaskGraphError } from '../src/core/errors.js';
import { useTempWorkspace } from './helpers/temp.js';

const PRD_TASK_EXAMPLE = [
  '---',
  'id: T-0002',
  'graph: G-001',
  'status: todo',
  'claim: null',
  'depends_on:',
  '  - task: T-0001',
  '    mode: full',
  'manual_blockers: []',
  'derived_from:',
  '  - PRD-001',
  'outputs: []',
  'history: []',
  '---',
  '',
  '# 实现登录接口',
  '',
  '## 目标',
  '',
  '提供密码登录能力。',
  '',
  '## 完成条件',
  '',
  '- 正确凭证可以登录',
  '- 错误凭证会被拒绝',
  '',
  '## 工作记录',
  '',
].join('\n');

const COMPOSITE_TASK_EXAMPLE = [
  '---',
  'id: T-0100',
  'graph: G-001',
  'status: in_progress',
  'claim:',
  '  role: coordinator',
  '  session_id: thread-abc123',
  '  claimed_at: 2026-09-21T10:30:00+08:00',
  'subgraph:',
  '  graph: G-002',
  '  completion_requires:',
  '    - T-0102',
  '    - T-0103',
  '  exposes:',
  '    api-ready:',
  '      requires:',
  '        - T-0101',
  '---',
  '',
  '# 完成登录能力',
  '',
  '## 目标',
  '',
  '交付可供其他模块使用的登录能力。',
  '',
  '## 完成条件',
  '',
  '- 子图完成目标全部完成',
  '',
  '## 工作记录',
  '',
].join('\n');

test('US-003: parses YAML frontmatter and the first Markdown H1', () => {
  const document = parseTaskDocument(PRD_TASK_EXAMPLE, 'T-0002.md');
  assert.equal(document.id, 'T-0002');
  assert.equal(document.graph, 'G-001');
  assert.equal(document.status, 'todo');
  assert.equal(document.claim, null);
  assert.deepEqual(document.dependsOn, [{ task: 'T-0001', mode: 'full' }]);
  assert.deepEqual(document.manualBlockers, []);
  assert.deepEqual(document.derivedFrom, ['PRD-001']);
  assert.deepEqual(document.outputs, []);
  assert.deepEqual(document.history, []);
  assert.equal(document.title, '实现登录接口');
  assert.ok(document.body.startsWith('\n# 实现登录接口'));
  assert.equal(document.subgraph, null);
  assert.deepEqual(document.supersedes, []);
});

test('US-003: parses claim and subgraph with completion points', () => {
  const document = parseTaskDocument(COMPOSITE_TASK_EXAMPLE, 'T-0100.md');
  assert.deepEqual(document.claim, {
    role: 'coordinator',
    sessionId: 'thread-abc123',
    claimedAt: '2026-09-21T10:30:00+08:00',
  });
  assert.deepEqual(document.subgraph, {
    graph: 'G-002',
    completionRequires: ['T-0102', 'T-0103'],
    exposes: [{ name: 'api-ready', requires: ['T-0101'] }],
  });
  assert.equal(document.status, 'in_progress');
});

test('US-003: supports every documented frontmatter field', () => {
  const source = [
    '---',
    'id: T-0007',
    'graph: G-001',
    'status: done',
    'claim:',
    '  role: worker',
    '  session_id: thread-x',
    '  claimed_at: 2026-09-21T10:30:00+08:00',
    '  execution_id: run-42',
    'depends_on:',
    '  - task: T-0005',
    '    mode: full',
    '  - task: T-0100',
    '    mode: partial',
    '    gate: api-ready',
    'manual_blockers:',
    '  - 等待法务审批',
    'subgraph: null',
    'supersedes:',
    '  - T-0006',
    'derived_from:',
    '  - PRD-001',
    'outputs:',
    '  - path: docs/api.md',
    '    note: API 说明',
    'history:',
    '  - event: created',
    '    at: 2026-09-20T09:00:00+08:00',
    '    actor: user',
    '  - event: status',
    '    at: 2026-09-21T11:00:00+08:00',
    '    actor: agent',
    '    from: todo',
    '    to: in_progress',
    '---',
    '',
    '# 交付 API',
    '',
    '## 目标',
    '',
    'x',
    '',
    '## 完成条件',
    '',
    '- y',
    '',
    '## 工作记录',
    '',
  ].join('\n');

  const document = parseTaskDocument(source, 'T-0007.md');
  assert.deepEqual(document.claim, {
    role: 'worker',
    sessionId: 'thread-x',
    claimedAt: '2026-09-21T10:30:00+08:00',
    executionId: 'run-42',
  });
  assert.deepEqual(document.dependsOn, [
    { task: 'T-0005', mode: 'full' },
    { task: 'T-0100', mode: 'partial', gate: 'api-ready' },
  ]);
  assert.deepEqual(document.manualBlockers, ['等待法务审批']);
  assert.deepEqual(document.supersedes, ['T-0006']);
  assert.deepEqual(document.outputs, [{ path: 'docs/api.md', note: 'API 说明' }]);
  assert.equal(document.history.length, 2);
  assert.deepEqual(document.history[0], {
    event: 'created',
    at: '2026-09-20T09:00:00+08:00',
    actor: 'user',
    extra: {},
  });
  assert.deepEqual(document.history[1]!.extra, { from: 'todo', to: 'in_progress' });
  assert.deepEqual(validateTaskDocument(document), []);
});

test('US-003: rejects a missing task ID', () => {
  const source = '---\ngraph: G-001\nstatus: todo\n---\n\n# Title\n';
  assert.throws(
    () => parseTaskDocument(source, 'bad.md'),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_TASK' &&
      error.details.some((line) => line.includes('id')),
  );
});

test('US-003: rejects a missing graph ID', () => {
  const source = '---\nid: T-0001\nstatus: todo\n---\n\n# Title\n';
  assert.throws(
    () => parseTaskDocument(source, 'bad.md'),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_TASK' &&
      error.details.some((line) => line.includes('graph')),
  );
});

test('US-003: rejects an unsupported status', () => {
  const source = '---\nid: T-0001\ngraph: G-001\nstatus: blocked\n---\n\n# Title\n';
  assert.throws(
    () => parseTaskDocument(source, 'bad.md'),
    (error: unknown) =>
      error instanceof TaskGraphError &&
      error.code === 'E_TASK_STATUS' &&
      /blocked/.test(error.message),
  );
  const blocked = parseTaskDocument(PRD_TASK_EXAMPLE, 'T-0002.md');
  assert.ok(
    validateTaskDocument({ ...blocked, status: 'blocked' as never }).some(
      (issue) => issue.code === 'E_TASK_STATUS',
    ),
  );
});

test('US-003: rejects a missing H1 title', () => {
  const source = '---\nid: T-0001\ngraph: G-001\nstatus: todo\n---\n\n## 目标\n\nx\n';
  assert.throws(
    () => parseTaskDocument(source, 'bad.md'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_TITLE',
  );
});

test('US-003: rejects malformed frontmatter', () => {
  assert.throws(
    () => parseTaskDocument('# Title only\n', 'bad.md'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_FORMAT',
  );
  assert.throws(
    () => parseTaskDocument('---\nid: T-0001\n\n# Title\n', 'bad.md'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_TASK_FORMAT',
  );
});

test('US-003: serialises deterministically with canonical key order', () => {
  const document = parseTaskDocument(COMPOSITE_TASK_EXAMPLE, 'T-0100.md');
  const first = serializeTaskDocument(document);
  const second = serializeTaskDocument({ ...document });
  assert.equal(first, second);

  const keys = [...first.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]!);
  assert.deepEqual(keys, [
    'id',
    'graph',
    'status',
    'claim',
    'depends_on',
    'manual_blockers',
    'subgraph',
    'supersedes',
    'derived_from',
    'outputs',
    'history',
  ]);
});

test('US-003: writing frontmatter preserves the Markdown body byte-for-byte', () => {
  const workspace = useTempWorkspace(test, 'us-003-preserve');
  const original = parseTaskDocument(COMPOSITE_TASK_EXAMPLE, 'T-0100.md');
  workspace.write(
    '.task-graph/tasks/T-0100.md',
    serializeTaskDocument(original),
  );
  const before = workspace.read('.task-graph/tasks/T-0100.md');

  const edited: TaskDocument = {
    ...original,
    status: 'done',
    history: [
      historyEntry('status', '2026-09-22T08:00:00+08:00', 'agent', {
        from: 'in_progress',
        to: 'done',
      }),
    ],
  };
  writeTaskDocument(workspace.root, edited);
  const after = workspace.read('.task-graph/tasks/T-0100.md');

  assert.notEqual(before, after);
  assert.equal(edited.body, after.slice(after.indexOf('\n---\n') + 5));
  assert.ok(after.endsWith(original.body));
  assert.deepEqual(readTaskDocument(workspace.root, 'T-0100'), edited);
  assert.deepEqual(parseTaskDocument(after, 'T-0100.md').body, original.body);
});

test('US-003: round-trips UTF-8 Chinese titles, body text and Windows paths', () => {
  const body = [
    '',
    '# 实现中文标题',
    '',
    '## 目标',
    '',
    '在 D:\\文档\\ChatGPT\\画板 下生成中文内容，包含 emoji ✅ 与引号“测试”。',
    '',
    '## 完成条件',
    '',
    '- 文件写入成功',
    '',
    '## 工作记录',
    '',
    '记录：路径 C:\\Users\\测试\\任务.md',
    '',
  ].join('\n');
  const document = createTaskDocument({
    id: 'T-0042',
    graph: 'G-001',
    title: '占位',
    body,
  });
  assert.equal(document.title, '实现中文标题');

  const text = serializeTaskDocument(document);
  const reparsed = parseTaskDocument(text, 'T-0042.md');
  assert.equal(reparsed.title, '实现中文标题');
  assert.equal(reparsed.body, body);
  assert.ok(reparsed.body.includes('D:\\文档\\ChatGPT\\画板'));
  assert.ok(reparsed.body.includes('C:\\Users\\测试\\任务.md'));
  assert.equal(serializeTaskDocument(reparsed), text);

  const workspace = useTempWorkspace(test, 'us-003-中文');
  writeTaskDocument(workspace.root, reparsed);
  assert.deepEqual(readTaskDocument(workspace.root, 'T-0042'), reparsed);
});

test('US-003: preserves CRLF documents byte-for-byte', () => {
  const crlf = PRD_TASK_EXAMPLE.split('\n').join('\r\n');
  const document = parseTaskDocument(crlf, 'T-0002.md');
  assert.equal(document.newline, '\r\n');
  assert.equal(document.body, '\r\n# 实现登录接口\r\n\r\n## 目标\r\n\r\n提供密码登录能力。\r\n\r\n## 完成条件\r\n\r\n- 正确凭证可以登录\r\n- 错误凭证会被拒绝\r\n\r\n## 工作记录\r\n');

  const written = serializeTaskDocument(document);
  assert.ok(written.startsWith('---\r\nid: T-0002\r\n'));
  assert.ok(!/[^\r]\n/.test(written), 'CRLF documents must not contain bare LF newlines');
  assert.ok(written.endsWith(document.body));
  assert.equal(serializeTaskDocument(parseTaskDocument(written, 'T-0002.md')), written);

  const workspace = useTempWorkspace(test, 'us-003-crlf');
  writeTaskDocument(workspace.root, document);
  assert.equal(workspace.read('.task-graph/tasks/T-0002.md'), written);
});

test('US-003: title helpers never touch the rest of the body', () => {
  const document = parseTaskDocument(PRD_TASK_EXAMPLE, 'T-0002.md');
  assert.equal(extractTaskTitle(document.body), '实现登录接口');
  const renamed = replaceTaskTitle(document.body, '实现登录接口（修订）');
  assert.equal(extractTaskTitle(renamed), '实现登录接口（修订）');
  assert.equal(
    renamed.replace('# 实现登录接口（修订）', '# 实现登录接口'),
    document.body,
  );
});

test('US-003: body helpers detect the required sections', () => {
  const body = buildTaskBody({
    title: '新任务',
    goal: '完成一件事。',
    completionConditions: ['条件一', '条件二'],
  });
  assert.deepEqual(missingBodySections(body), []);
  for (const section of REQUIRED_BODY_SECTIONS) {
    assert.ok(body.includes(`## ${section}`), `missing section ${section}`);
  }
  assert.deepEqual(missingBodySections('# 标题\n\n## 目标\n\nx\n'), ['完成条件', '工作记录']);
});

test('US-003: rejects an executed task without a claim identity', () => {
  const document = parseTaskDocument(PRD_TASK_EXAMPLE, 'T-0002.md');
  const issues = validateTaskDocument({
    ...document,
    claim: { role: '', sessionId: '', claimedAt: 'not-a-date' },
  });
  assert.equal(issues.filter((issue) => issue.code === 'E_TASK_CLAIM').length, 3);
});

test('US-003: reading a missing task file reports a helpful error', () => {
  const workspace = useTempWorkspace(test, 'us-003-missing');
  assert.throws(
    () => readTaskDocument(workspace.root, 'T-9999'),
    (error: unknown) => error instanceof TaskGraphError && error.code === 'E_NO_TASK',
  );
});
