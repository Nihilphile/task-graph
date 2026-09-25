import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { closeSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths, type ProjectPaths } from '../../src/core/layout.js';

/** Absolute path of the `task-graph` skill directory. */
export const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export const CLI_ENTRY = path.join(SKILL_ROOT, 'dist', 'src', 'cli.js');

export interface TempWorkspace {
  /** Absolute root of the isolated workspace. */
  readonly root: string;
  readonly paths: ProjectPaths;
  file(relative: string): string;
  write(relative: string, content: string): string;
  writeBuffer(relative: string, content: Uint8Array): string;
  read(relative: string): string;
  readBuffer(relative: string): Buffer;
  exists(relative: string): boolean;
  mkdir(relative: string): string;
  /** Sorted POSIX-style relative paths of every file below the root. */
  listFiles(): string[];
  cleanup(): void;
}

interface AfterCapable {
  after(fn: () => void): void;
}

/**
 * Creates an isolated workspace under the OS temp directory.
 *
 * Every mutating test must use one of these; the real repository task data is
 * never touched. `name` may contain spaces or non-ASCII characters so that
 * Windows and UTF-8 handling is exercised as well.
 */
export function createTempWorkspace(name = 'task-graph-test'): TempWorkspace {
  const root = mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  return wrapWorkspace(root);
}

/** Creates an isolated workspace and registers cleanup with a test context. */
export function useTempWorkspace(t: AfterCapable, name?: string): TempWorkspace {
  const workspace = createTempWorkspace(name);
  t.after(() => workspace.cleanup());
  return workspace;
}

function wrapWorkspace(root: string): TempWorkspace {
  const paths = projectPaths(root);
  const resolve = (relative: string): string => path.resolve(root, relative);

  return {
    root,
    paths,
    file: resolve,
    write(relative, content) {
      const target = resolve(relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
      return target;
    },
    writeBuffer(relative, content) {
      const target = resolve(relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
      return target;
    },
    read(relative) {
      return readFileSync(resolve(relative), 'utf8');
    },
    readBuffer(relative) {
      return readFileSync(resolve(relative));
    },
    exists(relative) {
      return existsSync(resolve(relative));
    },
    mkdir(relative) {
      const target = resolve(relative);
      mkdirSync(target, { recursive: true });
      return target;
    },
    listFiles() {
      const out: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir).sort()) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else out.push(path.relative(root, full).split(path.sep).join('/'));
        }
      };
      walk(root);
      return out.sort();
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the compiled CLI in a child process so exit codes and stream routing are
 * verified exactly as a user or Agent would experience them.
 *
 * Child output is captured through temporary files rather than pipes: piped
 * stdio is unavailable in confined Windows sandboxes, and file descriptors keep
 * the harness portable without weakening the assertion.
 */
export function runCliProcess(
  argv: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): CliResult {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'task-graph-cli-'));
  const stdoutFile = path.join(scratch, 'stdout.txt');
  const stderrFile = path.join(scratch, 'stderr.txt');
  const stdoutFd = openSync(stdoutFile, 'w');
  const stderrFd = openSync(stderrFile, 'w');
  try {
    const result = spawnSync(process.execPath, [CLI_ENTRY, ...argv], {
      cwd: options.cwd ?? SKILL_ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    return {
      code: result.status ?? -1,
      stdout: readFileSync(stdoutFile, 'utf8'),
      stderr: readFileSync(stderrFile, 'utf8'),
    };
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

/**
 * Asynchronously runs `node <args>` and captures output through files so that
 * several processes can run concurrently in the confined sandbox.
 */
export function runNodeAsync(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'task-graph-node-'));
  const stdoutFile = path.join(scratch, 'stdout.txt');
  const stderrFile = path.join(scratch, 'stderr.txt');
  const stdoutFd = openSync(stdoutFile, 'w');
  const stderrFd = openSync(stderrFile, 'w');

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: options.cwd ?? SKILL_ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    const finish = (code: number): void => {
      try {
        closeSync(stdoutFd);
        closeSync(stderrFd);
        resolve({
          code,
          stdout: readFileSync(stdoutFile, 'utf8'),
          stderr: readFileSync(stderrFile, 'utf8'),
        });
      } catch (error) {
        reject(error);
      } finally {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    };
    child.on('error', (error) => {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      reject(error);
    });
    child.on('close', (code) => finish(code ?? -1));
  });
}
