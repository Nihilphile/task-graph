import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { writeFileAtomic } from './fsx.js';
import { acquireProjectLock, type LockOptions } from './lock.js';

export type TransactionContent = string | Uint8Array;

interface Snapshot {
  readonly file: string;
  /** `undefined` when the file did not exist before the transaction. */
  readonly original: Buffer | undefined;
}

export interface CommitHooks {
  /** Runs before anything is written; throw to abort without touching disk. */
  validateBefore?: () => void;
  /** Runs after every write and before the transaction is accepted. */
  validate?: () => void;
}

/**
 * Collects the file changes of one structured command.
 *
 * Nothing is written until `commit()`; writes then go through temporary files
 * and atomic replacement, and any failure restores the exact pre-command bytes.
 */
export class ProjectTransaction {
  readonly root: string;
  private readonly writes = new Map<string, TransactionContent>();
  private readonly deletions = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  /** Stages a file write. `target` may be project-relative or absolute. */
  write(target: string, content: TransactionContent): void {
    const file = this.resolve(target);
    this.deletions.delete(file);
    this.writes.set(file, content);
  }

  /** Stages a file removal. */
  delete(target: string): void {
    const file = this.resolve(target);
    this.writes.delete(file);
    this.deletions.add(file);
  }

  /** Absolute paths this transaction will touch, sorted. */
  get touchedPaths(): string[] {
    return [...new Set([...this.writes.keys(), ...this.deletions.keys()])].sort();
  }

  /** True when nothing was staged. */
  get isEmpty(): boolean {
    return this.writes.size === 0 && this.deletions.size === 0;
  }

  /**
   * Applies the staged changes, validating before writing and again before the
   * transaction is accepted. Any failure restores every touched file.
   */
  commit(hooks: CommitHooks = {}): void {
    hooks.validateBefore?.();
    const snapshots = this.touchedPaths.map((file) => this.snapshot(file));
    try {
      for (const [file, content] of this.writes) writeFileAtomic(file, content);
      for (const file of this.deletions) rmSync(file, { force: true });
    } catch (error) {
      this.restore(snapshots);
      throw error;
    }
    try {
      hooks.validate?.();
    } catch (error) {
      this.restore(snapshots);
      throw error;
    }
  }

  private snapshot(file: string): Snapshot {
    try {
      return { file, original: readFileSync(file) };
    } catch {
      return { file, original: undefined };
    }
  }

  private restore(snapshots: readonly Snapshot[]): void {
    for (const snapshot of snapshots) {
      try {
        if (snapshot.original === undefined) rmSync(snapshot.file, { force: true });
        else writeFileAtomic(snapshot.file, snapshot.original);
      } catch {
        // Restoration is best-effort per file; the first failure is already
        // being reported and remaining files still get restored.
      }
    }
  }

  private resolve(target: string): string {
    const absolute = path.isAbsolute(target) ? path.normalize(target) : path.resolve(this.root, target);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new TaskGraphError('E_PATH', `Refusing to modify a path outside the project`, [
        `Project root: ${this.root}`,
        `Requested: ${target}`,
      ]);
    }
    return absolute;
  }
}

export interface RunTransactionOptions extends CommitHooks {
  lock?: LockOptions;
  /** Skip acquiring the project lock (tests only). */
  skipLock?: boolean;
}

/**
 * Runs one structured mutation under the project lock.
 *
 * The body executes while the lock is held, so reading the repository to
 * allocate an ID and staging the write happen atomically with respect to other
 * Agents.
 */
export function runProjectTransaction<T>(
  root: string,
  body: (transaction: ProjectTransaction) => T,
  options: RunTransactionOptions = {},
): T {
  const lock = options.skipLock ? undefined : acquireProjectLock(root, options.lock);
  try {
    const transaction = new ProjectTransaction(root);
    const result = body(transaction);
    transaction.commit({ validateBefore: options.validateBefore, validate: options.validate });
    return result;
  } finally {
    lock?.release();
  }
}

/** Reads a file as raw bytes, or `undefined` when it does not exist. */
export function readSnapshot(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch {
    return undefined;
  }
}
