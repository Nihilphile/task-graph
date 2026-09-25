import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Marked } from 'marked';
import { TaskGraphError } from './errors.js';
import { mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { historyEntry, type TaskDocument, type TaskOutput } from './task.js';
import type { ProjectTransaction } from './transaction.js';
import { loadTaskRepository } from './repo.js';
import { computeReadiness } from './readiness.js';

export type DocumentKind = 'content' | 'report' | 'log' | 'handoff' | 'output';
export interface DocumentView {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly path: string;
  readonly addedAt?: string;
  readonly actor?: string;
  readonly snapshot?: string;
  readonly sha256?: string;
  readonly body?: string;
  readonly html?: string;
  readonly href?: string;
  readonly error?: string;
}
export interface TaskDocuments {
  readonly content: DocumentView;
  readonly reports: readonly DocumentView[];
  readonly logs: readonly DocumentView[];
  readonly handoffs: readonly DocumentView[];
  readonly outputs: readonly DocumentView[];
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function renderDocumentMarkdown(root: string, source: string, body: string): string {
  const markdown = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escapeHtml(text),
      image: ({ href, text }) => href.startsWith('data:image/')
        ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">`
        : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text || '打开图片')}</a>`,
    },
    walkTokens(token) {
      if (token.type !== 'link' && token.type !== 'image') return;
      const href = token.href.trim();
      if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) { token.href = '#'; return; }
      try {
        const [file, fragment] = href.split('#');
        const target = documentPath(path.posix.join(path.posix.dirname(source), decodeURIComponent(file!)));
        if (token.type === 'image') {
          const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[path.posix.extname(target).toLowerCase()];
          if (mime) { token.href = `data:${mime};base64,${readDocument(root, target).toString('base64')}`; return; }
        }
        token.href = `../../${target.split('/').map(encodeURIComponent).join('/')}${fragment ? `#${fragment}` : ''}`;
      } catch { token.href = '#'; }
    },
  });
  return markdown.parse(body, { async: false });
}

export function documentPath(value: string): string {
  const raw = value.trim().replaceAll('\\', '/');
  const normalized = path.posix.normalize(raw);
  if (!raw || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || raw.includes('\0')) {
    throw new TaskGraphError('E_DOCUMENT_PATH', 'Document paths must be relative to the project root', [value]);
  }
  return normalized;
}

export function readDocument(root: string, relative: string): Buffer {
  const file = documentPath(relative);
  try {
    const actual = realpathSync(path.resolve(root, file));
    const base = realpathSync(root);
    const local = path.relative(base, actual);
    if (local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
      throw new TaskGraphError('E_DOCUMENT_PATH', `Document resolves outside the project: ${relative}`);
    }
    return readFileSync(actual);
  } catch (error) {
    if (error instanceof TaskGraphError) throw error;
    throw new TaskGraphError('E_DOCUMENT_FILE', `Cannot read document "${file}"`, ['Create the file before binding it to a task.']);
  }
}

export function requireContent(root: string, value: string): string {
  const file = documentPath(value);
  if (!/\.(md|markdown|txt)$/i.test(file)) throw new TaskGraphError('E_CONTENT_FORMAT', 'Task content must be Markdown or plain text');
  readDocument(root, file);
  return file;
}

export function snapshotDocument(transaction: ProjectTransaction, source: string, bytes: Buffer): { snapshot: string; sha256: string } {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const extension = path.posix.extname(source).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.txt';
  const snapshot = `.task-graph/snapshots/${sha256}${extension}`;
  transaction.write(snapshot, bytes);
  return { snapshot, sha256 };
}

export interface AttachDocumentOptions extends ClockOptions {
  readonly id: string;
  readonly kind: 'report' | 'log' | 'handoff';
  readonly path: string;
  readonly title?: string;
  readonly note?: string;
}

export function withDocument(root: string, current: TaskDocument, transaction: ProjectTransaction, options: AttachDocumentOptions): TaskDocument {
  const file = documentPath(options.path);
  const bytes = readDocument(root, file);
  const snapshot = options.kind === 'log' ? {} : snapshotDocument(transaction, file, bytes);
  if (current.outputs.some((output) => output.path === file && output.kind === options.kind && output.sha256 === ('sha256' in snapshot ? snapshot.sha256 : undefined))) {
    throw new TaskGraphError('E_DUP_OUTPUT', `Task "${current.id}" already contains this ${options.kind} document`);
  }
  const output: TaskOutput = {
    path: file, kind: options.kind, title: options.title?.trim() || path.posix.basename(file),
    addedAt: timestampOf(options.now), ...(options.actor ? { actor: options.actor } : {}),
    ...(options.note ? { note: options.note } : {}), ...snapshot,
  };
  return { ...current, outputs: [...current.outputs, output], history: [...current.history,
    historyEntry(`${options.kind}_attached`, output.addedAt!, options.actor ?? null, { path: file, ...(output.sha256 ? { sha256: output.sha256 } : {}) }),
  ] };
}

export function attachDocument(root: string, options: AttachDocumentOptions): TaskDocument {
  return mutateTaskDocument(root, options.id, (current, transaction) => withDocument(root, current, transaction, options));
}

export function appendManagedLog(root: string, current: TaskDocument, transaction: ProjectTransaction, text: string, options: ClockOptions): TaskDocument {
  if (!text.trim()) throw new TaskGraphError('E_TASK_LOG', 'A work log entry is required');
  const file = `.task-graph/logs/${current.id}.md`;
  const known = current.outputs.find((output) => output.kind === 'log' && output.path === file);
  const body = known ? readDocument(root, file).toString('utf8') : `# ${current.id} 工作记录\n`;
  const at = timestampOf(options.now);
  transaction.write(file, `${body.trimEnd()}\n\n## ${at}${options.actor ? ` · ${options.actor}` : ''}\n\n${text.trim()}\n`);
  return { ...current,
    outputs: known ? current.outputs : [...current.outputs, { path: file, kind: 'log', title: '工作记录', addedAt: at, ...(options.actor ? { actor: options.actor } : {}) }],
    history: [...current.history, historyEntry('work_logged', at, options.actor ?? null, { text: text.trim() })],
  };
}

