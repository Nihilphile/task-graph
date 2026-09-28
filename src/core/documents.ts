import path from 'node:path';
import { readFileSync, realpathSync, statSync, accessSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { Marked } from 'marked';
import { TaskGraphError } from './errors.js';
import { mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { contentBindings, historyEntry, type TaskDocument, type TaskOutput } from './task.js';
import type { ProjectTransaction } from './transaction.js';
import { loadTaskRepository } from './repo.js';
import { computeReadiness } from './readiness.js';
import { taskContext, formatTaskContext, contextFiles, type ContextOptions } from './task-context.js';

export type DocumentKind = 'content' | 'review-requirement' | 'report' | 'log' | 'handoff' | 'reference' | 'output';
export interface DocumentView {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly path: string;
  readonly summary?: string;
  readonly audience?: 'agent' | 'user';
  readonly source_task?: string;
  readonly scope?: 'self' | 'dependency';
  readonly read_path?: string;
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
  readonly reviewRequirements: readonly DocumentView[];
  readonly content: DocumentView;
  readonly contents: readonly DocumentView[];
  readonly reports: readonly DocumentView[];
  readonly logs: readonly DocumentView[];
  readonly handoffs: readonly DocumentView[];
  readonly outputs: readonly DocumentView[];
  readonly references?: readonly DocumentView[];
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

function resolvedDocument(root: string, relative: string): string {
  const file = documentPath(relative);
  try {
    const actual = realpathSync(path.resolve(root, file));
    const base = realpathSync(root);
    const local = path.relative(base, actual);
    if (local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
      throw new TaskGraphError('E_DOCUMENT_PATH', `Document resolves outside the project: ${relative}`);
    }
    return actual;
  } catch (error) {
    if (error instanceof TaskGraphError) throw error;
    throw new TaskGraphError('E_DOCUMENT_FILE', `Cannot read document "${file}"`, ['Create the file before binding it to a task.']);
  }
}

/** Inspect accessibility and size without loading attachment bytes. */
export function documentMetadata(root: string, relative: string): { size_bytes: number } {
  const file = resolvedDocument(root, relative);
  try {
    accessSync(file, constants.R_OK);
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
    return { size_bytes: stat.size };
  } catch { throw new TaskGraphError('E_DOCUMENT_FILE', `Cannot read document "${relative}"`); }
}

export function readDocument(root: string, relative: string): Buffer {
  try { return readFileSync(resolvedDocument(root, relative)); }
  catch (error) {
    if (error instanceof TaskGraphError) throw error;
    throw new TaskGraphError('E_DOCUMENT_FILE', `Cannot read document "${relative}"`);
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
  readonly kind: 'content' | 'review-requirement' | 'report' | 'log' | 'handoff' | 'reference';
  readonly path: string;
  readonly title?: string;
  readonly note?: string;
  readonly summary?: string;
  readonly snapshot?: boolean;
  readonly audience?: 'agent' | 'user';
}

export function withDocument(root: string, current: TaskDocument, transaction: ProjectTransaction, options: AttachDocumentOptions): TaskDocument {
  if (options.audience !== undefined && !['agent', 'user'].includes(options.audience)) throw new TaskGraphError('E_DOCUMENT_AUDIENCE', 'Audience must be agent or user');
  const file = documentPath(options.path);
  if (options.kind === 'content' || options.kind === 'review-requirement') {
    requireContent(root, file);
    if (options.audience === 'user') throw new TaskGraphError('E_CONTENT_AUDIENCE', 'Task requirements must be readable by the executing agent');
    if (options.kind === 'content' && current.content === file) throw new TaskGraphError('E_DUP_OUTPUT', 'This file is already task content');
  }
  const bytes = readDocument(root, file);
  if (options.snapshot && options.kind !== 'reference') throw new TaskGraphError('E_DOCUMENT_MODE', '--snapshot is only supported for reference attachments');
  const snapshot = options.kind === 'content' || options.kind === 'review-requirement' || options.kind === 'log' || (options.kind === 'reference' && !options.snapshot) ? {} : snapshotDocument(transaction, file, bytes);
  if (current.outputs.some((output) => output.path === file && output.kind === options.kind && output.sha256 === ('sha256' in snapshot ? snapshot.sha256 : undefined))) {
    throw new TaskGraphError('E_DUP_OUTPUT', `Task "${current.id}" already contains this ${options.kind} document`);
  }
  const output: TaskOutput = {
    path: file, kind: options.kind, title: options.title?.trim() || path.posix.basename(file),
    addedAt: timestampOf(options.now), ...(options.actor ? { actor: options.actor } : {}),
    ...(options.note ? { note: options.note } : {}), ...snapshot,
    ...(options.summary?.trim() ? { summary: options.summary.trim() } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
  };
  return { ...current, outputs: [...current.outputs, output], history: [...current.history,
    historyEntry(`${options.kind}_attached`, output.addedAt!, options.actor ?? null, { path: file, ...(output.sha256 ? { sha256: output.sha256 } : {}) }),
  ] };
}

export function attachDocument(root: string, options: AttachDocumentOptions): TaskDocument {
  return mutateTaskDocument(root, options.id, (current, transaction) => withDocument(root, current, transaction, options));
}

export function removeContent(root: string, options: ClockOptions & { id: string; path: string }): TaskDocument {
  const file = documentPath(options.path);
  return mutateTaskDocument(root, options.id, current => {
    if (current.content !== file && !current.outputs.some(o => o.kind === 'content' && o.path === file)) throw new TaskGraphError('E_NO_CONTENT', 'Content is not bound to this task');
    const next = { ...current, ...(current.content === file ? { content: undefined } : {}), outputs: current.outputs.filter(o => o.kind !== 'content' || o.path !== file) };
    if (!next.content && !next.outputs.some(o => o.kind === 'content')) throw new TaskGraphError('E_CONTENT_EMPTY', 'Keep at least one requirements file; attach the replacement first');
    return { ...next, history: [...next.history, historyEntry('content_removed', timestampOf(options.now), options.actor ?? null, { path: file })] };
  });
}

export function setDocumentAudience(root: string, options: ClockOptions & { id: string; path: string; audience: string }): TaskDocument {
  if (options.audience !== 'agent' && options.audience !== 'user') throw new TaskGraphError('E_DOCUMENT_AUDIENCE', 'Audience must be agent or user');
  const file = documentPath(options.path);
  const audience = options.audience;
  return mutateTaskDocument(root, options.id, current => {
    if (!current.outputs.some(o => o.path === file)) throw new TaskGraphError('E_NO_OUTPUT', `Task "${options.id}" does not list "${file}"`);
    if (audience === 'user' && current.outputs.some(o => o.path === file && ['content', 'review-requirement'].includes(o.kind ?? ''))) throw new TaskGraphError('E_CONTENT_AUDIENCE', 'Task requirements must remain agent-readable');
    return { ...current, outputs: current.outputs.map(o => o.path === file ? { ...o, audience } : o),
      history: [...current.history, historyEntry('audience_changed', timestampOf(options.now), options.actor ?? null, { path: file, audience })] };
  });
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

export function documentView(root: string, kind: DocumentKind, output: TaskOutput): DocumentView {
  const result: DocumentView = { id: `${kind}:${output.path}:${output.sha256 ?? ''}`, kind, title: output.title || output.note || path.posix.basename(output.path), ...output };
  const file = output.snapshot ?? output.path;
  try {
    const bytes = readDocument(root, file);
    if (/\.(md|markdown|txt)$/i.test(file) || (kind === 'reference' && /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|py|rs|go|java|c|h|cpp|cs|sh|ps1|sql|toml|xml|html|css|log)$/i.test(file))) {
      const body = bytes.toString('utf8');
      return { ...result, body, html: /\.(md|markdown)$/i.test(file) ? renderDocumentMarkdown(root, output.path, body) : `<pre>${escapeHtml(body)}</pre>` };
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
  const contents = contentBindings(task).map(o => o.path === inline.path ? inline : documentView(root, 'content', o));
  const content = contents[0]!;
  const documents = task.outputs.map((output) => documentView(root, output.kind ?? 'output', output));
  const sorted = (kind: DocumentKind): DocumentView[] => documents.filter((doc) => doc.kind === kind).reverse().sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  const logs = sorted('log');
  const legacy = /^##[ \t]+工作记录[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/m.exec(task.body)?.[1]?.trim();
  if (legacy) logs.push({ id: 'log:inline', kind: 'log', title: '任务正文中的工作记录', path: inline.path, body: legacy, html: renderDocumentMarkdown(root, inline.path, legacy) });
  return { content, contents, reviewRequirements: sorted('review-requirement'), reports: sorted('report'), logs, handoffs: sorted('handoff'), outputs: sorted('output'), references: sorted('reference') };
}

export interface HandoffOptions extends ContextOptions {
  readonly detail?: boolean;
  readonly expand?: readonly DocumentKind[];
  readonly expandPaths?: readonly string[];
  readonly preview?: boolean;
}

export function agentHandoff(root: string, task: TaskDocument, options: HandoffOptions = {}) {
  const repository = loadTaskRepository(root);
  const state = computeReadiness(repository).get(task.id);
  const context = taskContext(root, task, repository, options);
  const lines = [`# ${task.id} · ${task.title}`, '', `状态：${task.status} · ${state?.readiness ?? 'ready'}`,
    `领取：${task.claim ? `${task.claim.role} / ${task.claim.sessionId}` : '未领取'}`,
    '', '## 前置任务'];
  for (const dependency of task.dependsOn) {
    const predecessor = repository.taskById(dependency.task);
    if (!predecessor) continue;
    lines.push('', `### ${predecessor.id} · ${predecessor.title}`, '', `状态：${predecessor.status}${dependency.gate ? ` · 完成点：${dependency.gate}` : ''}`);
  }
  lines.push('', '## 当前阻塞', '', JSON.stringify(state?.blockedBy ?? [], null, 2), '', formatTaskContext(context, { portable: true, detail: options.detail }), '');
  const key = (s: string) => process.platform === 'win32' ? s.toLowerCase() : s;
  const paths = new Set((options.expandPaths ?? []).map(p => key(documentPath(p))));
  const files = contextFiles(context);
  const selected = files.filter(f => (options.expand ?? []).includes(f.kind!) || paths.has(key(f.path)) || paths.has(key(f.read_path)));
  const textFile = (file: string) => /\.(md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|py|rs|go|java|c|h|cpp|cs|sh|ps1|sql|toml|xml|html|css|log)$/i.test(file);
  const headings = selected.map(f => `\n## ${f.source_task} · ${f.kind} · ${f.title}\n来源：${f.path}\n读取：${f.read_path}\n\n`);
  const selectedBytes = selected.reduce((n, f) => n + (!f.error && textFile(f.read_path) ? f.size_bytes ?? 0 : 0), 0);
  const preview = {
    selected_files: selected.map(f => ({ ...f })),
    selected_bytes: selectedBytes,
    estimated_chars_upper_bound: lines.join('\n').length + headings.join('').length + selectedBytes + selected.length * 256,
    estimate_unit: 'UTF-16 code units; upper bound from UTF-8 file sizes plus formatting',
    omitted_count: files.length - selected.length,
    excluded: context.excluded,
  };
  const documents = options.preview ? [] : selected.map((file, index) => {
    let body: string | undefined;
    let error = file.error;
    if (!error && textFile(file.read_path)) {
      try {
        body = file.kind === 'content' && file.path === `.task-graph/tasks/${task.id}.md` ? task.body
          : file.section === 'work_log' ? /^##[ \t]+工作记录[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/m.exec(task.body)?.[1]?.trim() ?? ''
          : readDocument(root, file.read_path).toString('utf8');
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    }
    lines.push(headings[index]!, body ?? error ?? '非文本附件，请按读取路径查看。');
    return { ...file, ...(body !== undefined ? { body } : {}), ...(error ? { error } : {}) };
  });
  return { context, text: lines.join('\n'), preview, documents };
}

export function handoffText(root: string, task: TaskDocument, options: HandoffOptions = {}): string {
  return agentHandoff(root, task, options).text;
}

export function saveHandoff(root: string, current: TaskDocument, transaction: ProjectTransaction, options: ClockOptions & { title?: string; summary?: string }): TaskDocument {
  const at = timestampOf(options.now);
  // Freeze only this task's requirements; attachments remain a filtered address manifest.
  const text = `交接：${options.title ?? current.title}\n生成时间：${at}${options.actor ? `\n记录者：${options.actor}` : ''}\n\n${handoffText(root, current, { expand: ['content'] })}`;
  const snapshot = snapshotDocument(transaction, 'handoff.md', Buffer.from(text));
  if (current.outputs.some((output) => output.kind === 'handoff' && output.sha256 === snapshot.sha256)) return current;
  const output: TaskOutput = { path: snapshot.snapshot, kind: 'handoff', handoffFormat: 'indexed-v1', title: options.title ?? `交接 · ${at}`, addedAt: at, ...(options.actor ? { actor: options.actor } : {}), ...(options.summary?.trim() ? { summary: options.summary.trim() } : {}), ...snapshot };
  return { ...current, outputs: [...current.outputs, output] };
}

export function createHandoff(root: string, options: ClockOptions & { id: string; title?: string; summary?: string }): TaskDocument {
  return mutateTaskDocument(root, options.id, (current, transaction) => {
    const next = saveHandoff(root, current, transaction, options);
    return { ...next, history: [...next.history, historyEntry('handoff_created', timestampOf(options.now), options.actor ?? null)] };
  });
}
