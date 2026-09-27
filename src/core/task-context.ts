import path from 'node:path';
import { documentMetadata, documentPath, documentView, type DocumentView, type DocumentKind } from './documents.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import type { TaskDocument, TaskOutput } from './task.js';

export interface ContextFile {
  readonly path: string;
  readonly read_path: string;
  readonly title: string;
  readonly summary?: string;
  readonly mode: 'live' | 'snapshot';
  readonly sha256?: string;
  readonly error?: string;
  readonly kind?: DocumentKind;
  readonly source_task?: string;
  readonly scope?: 'self' | 'dependency';
  readonly audience?: 'agent' | 'user';
  readonly size_bytes?: number;
  readonly excluded?: string;
  readonly section?: 'work_log';
}
export interface ContextReference extends ContextFile {
  readonly source_task: string;
  readonly scope: 'self' | 'dependency';
}
export interface TaskContext {
  readonly project_root: string;
  readonly content: ContextFile;
  readonly references: readonly ContextReference[];
  readonly handoffs: readonly ContextFile[];
  readonly reports: readonly ContextFile[];
  readonly logs: readonly ContextFile[];
  readonly outputs: readonly ContextFile[];
  readonly excluded: readonly { source_task: string; kind: string; path: string; reason: string }[];
}

export interface ContextOptions { readonly excludePaths?: readonly string[]; }

/** The source set is shared by the address manifest and offline document rendering. */
function attachmentBindings(task: TaskDocument, repository: TaskRepository): { task: TaskDocument; output: TaskOutput; scope: 'self' | 'dependency' }[] {
  const sources = new Map<string, TaskDocument>([[task.id, task]]);
  for (const dep of task.dependsOn) {
    const parent = repository.taskById(dep.task);
    if (!parent) continue;
    sources.set(parent.id, parent);
    if (dep.mode === 'partial') {
      for (const id of parent.subgraph?.exposes.find(point => point.name === dep.gate)?.requires ?? []) {
        const member = repository.taskById(id);
        if (member) sources.set(id, member);
      }
    }
  }
  return [...sources.values()].flatMap(source => source.outputs
    .map(output => ({ task: source, output, scope: source.id === task.id ? 'self' as const : 'dependency' as const })));
}

function filePointer(root: string, output: TaskOutput): ContextFile {
  const file = output.snapshot ?? output.path;
  let error: string | undefined;
  let metadata: { size_bytes: number } | undefined;
  try { metadata = documentMetadata(root, file); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return { path: output.path, read_path: file, title: output.title ?? path.posix.basename(output.path),
    ...(output.summary ? { summary: output.summary } : {}), mode: output.snapshot ? 'snapshot' : 'live',
    kind: output.kind ?? 'output', audience: output.audience ?? 'agent', ...metadata,
    ...(output.sha256 ? { sha256: output.sha256 } : {}), ...(error ? { error } : {}) };
}

/** Read-only manifest: no document body is included or linked files expanded. */
export function taskContext(root: string, task: TaskDocument, repository = loadTaskRepository(root), options: ContextOptions = {}): TaskContext {
  const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const paths = new Set((options.excludePaths ?? []).map(value => key(documentPath(value))));
  const pathExcluded = (output: TaskOutput) => paths.has(key(output.path)) || (!!output.snapshot && paths.has(key(output.snapshot)));
  const excluded: { source_task: string; kind: string; path: string; reason: string }[] = [];
  const entries: (ContextFile & { source_task: string; scope: 'self' | 'dependency' })[] = [];
  for (const binding of attachmentBindings(task, repository)) {
    const o = binding.output;
    if (binding.scope === 'dependency' && (o.kind === 'log' || o.kind === 'handoff')) continue;
    // Old generated handoffs can contain copies of unrelated attachments; require review before reuse.
    const reason = o.audience === 'user' ? 'audience_user' : pathExcluded(o) ? 'excluded_path'
      : o.kind === 'handoff' && o.path === o.snapshot && !o.handoffFormat && o.audience !== 'agent' ? 'legacy_aggregate' : undefined;
    if (reason) { excluded.push({ source_task: binding.task.id, kind: o.kind ?? 'output', path: o.path, reason }); continue; }
    entries.push({ ...filePointer(root, o), source_task: binding.task.id, scope: binding.scope });
  }
  const contentPath = task.content ?? `.task-graph/tasks/${task.id}.md`;
  const contentExcluded = paths.has(key(contentPath));
  const content: ContextFile = contentExcluded
    ? { path: contentPath, read_path: contentPath, title: task.title, mode: 'live', kind: 'content', excluded: 'excluded_path' }
    : { ...filePointer(root, { path: contentPath, title: task.title, summary: task.summary ?? task.title }), kind: 'content', source_task: task.id, scope: 'self' };
  const logs = entries.filter(o => o.kind === 'log');
  if (/^##[ \t]+工作记录[ \t]*\r?\n\s*\S/m.test(task.body) && !contentExcluded) {
    logs.push({ ...filePointer(root, { path: `.task-graph/tasks/${task.id}.md`, title: '任务正文中的工作记录' }), kind: 'log', source_task: task.id, scope: 'self', section: 'work_log' });
  }
  return {
    project_root: path.resolve(root),
    content,
    references: entries.filter(o => o.kind === 'reference'),
    handoffs: entries.filter(o => o.kind === 'handoff'),
    reports: entries.filter(o => o.kind === 'report'),
    logs, outputs: entries.filter(o => o.kind === 'output'), excluded,
  };
}

export function contextFiles(context: TaskContext): readonly ContextFile[] {
  return [context.content, ...context.references, ...context.reports, ...context.logs, ...context.handoffs, ...context.outputs].filter(o => !o.excluded);
}

export function referenceDocuments(root: string, task: TaskDocument, repository = loadTaskRepository(root)): DocumentView[] {
  return attachmentBindings(task, repository).filter(binding => binding.output.kind === 'reference').map(binding => {
    const doc = documentView(root, 'reference', binding.output);
    return { ...doc, id: `${binding.task.id}:${doc.id}`, source_task: binding.task.id, scope: binding.scope,
      read_path: binding.output.snapshot ?? binding.output.path };
  });
}

export function formatTaskContext(context: TaskContext, options: { portable?: boolean } = {}): string {
  const lines = ['## 接手文件索引', options.portable ? '以下路径均相对于项目根目录。' : `项目根目录：${context.project_root}`, `任务要求：${context.content.read_path}`];
  if (context.content.error) lines.push(`要求文件错误：${context.content.error}`);
  for (const entry of context.references) {
    lines.push(`- ${entry.scope === 'self' ? '本任务' : '依赖'} ${entry.source_task} · ${entry.title}：${entry.read_path} (${entry.mode})${entry.summary ? '\n  ' + entry.summary : ''}${entry.error ? '\n  错误：' + entry.error : ''}`);
  }
  for (const [kind, files] of [['交接', context.handoffs], ['报告', context.reports], ['记录', context.logs], ['产物', context.outputs]] as const) {
    for (const file of files) lines.push(`- ${kind} · ${file.source_task} · ${file.title}：${file.read_path} (${file.mode})${file.summary ? '\n  ' + file.summary : ''}${file.error ? '\n  错误：' + file.error : ''}`);
  }
  if (context.content.excluded) lines.push(`要求已排除：${context.content.excluded}`);
  if (context.excluded.length) lines.push(`排除 ${context.excluded.length} 项：`, ...context.excluded.map(o => `- ${o.source_task} · ${o.path} (${o.reason})`));
  return lines.join('\n');
}
