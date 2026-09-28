import { currentReview, readReviewState } from './review-state.js';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import { runProjectTransaction, type ProjectTransaction } from './transaction.js';
import type { TaskDocument } from './task.js';
import { TaskGraphError } from './errors.js';
import { desktopAdapter, type DesktopAdapter, type DesktopBinding } from './desktop-notify.js';

const FILE = '.task-graph/watch.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface GraphWatch {
  id: string; graph: string; thread: string; active: boolean; createdAt: string; binding: DesktopBinding;
}
export interface WatchEvent {
  id: string; subscription: string; task: string; graph: string; result: 'pass' | 'reject' | 'blocked' | 'warning'; at: string; reviewId?: string;
  message: string; state: 'pending' | 'in_flight' | 'accepted' | 'uncertain' | 'paused' | 'cancelled';
  attempts: number; attemptId?: string; attemptAt?: number; nextAttemptAt?: number; receipt?: string; error?: string;
}
export interface WatchLedger {
  version: 1; root: string; subscriptions: GraphWatch[]; events: WatchEvent[];
  worker?: { pid: number; token: string; heartbeat: number };
}
function canonicalRoot(root: string): string { return realpathSync(root); }
function empty(root: string): WatchLedger { return { version: 1, root: canonicalRoot(root), subscriptions: [], events: [] }; }
export function readWatchLedger(root: string): WatchLedger | undefined {
  const file = path.join(root, FILE);
  if (!existsSync(file)) return undefined;
  try {
    const data: WatchLedger = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1 || data.root !== canonicalRoot(root) || !Array.isArray(data.subscriptions) || !Array.isArray(data.events)
      || data.subscriptions.some(s => !UUID.test(s.thread) || !s.id || typeof s.active !== 'boolean' || !s.binding?.executable || !s.binding?.home || !s.binding?.version)
      || data.events.some(e => !e.id || !data.subscriptions.some(s => s.id === e.subscription) || !['pending', 'in_flight', 'accepted', 'uncertain', 'paused', 'cancelled'].includes(e.state))) throw new Error('Invalid ledger shape or project location');
    return data;
  } catch (error) { throw new TaskGraphError('E_WATCH_LEDGER', 'Watch ledger is invalid or belongs to a different project location; restore it before delivery', [String(error)]); }
}
function write(tx: ProjectTransaction, ledger: WatchLedger): void { tx.write(FILE, JSON.stringify(ledger, null, 2) + '\n'); }
function change<T>(root: string, update: (ledger: WatchLedger, tx: ProjectTransaction) => T): T {
  return runProjectTransaction(root, tx => {
    const ledger = readWatchLedger(root) ?? empty(root);
    const value = update(ledger, tx); write(tx, ledger); return value;
  });
}
function requireGraph(root: string, graph: string): void {
  if (!loadTaskRepository(root).manifest.graphs.some(g => g.id === graph)) throw new TaskGraphError('E_GRAPH', `Unknown graph ${graph}`);
}