function documentView(root: string, kind: DocumentKind, output: TaskOutput): DocumentView {
  const result: DocumentView = { id: `${kind}:${output.path}:${output.sha256 ?? ''}`, kind, title: output.title || output.note || path.posix.basename(output.path), ...output };
  const file = output.snapshot ?? output.path;
  try {
    const bytes = readDocument(root, file);
    if (/\.(md|markdown|txt)$/i.test(file)) {
      const body = bytes.toString('utf8');
      return { ...result, body, html: /\.txt$/i.test(file) ? `<pre>${escapeHtml(body)}</pre>` : renderDocumentMarkdown(root, output.path, body) };
    }
    // Other file formats retain a link relative to generated/index.html.
    return { ...result, href: `../../${documentPath(file).split('/').map(encodeURIComponent).join('/')}` };
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }
}

export function taskDocuments(root: string, task: TaskDocument): TaskDocuments {
  const inline: DocumentView = { id: 'content:inline', kind: 'content', title: task.title,
    path: `.task-graph/tasks/${task.id}.md`, body: task.body, html: renderDocumentMarkdown(root, `.task-graph/tasks/${task.id}.md`, task.body) };
  const content = task.content ? documentView(root, 'content', { path: task.content, title: task.title }) : inline;
  const documents = task.outputs.map((output) => documentView(root, output.kind ?? 'output', output));
  const sorted = (kind: DocumentKind): DocumentView[] => documents.filter((doc) => doc.kind === kind).reverse().sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  const logs = sorted('log');
  const legacy = /^##[ \t]+工作记录[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/m.exec(task.body)?.[1]?.trim();
  if (legacy) logs.push({ id: 'log:inline', kind: 'log', title: '任务正文中的工作记录', path: inline.path, body: legacy, html: renderDocumentMarkdown(root, inline.path, legacy) });
  return { content, reports: sorted('report'), logs, handoffs: sorted('handoff'), outputs: sorted('output') };
}

export function handoffText(root: string, task: TaskDocument): string {
  const repository = loadTaskRepository(root);
  const state = computeReadiness(repository).get(task.id);
  const docs = taskDocuments(root, task);
  if (docs.content.error) throw new TaskGraphError('E_DOCUMENT_FILE', docs.content.error);
  const lines = [`# ${task.id} · ${task.title}`, '', `状态：${task.status} · ${state?.readiness ?? 'ready'}`,
    `领取：${task.claim ? `${task.claim.role} / ${task.claim.sessionId}` : '未领取'}`,
    `要求来源：${docs.content.path}`, '', '## 完整任务要求', '', docs.content.body ?? '', '', '## 前置任务与产物'];
  for (const dependency of task.dependsOn) {
    const predecessor = repository.taskById(dependency.task);
    if (!predecessor) continue;
    lines.push('', `### ${predecessor.id} · ${predecessor.title}`, '', `状态：${predecessor.status}${dependency.gate ? ` · 完成点：${dependency.gate}` : ''}`);
    for (const doc of [...taskDocuments(root, predecessor).reports, ...taskDocuments(root, predecessor).outputs]) {
      lines.push('', `#### ${doc.title}`, '', `来源：${doc.path}`, '', doc.body ?? doc.error ?? `文件：${doc.path}`);
    }
  }
  lines.push('', '## 当前阻塞', '', JSON.stringify(state?.blockedBy ?? [], null, 2), '', '## 已有进展与报告');
  for (const doc of [...docs.logs, ...docs.reports]) lines.push('', `### ${doc.title}`, '', doc.body ?? doc.error ?? `文件：${doc.path}`);
  lines.push('', '## 回填', '', `使用任务 ID ${task.id} 追加 task log、附加 task report attach，并在满足完成条件后执行 task complete。`, '');
  return lines.join('\n');
}

export function saveHandoff(root: string, current: TaskDocument, transaction: ProjectTransaction, options: ClockOptions & { title?: string }): TaskDocument {
  const at = timestampOf(options.now);
  const text = `交接：${options.title ?? current.title}\n生成时间：${at}${options.actor ? `\n记录者：${options.actor}` : ''}\n\n${handoffText(root, current)}`;
  const snapshot = snapshotDocument(transaction, 'handoff.md', Buffer.from(text));
  if (current.outputs.some((output) => output.kind === 'handoff' && output.sha256 === snapshot.sha256)) return current;
  const output: TaskOutput = { path: snapshot.snapshot, kind: 'handoff', title: options.title ?? `交接 · ${at}`, addedAt: at, ...(options.actor ? { actor: options.actor } : {}), ...snapshot };
  return { ...current, outputs: [...current.outputs, output] };
}

export function createHandoff(root: string, options: ClockOptions & { id: string; title?: string }): TaskDocument {
  return mutateTaskDocument(root, options.id, (current, transaction) => {
    const next = saveHandoff(root, current, transaction, options);
    return { ...next, history: [...next.history, historyEntry('handoff_created', timestampOf(options.now), options.actor ?? null)] };
  });
}
