import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, lstatSync, statSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readDocument, documentPath } from './documents.js';
import { TaskGraphError } from './errors.js';
import type { Delivery } from './review-state.js';

export const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function sourceFiles(root: string): { paths: string[]; head?: string } {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const topStat = statSync(top), rootStat = statSync(root);
    if (topStat.dev !== rootStat.dev || topStat.ino !== rootStat.ino) throw new TaskGraphError('E_REVIEW_ROOT', 'Use the Git repository root as the project root for a versioned review');
    const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
    let head: string | undefined;
    try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* unborn repository */ }
    return { paths: [...new Set(paths)].filter(p => p !== '.task-graph' && !p.startsWith('.task-graph/')).sort(), head };
  } catch (e) {
    if (e instanceof TaskGraphError) throw e;
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const item of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (['.task-graph', '.git', 'node_modules', 'Library', 'Temp', 'Logs', 'obj'].includes(item.name)) continue;
        const file = path.posix.join(dir, item.name);
        if (item.isDirectory()) walk(file); else paths.push(file);
      }
    };
    walk(''); return { paths: paths.sort() };
  }
}
function entries(root: string): { path: string; sha256: string; mode: number }[] {
  return sourceFiles(root).paths.flatMap(p => {
    const file = documentPath(p);
    let stat;
    try { stat = lstatSync(path.join(root, file)); } catch { return []; } // tracked deletion
    if (stat.isSymbolicLink() || !stat.isFile()) throw new TaskGraphError('E_REVIEW_DELIVERY', `Cannot freeze symlink/submodule or non-file: ${file}`);
    return [{ path: file, sha256: digest(readDocument(root, file)), mode: stat.mode & 0o777 }];
  });
}
/** Copy actual working bytes, including dirty/untracked files. Long I/O is outside the project lock. */
export function captureDelivery(root: string, mode: Delivery['mode']): Delivery {
  const id = randomUUID(), source = sourceFiles(root), files = entries(root);
  const workspace = mode === 'live' ? realpathSync(root) : path.resolve(root, '.task-graph/reviews', id, 'workspace');
  if (mode === 'snapshot') {
    mkdirSync(workspace, { recursive: true });
    for (const file of files) {
      const bytes = readDocument(root, file.path);
      if (digest(bytes) !== file.sha256) throw new TaskGraphError('E_REVIEW_CHANGED', 'Delivery changed while capturing; submit again');
      const target = path.join(workspace, file.path);
      mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes);
      chmodSync(target, file.mode);
    }
    // A nested plain directory would let git-aware checks discover the live parent repository.
    // Use an independent repository containing only this captured working tree, with no remotes/hooks.
    const git = (args: string[]) => execFileSync('git', args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '--quiet']);
    git(['config', 'core.autocrlf', 'false']);
    git(['-c', 'core.hooksPath=.git/no-hooks', 'add', '--all', '--force']);
    git(['-c', 'core.hooksPath=.git/no-hooks', '-c', 'user.name=Task Graph Review', '-c', 'user.email=review@task-graph.local', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '--allow-empty', '-m', `Frozen review delivery ${id}`]);
  }
  if (JSON.stringify(files) !== JSON.stringify(entries(root))) throw new TaskGraphError('E_REVIEW_CHANGED', 'Delivery changed while capturing; submit again');
  return { id, mode, sourceRoot: realpathSync(root), workspace, head: source.head, files, capturedAt: new Date().toISOString() };
}
export function verifyDelivery(delivery: Delivery): void {
  for (const item of delivery.files) {
    if (digest(readDocument(delivery.workspace, item.path)) !== item.sha256) throw new TaskGraphError('E_REVIEW_CHANGED', `Reviewed source changed: ${item.path}; report blocked`);
    if (item.mode !== undefined && (lstatSync(path.join(delivery.workspace, item.path)).mode & 0o777) !== item.mode) throw new TaskGraphError('E_REVIEW_CHANGED', `Reviewed source permissions changed: ${item.path}; report blocked`);
  }
  const recorded = delivery.files.map(f => [f.path, f.sha256]);
  if (delivery.mode === 'live' && JSON.stringify(recorded) !== JSON.stringify(entries(delivery.sourceRoot).map(f => [f.path, f.sha256]))) {
    throw new TaskGraphError('E_REVIEW_CHANGED', 'Live environment source files changed; report blocked and coordinate the environment');
  }
}
