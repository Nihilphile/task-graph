import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { isTemporaryArtifact, listDirectorySorted, pathExists } from './fsx.js';
import { projectPaths } from './layout.js';

export interface LockOptions {
  /** A lock older than this is considered abandoned. */
  staleMs?: number;
  /** How long to wait for a busy lock before failing. */
  timeoutMs?: number;
  /** Delay between attempts. */
  retryMs?: number;
  /** Injectable millisecond clock. */
  now?: () => number;
  /** Skip sweeping abandoned temporary files when the lock is taken. */
  skipTempSweep?: boolean;
}

export interface ProjectLock {
  readonly path: string;
  /** True when the lock file was created by this acquisition. */
  readonly acquired: boolean;
  release(): void;
}

export const DEFAULT_STALE_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRY_MS = 20;
/** Abandoned scratch files older than this are removed when a lock is taken. */
export const DEFAULT_TEMP_MAX_AGE_MS = 5 * 60_000;

/**
 * Acquires a project-scoped lock using an atomic `mkdir`.
 *
 * The lock is short-lived: it is held only for the duration of one structured
 * command and released in a `finally` block. Abandoned locks are broken after
 * `staleMs` so a crashed Agent cannot block the project forever.
 */
export function acquireProjectLock(root: string, options: LockOptions = {}): ProjectLock {
  const lockDir = projectPaths(root).lockDir;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const now = options.now ?? Date.now;

  mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = now() + timeoutMs;

  for (;;) {
    if (tryCreate(lockDir, now)) {
      if (!options.skipTempSweep) sweepStaleTempFiles(root, DEFAULT_TEMP_MAX_AGE_MS, now);
      return {
        path: lockDir,
        acquired: true,
        release: () => {
          rmSync(lockDir, { recursive: true, force: true });
        },
      };
    }
    if (isStale(lockDir, staleMs, now())) {
      rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (now() >= deadline) {
      throw new TaskGraphError('E_LOCK_TIMEOUT', `Timed out waiting for the project lock`, [
        `Lock: ${lockDir}`,
        'Another structured Task Graph command is still running. Retry once it finishes.',
      ]);
    }
    sleep(retryMs);
  }
}

function tryCreate(lockDir: string, now: () => number): boolean {
  try {
    mkdirSync(lockDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(
      path.join(lockDir, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, acquired_at: new Date(now()).toISOString() }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    rmSync(lockDir, { recursive: true, force: true });
    throw error;
  }
  return true;
}

function isStale(lockDir: string, staleMs: number, currentTime: number): boolean {
  try {
    const stats = statSync(lockDir);
    return currentTime - stats.mtimeMs > staleMs;
  } catch {
    // The lock disappeared between attempts; retry immediately.
    return true;
  }
}

/** Synchronous sleep so the critical section never yields to another task. */
export function sleep(ms: number): void {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

/**
 * Removes abandoned `.<name>.tmp-*` scratch files from the source directories.
 *
 * Temporary files are never source data; removing old ones keeps a crashed
 * write from confusing humans or tooling.
 */
export function sweepStaleTempFiles(
  root: string,
  maxAgeMs = DEFAULT_TEMP_MAX_AGE_MS,
  now: () => number = Date.now,
): string[] {
  const paths = projectPaths(root);
  const removed: string[] = [];
  for (const dir of [paths.taskGraphDir, paths.tasksDir]) {
    for (const name of listDirectorySorted(dir)) {
      if (!isTemporaryArtifact(name)) continue;
      const full = path.join(dir, name);
      try {
        if (now() - statSync(full).mtimeMs <= maxAgeMs) continue;
        rmSync(full, { force: true });
        removed.push(full);
      } catch {
        // A concurrent writer may have renamed or removed it already.
      }
    }
  }
  return removed;
}

export function lockExists(root: string): boolean {
  return pathExists(projectPaths(root).lockDir);
}
