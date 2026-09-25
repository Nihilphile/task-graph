import { execFileSync } from 'node:child_process';
import { TaskGraphError } from './errors.js';

export interface GitHubClient {
  request(method: string, endpoint: string, body?: Record<string, unknown>): unknown;
}

function gh(root: string, args: string[], input?: string): unknown {
  try {
    const output = execFileSync('gh', args, {
      cwd: root, input, encoding: 'utf8', windowsHide: true,
      timeout: 20_000, maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const failure = error as { stderr?: Buffer | string; code?: string };
    // Never echo command arguments or request bodies in diagnostics.
    const detail = failure.stderr?.toString().trim().slice(0, 1200) || failure.code || 'GitHub request failed or timed out';
    throw new TaskGraphError('E_GITHUB_API', detail);
  }
}

export function githubClient(root: string): GitHubClient {
  return { request(method, endpoint, body) {
    return gh(root, ['api', '--hostname', 'github.com', '--method', method, endpoint,
      '-H', 'Accept: application/vnd.github+json', ...(body === undefined ? [] : ['--input', '-'])],
    body === undefined ? undefined : JSON.stringify(body));
  } };
}

export function resolveGitHubRepo(root: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(explicit) || ['.', '..'].includes(explicit.split('/')[1]!)) throw new TaskGraphError('E_GITHUB_REPO', 'Pass --repo owner/repo');
    return explicit;
  }
  const result = gh(root, ['repo', 'view', '--json', 'nameWithOwner,url']) as { nameWithOwner?: string; url?: string };
  if (!result.nameWithOwner || !result.url?.startsWith('https://github.com/')) {
    throw new TaskGraphError('E_GITHUB_REPO', 'Cannot resolve a github.com repository; pass --repo owner/repo');
  }
  return resolveGitHubRepo(root, result.nameWithOwner);
}
