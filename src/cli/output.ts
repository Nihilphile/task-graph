import type { ParsedArgs } from './args.js';
import type { CliContext } from './context.js';
import type { TaskContext } from '../core/task-context.js';
import type { TaskOutput } from '../core/task.js';
import { currentReview, readReviewState, reviewView } from '../core/review-state.js';

export interface FilePointer {
  path?: string; read_path?: string; snapshot?: string; title?: string; summary?: string;
  mode?: string; source_task?: string; scope?: string; section?: string; error?: string;
  excluded?: string; body?: string;
}

/** File collections keep every usable entry; detail changes metadata, never audience. */
export function fileView<T extends FilePointer>(file: T, detail = false) {
  if (detail) return file;
  const read_path = file.read_path ?? file.snapshot ?? file.path;
  return {
    read_path,
    ...(file.path && file.path !== read_path ? { path: file.path } : {}),
    ...(file.summary ? { summary: file.summary } : file.title ? { title: file.title } : {}),
    ...(file.mode || file.snapshot ? { mode: file.mode ?? 'snapshot' } : {}),
    ...(file.scope === 'dependency' ? { source_task: file.source_task } : {}),
    ...(file.section ? { section: file.section } : {}),
    ...(file.error ? { error: file.error } : {}),
    ...(file.excluded ? { excluded: file.excluded } : {}),
    ...(file.body !== undefined ? { body: file.body } : {}),
  };
}

export function contextView(context: TaskContext, detail = false) {
  if (detail) return context;
  const groups = ['contents', 'review_requirements', 'references', 'reports', 'logs', 'handoffs', 'outputs'] as const;
  return { project_root: context.project_root,
    ...Object.fromEntries(groups.filter(k => context[k].length).map(k => [k, context[k].map(f => fileView(f))])),
    ...(context.excluded.length ? { excluded_count: context.excluded.length } : {}),
  };
}

/** Writes confirm their own attachment, not every older attachment on the task. */
export function attachmentView(output: TaskOutput, detail = false) {
  return { kind: output.kind ?? 'output', ...fileView(output, detail),
    ...(output.audience === 'user' ? { audience: 'user' } : {}) };
}

export function visibleOutputs(outputs: readonly TaskOutput[]) {
  return outputs.filter(o => o.audience !== 'user' && !(o.kind === 'handoff' && o.path === o.snapshot && !o.handoffFormat && o.audience !== 'agent'));
}

export function reviewSummary(root: string, id: string, detail = false) {
  if (detail) return reviewView(root, id);
  const state = readReviewState(root), run = currentReview(state, id);
  return { enabled: state.tasks[id]?.enabled ?? false, ...(run ? { current: {
    id: run.id, state: run.state, trigger: run.trigger, model: run.config.model, mode: run.config.mode,
    created_at: run.createdAt, ...(run.startedAt ? { started_at: run.startedAt } : {}),
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    ...(run.sessionId ? { session_id: run.sessionId } : {}),
    ...(run.error ? { error: run.error, log: run.log } : {}),
    ...(['blocked', 'failed'].includes(run.state) ? { recovery: `task[${id}].review restart` } : {}),
    ...(run.report ? { report: fileView({ ...run.report, mode: 'snapshot' }) } : {}),
  } } : {}) };
}

export function emitResult(ctx: CliContext, args: ParsedArgs, data: Record<string, unknown>): void {
  if (args.flag('quiet') && data.ok !== false) return;
  ctx.io.out(args.flag('json') ? JSON.stringify(data, null, 2) : renderResult(data));
}

/** Text and JSON render the same selected business fields. */
export function renderResult(value: unknown, indent = ''): string {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(v => `${indent}- ${typeof v === 'object' && v !== null ? '\n' + renderResult(v, indent + '  ') : String(v)}`).join('\n') : `${indent}[]`;
  return Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) =>
    v !== null && typeof v === 'object' ? `${indent}${k}:\n${renderResult(v, indent + '  ')}` : `${indent}${k}: ${String(v)}`).join('\n');
}
