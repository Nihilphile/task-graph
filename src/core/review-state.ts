import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { TaskGraphError } from './errors.js';
import type { ProjectTransaction } from './transaction.js';

export interface ReviewConfig {
  model: string;
  reasoning: 'low' | 'medium' | 'high' | 'xhigh';
  mode: 'snapshot' | 'live';
  executable?: string;
  timeoutMinutes: number;
}
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = { model: 'gpt-6-sol', reasoning: 'xhigh', mode: 'snapshot', timeoutMinutes: 60 };
export interface FrozenFile { path: string; read_path: string; sha256: string; kind: string; source_task: string; }
export interface Delivery {
  id: string; mode: 'snapshot' | 'live'; sourceRoot: string; workspace: string;
  head?: string; files: { path: string; sha256: string; mode?: number }[]; capturedAt: string;
}
export interface ReviewRun {
  id: string; task: string; trigger: 'auto' | 'manual'; submission: string;
  state: 'queued' | 'running' | 'pass' | 'reject' | 'blocked' | 'failed';
  createdAt: string; config: ReviewConfig; materials: FrozenFile[]; delivery: Delivery;
  workerPid?: number; childPid?: number; sessionId?: string; startedAt?: string; finishedAt?: string;
  error?: string; report?: FrozenFile; exitCode?: number | null;
  log: string; prompt: string; reportPath: string;
}
export interface ReviewState {
  version: 1; root: string;
  defaults: Partial<ReviewConfig>;
  tasks: Record<string, { enabled: boolean; disabled?: boolean; config?: Partial<ReviewConfig>; current?: string }>;
  runs: ReviewRun[];
}
const FILE = '.task-graph/review.json';
export const REVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateConfig(config: Partial<ReviewConfig>): void {
  if (Object.keys(config).some(k => !['model', 'reasoning', 'mode', 'executable', 'timeoutMinutes'].includes(k))
    || (config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim()))
    || (config.reasoning !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(config.reasoning))
    || (config.mode !== undefined && !['snapshot', 'live'].includes(config.mode))
    || (config.executable !== undefined && (typeof config.executable !== 'string' || !path.isAbsolute(config.executable)))
    || (config.timeoutMinutes !== undefined && (!Number.isFinite(config.timeoutMinutes) || config.timeoutMinutes <= 0))) {
    throw new TaskGraphError('E_REVIEW_CONFIG', 'Invalid review configuration (model, reasoning, mode, absolute executable or positive timeout-minutes)');
  }
}
export function readReviewState(root: string): ReviewState {
  const canonical = realpathSync(root);
  if (!existsSync(path.join(root, FILE))) return { version: 1, root: canonical, defaults: {}, tasks: {}, runs: [] };
  try {
    const state = JSON.parse(readFileSync(path.join(root, FILE), 'utf8')) as ReviewState;
    if (state.version !== 1 || state.root !== canonical || !state.tasks || !Array.isArray(state.runs)) throw Error('Invalid shape or project location');
    validateConfig(state.defaults);
    for (const [id, item] of Object.entries(state.tasks)) {
      if (!/^T-\d{4,}$/.test(id) || typeof item.enabled !== 'boolean' || (item.current && !state.runs.some(r => r.id === item.current && r.task === id))) throw Error('Invalid task policy');
      validateConfig(item.config ?? {});
    }
    for (const run of state.runs) {
      if (!REVIEW_ID.test(run.id) || !REVIEW_ID.test(run.submission) || !/^T-\d{4,}$/.test(run.task)
        || !['queued', 'running', 'pass', 'reject', 'blocked', 'failed'].includes(run.state)
        || !Array.isArray(run.materials) || !Array.isArray(run.delivery?.files)) throw Error('Invalid run');
      validateConfig(run.config);
    }
    return state;
  } catch (e) { throw new TaskGraphError('E_REVIEW_STATE', 'Review state is invalid or belongs to another project location', [String(e)]); }
}
export function writeReviewState(tx: ProjectTransaction, state: ReviewState): void {
  tx.write(FILE, JSON.stringify(state, null, 2) + '\n');
  const file = path.join(state.root, '.task-graph/.gitignore');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing = ['/review.json', '/reviews/'].filter(line => !before.split(/\r?\n/).includes(line));
  if (missing.length) tx.write('.task-graph/.gitignore', before + (before && !before.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}
export function currentReview(state: ReviewState, task: string): ReviewRun | undefined {
  return state.runs.find(r => r.id === state.tasks[task]?.current && r.task === task);
}
export function reviewView(root: string, task: string) {
  const state = readReviewState(root), policy = state.tasks[task], run = currentReview(state, task);
  return { enabled: policy?.enabled ?? false, explicitly_disabled: policy?.disabled === true,
    config: { ...DEFAULT_REVIEW_CONFIG, ...state.defaults, ...policy?.config },
    current: run ? { id: run.id, submission: run.submission, state: run.state, trigger: run.trigger, config: run.config,
      created_at: run.createdAt, error: run.error, report: run.report, log: run.log, session_id: run.sessionId,
      delivery: { id: run.delivery.id, mode: run.delivery.mode, workspace: run.delivery.workspace, captured_at: run.delivery.capturedAt, head: run.delivery.head, file_count: run.delivery.files.length },
      materials: run.materials } : null };
}
