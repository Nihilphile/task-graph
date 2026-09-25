import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TaskGraphError } from './errors.js';

export const GITHUB_STATE_FILE = '.task-graph/github-sync.json';
export interface GitHubIssue {
  repo: string;
  number: number;
  id: number;
  url: string;
  ownedDependencies: number[];
  comments: Record<string, number>;
}
export interface GitHubComment { issueKey: string; body: string }
export interface GitHubState {
  version: 1;
  projectId: string;
  status: 'synced' | 'pending';
  lastAttempt?: string;
  lastSuccess?: string;
  fingerprint?: string;
  error?: string;
  issues: Record<string, GitHubIssue>;
  outbox: Record<string, GitHubComment>;
}
export interface GitHubView {
  status: 'synced' | 'pending';
  repo?: string;
  url?: string;
  number?: number;
  error?: string;
  pendingComments: number;
  lastSuccess?: string;
}
export function readGitHubState(root: string): GitHubState | undefined {
  let text: string;
  try { text = readFileSync(path.join(root, GITHUB_STATE_FILE), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const value = JSON.parse(text) as GitHubState;
    if (value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.projectId) || !value.issues || !value.outbox || !['pending', 'synced'].includes(value.status)) throw new Error('Invalid shape');
    for (const item of Object.values(value.issues)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(item.repo) || ['.', '..'].includes(item.repo.split('/')[1]!) || !Number.isSafeInteger(item.number) || item.number < 1 || !Number.isSafeInteger(item.id) || item.id < 1 ||
        item.url !== `https://github.com/${item.repo}/issues/${item.number}` || !Array.isArray(item.ownedDependencies) || !item.comments) throw new Error('Invalid issue mapping');
      if (!item.ownedDependencies.every(id => Number.isSafeInteger(id) && id > 0) || !Object.values(item.comments).every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid sync history');
    }
    for (const item of Object.values(value.outbox)) if (typeof item.issueKey !== 'string' || typeof item.body !== 'string') throw new Error('Invalid queued comment');
    return value;
  } catch { throw new TaskGraphError('E_GITHUB_STATE', 'GitHub sync state is unreadable; restore .task-graph/github-sync.json before publishing. It was not reset.'); }
}
export function githubView(state: GitHubState | undefined, key?: string, repo?: string): GitHubView {
  const issue = key ? state?.issues[key] : undefined;
  return { status: state?.status ?? 'pending', ...(issue ? { repo: issue.repo, url: issue.url, number: issue.number } : repo ? { repo } : {}),
    ...(state?.error ? { error: state.error } : {}), ...(state?.lastSuccess ? { lastSuccess: state.lastSuccess } : {}), pendingComments: Object.keys(state?.outbox ?? {}).length };
}
