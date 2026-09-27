import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { failReview, processAlive, recoverReviews, updateRun } from './review.js';
import { currentReview, readReviewState, type ReviewRun } from './review-state.js';
import { verifyDelivery } from './review-delivery.js';
import { kickWatchWorker } from './watch.js';
import { runProjectTransaction } from './transaction.js';
import { writeFileAtomic } from './fsx.js';
import { buildProject } from './build.js';
import { historyEntry } from './task.js';
import { mutateTaskDocument } from './mutate.js';

interface Supervisor { pid: number; token: string; heartbeat: number; }
const SUPERVISOR = '.task-graph/reviews/supervisor.json';
function owner(root: string): Supervisor | undefined { try { return JSON.parse(readFileSync(path.join(root, SUPERVISOR), 'utf8')); } catch { return undefined; } }
function entry(): string { return fileURLToPath(new URL('../review-worker.js', import.meta.url)); }
/** Kick after committed mutations. A durable queued run is recoverable via any later mutation. */
export function kickReviewSupervisor(root: string): void {
  if (!readReviewState(root).runs.some(r => ['queued', 'running'].includes(r.state))) return;
  const current = owner(root);
  if (current && processAlive(current.pid) && Date.now() - current.heartbeat < 30000) return;
  const child = spawn(process.execPath, [entry(), root], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => { /* durable queue remains; review recover can re-kick */ }); child.unref();
}
/** All queued tasks launch independently; no project concurrency limit. */
export async function superviseReviews(root: string): Promise<void> {
  const token = randomUUID();
  const owned = runProjectTransaction(root, tx => {
    const current = owner(root);
    if (current && processAlive(current.pid) && Date.now() - current.heartbeat < 30000) return false;
    tx.write(SUPERVISOR, JSON.stringify({ pid: process.pid, token, heartbeat: Date.now() })); return true;
  });
  if (!owned) return;
  try {
    for (;;) {
      if (owner(root)?.token !== token) return;
      writeFileAtomic(path.join(root, SUPERVISOR), JSON.stringify({ pid: process.pid, token, heartbeat: Date.now() }));
      recoverReviews(root);
      const state = readReviewState(root);
      const active = state.runs.filter(r => currentReview(state, r.task)?.id === r.id && ['queued', 'running'].includes(r.state));
      for (const run of active.filter(r => r.state === 'queued' && !processAlive(r.workerPid))) {
        const child = spawn(process.execPath, [entry(), root, run.id], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.on('error', e => { try { failReview(root, run.task, run.id, `Could not start review worker: ${e.message}`); kickWatchWorker(root); } catch { /* recover via CLI */ } });
        if (child.pid) updateRun(root, run.id, r => { if (r.state === 'queued') r.workerPid = child.pid; });
        child.unref();
      }
      kickWatchWorker(root);
      if (!active.length) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    runProjectTransaction(root, tx => { if (owner(root)?.token === token) tx.delete(SUPERVISOR); });
    // Close the last-scan/exit race with a concurrent submit.
    kickReviewSupervisor(root);
  }
}
export function codexCommand(executable?: string): { command: string; prefix: string[] } {
  if (executable) {
    if (!existsSync(executable)) throw Error(`Codex executable does not exist: ${executable}`);
    if (/\.(c?js|mjs)$/i.test(executable)) return { command: process.execPath, prefix: [executable] };
    if (/\.(cmd|bat|ps1)$/i.test(executable)) throw Error('Configure the real codex.exe or codex.js, not a shell shim');
    return { command: executable, prefix: [] };
  }
  if (process.platform === 'win32') {
    const found = execFileSync('where.exe', ['codex'], { windowsHide: true }).toString().trim().split(/\r?\n/);
    for (const file of found) {
      if (/\.exe$/i.test(file)) return { command: file, prefix: [] };
      const js = path.join(path.dirname(file), 'node_modules/@openai/codex/bin/codex.js');
      if (existsSync(js)) {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
        const resolve = createRequire(js);
        let vendor = path.resolve(path.dirname(js), '../vendor');
        try { vendor = path.join(path.dirname(resolve.resolve(`@openai/codex-win32-${arch}/package.json`)), 'vendor'); } catch { /* older bundled layout */ }
        const binary = path.join(vendor, triple, 'bin/codex.exe');
        if (existsSync(binary)) return { command: binary, prefix: [] };
        throw Error('Cannot find native Codex binary; configure --executable explicitly');
      }
    }
    throw Error('Cannot locate a shell-free Codex entry. Configure --executable with codex.exe or codex.js');
  }
  return { command: 'codex', prefix: [] };
}
function timeoutWarning(root: string, run: ReviewRun): void {
  mutateTaskDocument(root, run.task, (task, tx) => {
    const state = readReviewState(root), current = currentReview(state, run.task);
    if (current?.id !== run.id || current.state !== 'running' || task.history.some(h => h.event === 'review_warning' && h.extra['review_id'] === run.id)) return task;
    return { ...task, history: [...task.history, historyEntry('review_warning', new Date().toISOString(), 'executor', { review_id: run.id, error: 'Review exceeded its configured time; process is still running. Inspect before intervention.' })] };
  });
  kickWatchWorker(root);
}
export async function executeReview(root: string, reviewId: string): Promise<void> {
  let run: ReviewRun | undefined;
  updateRun(root, reviewId, (candidate, state) => {
    if (candidate.state !== 'queued' || currentReview(state, candidate.task)?.id !== reviewId) return;
    candidate.state = 'running'; candidate.workerPid = process.pid; candidate.startedAt = new Date().toISOString(); run = { ...candidate };
  });
  if (!run) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    buildProject(root);
    verifyDelivery(run.delivery);
    const { command, prefix } = codexCommand(run.config.executable);
    const last = path.resolve(root, `.task-graph/reviews/${run.id}/last-message.txt`);
    const args = [...prefix, 'exec', '-C', run.delivery.workspace, '--skip-git-repo-check', '--json', '--color', 'never',
      '--model', run.config.model, '-c', `model_reasoning_effort=${JSON.stringify(run.config.reasoning)}`,
      '-c', 'approval_policy="never"', '--sandbox', 'workspace-write', '--add-dir', path.resolve(root, '.task-graph'),
      '--output-last-message', last, '-'];
    const env = { ...process.env }; delete env['CODEX_THREAD_ID']; delete env['CODEX_SESSION_ID'];
    const child = spawn(command, args, { cwd: run.delivery.workspace, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    updateRun(root, run.id, r => { r.childPid = child.pid; });
    const log = path.resolve(root, run.log), stderr = path.resolve(root, `.task-graph/reviews/${run.id}/stderr.log`);
    mkdirSync(path.dirname(log), { recursive: true });
    let logBytes = 0, pending = '', sessionSaved = false;
    const save = (file: string, data: Buffer) => { if (logBytes < 50 * 1024 * 1024) { appendFileSync(file, data); logBytes += data.length; } };
    child.stdout.on('data', (data: Buffer) => {
      save(log, data);
      if (sessionSaved) return;
      pending = (pending + data.toString('utf8')).slice(-1024 * 1024);
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) { try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          updateRun(root, run!.id, r => { r.sessionId = event.thread_id; }); sessionSaved = true;
        }
      } catch { /* non-JSON lines stay in the log */ } }
    });
    child.stderr.on('data', (data: Buffer) => save(stderr, data));
    child.stdin.on('error', () => { /* close/error determines whether a result was committed */ });
    timer = setTimeout(() => { try { timeoutWarning(root, run!); } catch { /* persistent state still visible */ } }, Math.min(run.config.timeoutMinutes * 60000, 2147483647));
    child.stdin.end(readFileSync(path.resolve(root, run.prompt)));
    const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    updateRun(root, run.id, r => { r.exitCode = code; r.childPid = undefined; r.workerPid = undefined; if (code !== 0 && ['pass', 'reject', 'blocked'].includes(r.state)) r.error = `Process exited ${code} after committing its result`; });
    failReview(root, run.task, run.id, `Review process exited (${code}) without review finish; inspect ${run.log}, then use task[${run.task}].review restart`);
  } catch (e) {
    failReview(root, run.task, run.id, String(e));
  } finally {
    if (timer) clearTimeout(timer);
    updateRun(root, run.id, r => { r.workerPid = undefined; });
    kickWatchWorker(root);
  }
}
