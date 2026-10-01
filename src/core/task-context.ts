import path from 'node:path';
import { groupedContracts, selectContractText } from './contract-sections.js';
import { readKnowledge, type CodeReference } from './knowledge-store.js';
import { documentMetadata, documentPath, documentView, readDocument, type DocumentView, type DocumentKind } from './documents.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import { contentBindings, type TaskDocument, type TaskOutput } from './task.js';

export interface ContextFile {
  readonly sections?: readonly string[];
  readonly id?: string;
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
  readonly contracts: readonly ContextFile[];
  readonly code_references: readonly CodeReference[];
  readonly project_root: string;
  readonly content: ContextFile;
  readonly contents: readonly ContextFile[];
  readonly review_requirements: readonly ContextFile[];
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
    if (o.kind === 'content') continue;
    if (binding.scope === 'dependency' && (o.kind === 'log' || o.kind === 'handoff' || o.kind === 'review-requirement')) continue;
    // Old generated handoffs can contain copies of unrelated attachments; require review before reuse.
    const reason = o.audience === 'user' ? 'audience_user' : pathExcluded(o) ? 'excluded_path'
      : o.kind === 'handoff' && o.path === o.snapshot && !o.handoffFormat && o.audience !== 'agent' ? 'legacy_aggregate' : undefined;
    if (reason) { excluded.push({ source_task: binding.task.id, kind: o.kind ?? 'output', path: o.path, reason }); continue; }
    entries.push({ ...filePointer(root, o), source_task: binding.task.id, scope: binding.scope });
  }
  const contents: ContextFile[] = contentBindings(task).map(o => {
    if (pathExcluded(o)) {
      excluded.push({ source_task: task.id, kind: 'content', path: o.path, reason: 'excluded_path' });
      return { path: o.path, read_path: o.snapshot ?? o.path, title: o.title ?? task.title, mode: 'live', kind: 'content', excluded: 'excluded_path' };
    }
    return { ...filePointer(root, o), kind: 'content', source_task: task.id, scope: 'self' };
  });
  const content = contents[0]!;
  const contentExcluded = paths.has(key(`.task-graph/tasks/${task.id}.md`));
  const logs = entries.filter(o => o.kind === 'log');
  const knowledge = knowledgeContext(root, task, repository);
  const contracts = knowledge.contracts.filter(c => {
    if (!paths.has(key(c.path))) return true;
    excluded.push({ source_task: task.id, kind: 'contract', path: c.path, reason: 'excluded_path' });
    return false;
  });
  if (/^##[ \t]+工作记录[ \t]*\r?\n\s*\S/m.test(task.body) && !contentExcluded) {
    logs.push({ ...filePointer(root, { path: `.task-graph/tasks/${task.id}.md`, title: '任务正文中的工作记录' }), kind: 'log', source_task: task.id, scope: 'self', section: 'work_log' });
  }
  return {
    project_root: path.resolve(root),
    ...knowledge, contracts,
    content, contents, review_requirements: entries.filter(o => o.kind === 'review-requirement'),
    references: entries.filter(o => o.kind === 'reference'),
    handoffs: entries.filter(o => o.kind === 'handoff'),
    reports: entries.filter(o => o.kind === 'report'),
    logs, outputs: entries.filter(o => o.kind === 'output'), excluded,
  };
}

export function contextFiles(context: TaskContext): readonly ContextFile[] {
  return [...context.contents, ...context.contracts, ...context.review_requirements, ...context.references, ...context.reports, ...context.logs, ...context.handoffs, ...context.outputs].filter(o => !o.excluded);
}

