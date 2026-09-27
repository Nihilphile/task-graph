import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { historyEntry, type TaskDocument } from './task.js';
import { appendManagedLog } from './documents.js';

export interface LogOptions extends ClockOptions {
  readonly id: string;
  readonly text: string;
}

export interface OutputOptions extends ClockOptions {
  readonly id: string;
  readonly path: string;
  readonly note?: string | undefined;
}

/** Append an entry to the visible 工作记录 section and record the action in history. */
export function addWorkLog(root: string, options: LogOptions): TaskDocument {
  const text = options.text.trim();
  if (!text) throw new TaskGraphError('E_TASK_LOG', 'A work log entry is required');
  return mutateTaskDocument(root, options.id, (current, transaction) => current.summary !== undefined || current.content !== undefined || !/^##[ \t]+工作记录[ \t]*$/m.test(current.body)
    ? appendManagedLog(root, current, transaction, text, options)
    : ({
    ...current,
    body: appendWorkLog(current.body, text, current.newline),
    history: [
      ...current.history,
      historyEntry('work_logged', timestampOf(options.now), options.actor ?? null, { text }),
    ],
  }));
}

export function addTaskOutput(root: string, options: OutputOptions): TaskDocument {
  const outputPath = normalizeOutputPath(options.path);
  const note = options.note?.trim();
  return mutateTaskDocument(root, options.id, (current) => {
    if (current.outputs.some((output) => output.path === outputPath)) {
      throw new TaskGraphError('E_DUP_OUTPUT', `Task "${current.id}" already lists "${outputPath}"`);
    }
    return {
      ...current,
      outputs: [...current.outputs, note ? { path: outputPath, note } : { path: outputPath }],
      history: [
        ...current.history,
        historyEntry('output_added', timestampOf(options.now), options.actor ?? null, { path: outputPath }),
      ],
    };
  });
}

export function removeTaskOutput(root: string, options: OutputOptions): TaskDocument {
  const outputPath = normalizeOutputPath(options.path);
  return mutateTaskDocument(root, options.id, (current) => {
    if (current.outputs.some(o => o.path === outputPath && o.kind === 'content')) throw new TaskGraphError('E_CONTENT_REMOVE', 'Use task content remove to preserve at least one requirements file');
    if (!current.outputs.some((output) => output.path === outputPath)) {
      throw new TaskGraphError('E_NO_OUTPUT', `Task "${current.id}" does not list "${outputPath}"`);
    }
    return {
      ...current,
      outputs: current.outputs.filter((output) => output.path !== outputPath),
      history: [
        ...current.history,
        historyEntry('output_removed', timestampOf(options.now), options.actor ?? null, { path: outputPath }),
      ],
    };
  });
}

function normalizeOutputPath(value: string): string {
  const raw = value.trim().replaceAll('\\', '/');
  const normalized = path.posix.normalize(raw);
  if (!raw || normalized === '.' || normalized === '..' || normalized.startsWith('../') ||
      normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new TaskGraphError('E_OUTPUT_PATH', 'Output path must be relative to the project root');
  }
  return normalized;
}

function appendWorkLog(body: string, text: string, newline: '\n' | '\r\n'): string {
  const heading = /^##[ \t]+工作记录[ \t]*$/m.exec(body);
  if (!heading) throw new TaskGraphError('E_TASK_SECTION', 'Task body has no "## 工作记录" section');
  const contentStart = heading.index + heading[0].length;
  const rest = body.slice(contentStart);
  const next = /^##[ \t]+/m.exec(rest);
  const contentEnd = next ? contentStart + next.index : body.length;
  const before = body.slice(0, contentEnd).replace(/\s*$/, '');
  const after = body.slice(contentEnd).replace(/^\s*/, '');
  return `${before}${newline}${newline}${text}${newline}${after ? `${newline}${after}` : ''}`;
}