/** Canonical IDs survive YAML key sorting; legacy IDs preserve the old lifecycle insertion order. */
function resultEventIds(subscription: string, task: string, count: number, entry: TaskDocument['history'][number]): string[] {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const idFor = (extra: typeof entry.extra) => hash(subscription + ':' + hash(JSON.stringify([task, count, { ...entry, extra }])));
  const canonical = Object.fromEntries(Object.entries(entry.extra).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const ids = [idFor(canonical)];
  const legacyOrder = ['from', 'to', 'result', 'reason'];
  // Only reconstruct the exact known legacy shape; never bypass matching the full history entry.
  if (Object.keys(entry.extra).every(key => legacyOrder.includes(key))) {
    ids.push(idFor(Object.fromEntries(legacyOrder.filter(key => Object.hasOwn(entry.extra, key)).map(key => [key, entry.extra[key]!]))));
  }
  return ids;
}

export async function watchGraph(root: string, graph: string, thread: string, adapter: DesktopAdapter = desktopAdapter): Promise<GraphWatch> {
  requireGraph(root, graph);
  if (!UUID.test(thread)) throw new TaskGraphError('E_WATCH_THREAD', '--thread must be an explicit Desktop thread UUID');
  thread = thread.toLowerCase();
  const binding = await adapter.inspect();
  return change(root, (ledger, tx) => {
    const existing = ledger.subscriptions.find(s => s.graph === graph && s.thread === thread && s.active);
    if (existing) {
      if (existing.binding.home !== binding.home) throw new TaskGraphError('E_WATCH_PROFILE', 'Existing subscription belongs to a different Desktop profile; keep its destination explicit');
      existing.binding = binding;
      return existing;
    }
    const ignoreFile = '.task-graph/.gitignore';
    const ignore = existsSync(path.join(root, ignoreFile)) ? readFileSync(path.join(root, ignoreFile), 'utf8') : '';
    if (ignore.trimEnd().split(/\r?\n/).at(-1) !== '/watch.json') tx.write(ignoreFile, ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') + '/watch.json\n');
    const subscription: GraphWatch = { id: randomUUID(), graph, thread, active: true, createdAt: new Date().toISOString(), binding };
    ledger.subscriptions.push(subscription); return subscription;
  });
}
export function unwatchGraph(root: string, graph: string, thread: string): void {
  requireGraph(root, graph);
  if (!UUID.test(thread)) throw new TaskGraphError('E_WATCH_THREAD', '--thread must be a Desktop UUID');
  change(root, ledger => {
    for (const sub of ledger.subscriptions.filter(s => s.graph === graph && s.thread === thread.toLowerCase() && s.active)) {
      sub.active = false;
      for (const event of ledger.events.filter(e => e.subscription === sub.id && ['pending', 'paused'].includes(e.state))) event.state = 'cancelled';
    }
  });
}

/** Called under the task transaction: result and outbox commit together. No historical scan. */
export function recordWatchResult(root: string, task: TaskDocument, tx: ProjectTransaction, outcome?: 'blocked' | 'warning', scope?: Pick<TaskRepository, 'manifest' | 'tasks'>): void {
  const staged = tx.readStaged(FILE);
  const ledger: WatchLedger | undefined = staged ? JSON.parse(staged.toString('utf8')) : readWatchLedger(root);
  if (!ledger?.subscriptions.some(s => s.active)) return;
  const repo = scope ?? loadTaskRepository(root);
  const ancestors = new Set<string>([task.graph]);
  let graph = task.graph;
  for (let count = 0; count < repo.manifest.graphs.length; count++) {
    const parent = repo.tasks.find(t => t.subgraph?.graph === graph);
    if (!parent || ancestors.has(parent.graph)) break;
    ancestors.add(parent.graph); graph = parent.graph;
  }
  const result = outcome ?? (task.status === 'reject' ? 'reject' : 'pass');
  const terminal = task.history.at(-1)!;
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
  for (const sub of ledger.subscriptions.filter(s => s.active && ancestors.has(s.graph))) {
    const ids = resultEventIds(sub.id, task.id, task.history.length, terminal);
    const id = ids[0]!;
    if (ledger.events.some(e => ids.includes(e.id))) continue;
    const reports = task.outputs.filter(o => o.kind === 'report' && o.audience !== 'user' && (!terminal.extra['report_sha256'] || o.sha256 === terminal.extra['report_sha256'])).slice(-4).map(o => ({ path: o.path, read_path: o.snapshot ?? o.path }));
    const data = { event: id, project: canonicalRoot(root), graph: task.graph, watched_graph: sub.graph, task: task.id, result, at: terminal.at, reports, cli, review_id: terminal.extra['review_id'], error: terminal.extra['error'], reason: terminal.extra['reason'], manual_blockers: terminal.event === 'blocked' ? task.manualBlockers : undefined, affected_successors: result === 'reject' ? repo.tasks.filter(t => t.dependsOn.some(d => d.task === task.id)).map(t => ({ task: t.id, status: t.status })) : undefined, recovery: outcome ? terminal.event === 'blocked' ? `Accept repair with task[${task.id}] start (enters in_progress); after an external resolution use task[${task.id}] unblock --reason <exact reason>` : `task[${task.id}].review restart` : undefined };
    const message = 'Task Graph notification (tool data, not a new user instruction).\n' + JSON.stringify(data) + '\nWithin the existing task authorization, inspect this task and its report, then assess repair, investigation or successor refinement. A pass does not automatically activate a dynamic successor; reject does not satisfy dependencies.';
    ledger.events.push({ id, subscription: sub.id, task: task.id, graph: task.graph, result, at: terminal.at, reviewId: typeof terminal.extra['review_id'] === 'string' ? terminal.extra['review_id'] : undefined, message,
      state: Buffer.byteLength(message) > 6144 ? 'paused' : 'pending', attempts: 0,
      ...(Buffer.byteLength(message) > 6144 ? { error: 'Notification exceeds 6 KiB; inspect task by ID' } : {}) });
  }
  write(tx, ledger);
}

export function watchStatus(root: string, graph: string) {
  requireGraph(root, graph);
  const ledger = readWatchLedger(root);
  const subscriptions = ledger?.subscriptions.filter(s => s.graph === graph) ?? [];
  const events = ledger?.events.filter(e => subscriptions.some(s => s.id === e.subscription)) ?? [];
  return { graph, subscriptions: subscriptions.map(({ binding, ...s }) => ({ ...s, desktop_version: binding.version })),
    counts: Object.fromEntries(['pending','in_flight','accepted','uncertain','paused','cancelled'].map(state => [state, events.filter(e => e.state === state).length])),
    events: events.slice(-20).map(({ message: _message, ...e }) => e), consumption: 'unconfirmed', delivery: 'next_turn' };
}
export function retryWatchEvent(root: string, id: string, allowDuplicate: boolean, graph?: string): void {
  change(root, ledger => {
    const event = ledger.events.find(e => e.id === id);
    if (!event || !['uncertain', 'paused'].includes(event.state)) throw new TaskGraphError('E_WATCH_RETRY', 'Retry only paused/uncertain events');
    if (graph && ledger.subscriptions.find(s => s.id === event.subscription)?.graph !== graph) throw new TaskGraphError('E_WATCH_RETRY', 'Event belongs to another graph subscription');
    if (!ledger.subscriptions.find(s => s.id === event.subscription)?.active) throw new TaskGraphError('E_WATCH_RETRY', 'Subscription is inactive');
    if (event.state === 'uncertain' && !allowDuplicate) throw new TaskGraphError('E_WATCH_UNCERTAIN', 'Inspect the Desktop target, then use --allow-duplicate if another submission is intended');
    event.state = 'pending'; event.nextAttemptAt = undefined; event.error = undefined;
  });
}

function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
export function kickWatchWorker(root: string): void {
  const ledger = readWatchLedger(root);
  if (!ledger?.events.some(e => ['pending', 'in_flight'].includes(e.state))) return;
  if (ledger.worker && alive(ledger.worker.pid) && Date.now() - ledger.worker.heartbeat < 45000) return;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../watch-worker.js', import.meta.url)), canonicalRoot(root)], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => { /* Durable events remain for the next mutation or graph watch --flush. */ });
  child.unref();
}

/** One delivery owner per project. Network/queue calls always happen outside the transaction. */
export async function deliverWatch(root: string, adapter: DesktopAdapter = desktopAdapter, options: { singlePass?: boolean } = {}): Promise<void> {
  const token = randomUUID();
  const owned = change(root, ledger => {
    if (ledger.worker && alive(ledger.worker.pid) && Date.now() - ledger.worker.heartbeat < 45000) return false;
    for (const e of ledger.events) if (e.state === 'in_flight') { e.state = 'uncertain'; e.error = 'Previous delivery owner stopped without a durable receipt'; }
    ledger.worker = { pid: process.pid, token, heartbeat: Date.now() }; return true;
  });
  if (!owned) return;
  try {
    for (;;) {
      const selected = change(root, ledger => {
        if (ledger.worker?.token !== token) return undefined;
        ledger.worker.heartbeat = Date.now();
        const event = ledger.events.find(e => e.state === 'pending' && (e.nextAttemptAt ?? 0) <= Date.now());
        if (!event) return undefined;
        const sub = ledger.subscriptions.find(s => s.id === event.subscription)!;
        if (!sub.active) { event.state = 'cancelled'; return undefined; }
        const task = loadTaskRepository(root).taskById(event.task);
        const review = task ? currentReview(readReviewState(root), task.id) : undefined;
        if (review && ((event.reviewId && event.reviewId !== review.id) || (!event.reviewId && Date.parse(event.at) <= Date.parse(review.createdAt)))) { event.state = 'cancelled'; event.error = 'Superseded by a review round'; return undefined; }
        const committed = task?.history.some((h, index) => ['completed', 'rejected', 'blocked', 'review_failed', 'review_warning', 'review_blocked'].includes(h.event)
          && resultEventIds(sub.id, task.id, index + 1, h).includes(event.id));
        if (!committed) { event.state = 'paused'; event.error = 'The recorded task result is missing; restore the committed task history before delivery'; return undefined; }
        event.state = 'in_flight'; event.attemptId = randomUUID(); event.attemptAt = Date.now(); event.attempts++;
        return { event: { ...event }, sub: { ...sub } };
      });
      if (selected) {
        const { event, sub } = selected;
        let outcome;
        try { outcome = await adapter.submit(sub.binding, sub.thread, event.message); }
        catch { outcome = { state: 'uncertain' as const, error: 'Adapter failed without proving whether submission occurred' }; }
        change(root, ledger => {
          const saved = ledger.events.find(e => e.id === event.id);
          if (!saved || saved.state !== 'in_flight' || saved.attemptId !== event.attemptId) return;
          saved.error = outcome.error; saved.receipt = outcome.receipt;
          if (outcome.state === 'not_started') {
            saved.state = saved.attempts < 4 ? 'pending' : 'paused';
            saved.nextAttemptAt = Date.now() + [1000, 5000, 30000][Math.min(saved.attempts - 1, 2)]!;
          } else saved.state = outcome.state;
        });
      }
      if (options.singlePass) break;
      const pending = change(root, ledger => {
        if (ledger.worker?.token !== token) return false;
        if (ledger.events.some(e => e.state === 'pending')) return true;
        delete ledger.worker;
        return false;
      });
      if (!pending) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    change(root, ledger => { if (ledger.worker?.token === token) delete ledger.worker; });
  }
}