export function knowledgeContext(root: string, task: TaskDocument, repository = loadTaskRepository(root)) {
  const store = readKnowledge(root);
  const sourceIds = new Set([task.id, ...task.dependsOn.map(d => d.task)]);
  for (const d of task.dependsOn) if (d.mode === 'partial') {
    for (const id of repository.taskById(d.task)?.subgraph?.exposes.find(g => g.name === d.gate)?.requires ?? []) sourceIds.add(id);
  }
  const referenceIds = new Set<string>();
  for (const id of sourceIds) for (const r of repository.taskById(id)?.references ?? []) referenceIds.add(r);
  const groups = groupedContracts(task.contracts);
  const contracts = store.contracts.filter(c => groups.has(c.id)).map(c => {
    for (const r of c.references) referenceIds.add(r);
    const sections = groups.get(c.id);
    const pointer = filePointer(root, { path: c.file, title: c.title });
    if (sections && !pointer.error) {
      try { return { ...pointer, sections, size_bytes: Buffer.byteLength(selectContractText(readDocument(root, c.file).toString('utf8'), sections)), kind: 'contract' as const, id: c.id, source_task: task.id, scope: 'self' as const }; }
      catch (error) { return { ...pointer, sections, error: String(error), kind: 'contract' as const, id: c.id, source_task: task.id, scope: 'self' as const }; }
    }
    return { ...pointer, kind: 'contract' as const, id: c.id, source_task: task.id, scope: 'self' as const };
  });
  return { contracts, code_references: store.references.filter(r => referenceIds.has(r.id)) };
}

export function referenceDocuments(root: string, task: TaskDocument, repository = loadTaskRepository(root)): DocumentView[] {
  return attachmentBindings(task, repository).filter(binding => binding.output.kind === 'reference').map(binding => {
    const doc = documentView(root, 'reference', binding.output);
    return { ...doc, id: `${binding.task.id}:${doc.id}`, source_task: binding.task.id, scope: binding.scope,
      read_path: binding.output.snapshot ?? binding.output.path };
  });
}

export function formatTaskContext(context: TaskContext, options: { portable?: boolean; detail?: boolean } = {}): string {
  const lines = ['## 接手文件索引', options.portable ? '以下路径均相对于项目根目录。' : `项目根目录：${context.project_root}`, `任务要求：${context.content.read_path}`];
  if (context.content.error) lines.push(`要求文件错误：${context.content.error}`);
  for (const c of context.contracts) lines.push(`当前契约：${c.read_path} · ${c.title}${c.sections ? ' · 章节：' + c.sections.join(', ') : ' · 全文'}${c.error ? ' · ' + c.error : ''}`);
  for (const r of context.code_references) lines.push(`代码入口 ${r.id}：${r.path}:${r.line}（${r.symbol}）｜${r.summary}`);
  for (const file of context.contents.slice(1)) lines.push(`任务要求：${file.read_path}${file.summary ? ' · ' + file.summary : ''}${file.error ? ' · ' + file.error : ''}${file.excluded ? ' · 已排除' : ''}`);
  for (const entry of context.references) {
    lines.push(`- ${entry.scope === 'self' ? '本任务' : '依赖'} ${entry.source_task} · ${entry.title}：${entry.read_path} (${entry.mode})${entry.summary ? '\n  ' + entry.summary : ''}${entry.error ? '\n  错误：' + entry.error : ''}`);
  }
  for (const [kind, files] of [['验收要求', context.review_requirements], ['交接', context.handoffs], ['报告', context.reports], ['记录', context.logs], ['产物', context.outputs]] as const) {
    for (const file of files) lines.push(`- ${kind} · ${file.source_task} · ${file.title}：${file.read_path} (${file.mode})${file.summary ? '\n  ' + file.summary : ''}${file.error ? '\n  错误：' + file.error : ''}`);
  }
  if (context.content.excluded) lines.push(`要求已排除：${context.content.excluded}`);
  if (context.excluded.length) lines.push(`排除 ${context.excluded.length} 项`, ...(options.detail ? context.excluded.map(o => `- ${o.source_task} · ${o.path} (${o.reason})`) : []));
  return lines.join('\n');
}
