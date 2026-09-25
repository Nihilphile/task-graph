import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { githubClient, type GitHubClient } from './github-client.js';
import { GITHUB_STATE_FILE, githubView, readGitHubState, type GitHubState, type GitHubView } from './github-state.js';
import { planGitHub, type GitHubPlan, type GitHubEntity } from './github-plan.js';
import { writeFileAtomic } from './fsx.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';

interface RemoteIssue { id: number; number: number; html_url: string; title: string; body: string | null; state: string; state_reason?: string; pull_request?: unknown }
interface RemoteComment { id: number; body: string }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Serializes network writers separately: local task transactions never wait for network. */
function syncLock(root: string): (() => void) | undefined {
  const file = path.join(root, '.task-graph/github-sync.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { closeSync(fd); }
      return () => { try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) rmSync(file); } catch { /* already released */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid: number; token: string };
      try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return undefined;
      try { process.kill(owner.pid, 0); return undefined; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return undefined; }
      // A dead owner cannot replace this lock; other contenders still use exclusive creation.
      try { if (readFileSync(file, 'utf8') === JSON.stringify(owner)) rmSync(file); } catch { return undefined; }
    }
  }
  return undefined;
}

export function synchronizeGitHub(root: string, client: GitHubClient = githubClient(root)): GitHubView {
  let release: (() => void) | undefined;
  let state: GitHubState | undefined;
  const save = (): void => writeFileAtomic(path.join(root, GITHUB_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  try {
    release = runProjectTransaction(root, () => syncLock(root));
    if (!release) return { ...githubView(readGitHubState(root)), status: 'pending', error: 'Another GitHub sync is running. Retry github sync after it finishes.' };
    state = readGitHubState(root) ?? { version: 1, projectId: randomUUID(), status: 'pending', issues: {}, outbox: {} };
    const snapshot = (): GitHubPlan => runProjectTransaction(root, () => {
      assertRepositoryValid(root);
      return planGitHub(root);
    });
    const plan = snapshot();
    state.status = 'pending'; state.lastAttempt = new Date().toISOString(); delete state.error;
    for (const item of plan.comments) {
      if (!state.issues[item.issueKey]?.comments[item.key]) state.outbox[item.key] = { issueKey: item.issueKey, body: item.body };
    }
    save(); // Persist identities and comment payloads before the first remote write.
    const marker = (kind: string, key: string): string => `<!-- task-graph:${state!.projectId}:${kind}:${key} -->`;
    const list = <T>(endpoint: string): T[] => {
      const result: T[] = [];
      for (let page = 1; ; page++) {
        const batch = client.request('GET', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`) as T[];
        if (!Array.isArray(batch)) throw new Error(`Unexpected GitHub list response: ${endpoint}`);
        result.push(...batch);
        if (batch.length < 100) return result;
      }
    };
    const remote = new Map<string, RemoteIssue>();
    const issueLists = new Map<string, RemoteIssue[]>();
    const endpoint = (key: string): string => { const issue = state!.issues[key]; if (!issue) throw new Error(`Unpublished dependency or parent: ${key}`); return `repos/${issue.repo}/issues/${issue.number}`; };
    for (const entity of plan.entities) {
      let mapping = state.issues[entity.key];
      if (mapping && mapping.repo !== entity.repo) throw new Error(`Repository binding changed for ${entity.key}; restore its original repository.`);
      let issue: RemoteIssue;
      if (mapping) issue = client.request('GET', endpoint(entity.key)) as RemoteIssue;
      else {
        let existing = issueLists.get(entity.repo);
        if (!existing) { existing = list<RemoteIssue>(`repos/${entity.repo}/issues?state=all`); issueLists.set(entity.repo, existing); }
        const matches = existing.filter(i => !i.pull_request && i.body?.includes(marker('issue', entity.key)));
        if (matches.length > 1) throw new Error(`Multiple issues match ${entity.key}; restore its mapping before retrying.`);
        issue = matches[0] ?? client.request('POST', `repos/${entity.repo}/issues`, {
          title: entity.title.slice(0, 240), body: marker('issue', entity.key) + '\n' + marker('begin', entity.key) + '\nPublishing task details…\n' + marker('end', entity.key)
        }) as RemoteIssue;
        if (!Number.isSafeInteger(issue.id) || !Number.isSafeInteger(issue.number) || issue.html_url !== `https://github.com/${entity.repo}/issues/${issue.number}`) throw new Error('Invalid GitHub issue response');
        mapping = { repo: entity.repo, number: issue.number, id: issue.id, url: issue.html_url, comments: {}, ownedDependencies: [] };
        state.issues[entity.key] = mapping; existing.push(issue); save();
      }
      remote.set(entity.key, issue);
    }
    // Link after all issues exist, including forward references from batch task plans.
    const childLists = new Map<string, RemoteIssue[]>();
    for (const entity of plan.entities) {
      const own = state.issues[entity.key]!;
      if (entity.parent) {
        let children = childLists.get(entity.parent);
        if (!children) { children = list<RemoteIssue>(endpoint(entity.parent) + '/sub_issues'); childLists.set(entity.parent, children); }
        if (!children.some(child => child.id === own.id)) {
          client.request('POST', endpoint(entity.parent) + '/sub_issues', { sub_issue_id: own.id, replace_parent: true });
          children.push(remote.get(entity.key)!);
        }
      }
      const required = entity.dependencies.map(key => {
        const dep = state!.issues[key];
        if (!dep) throw new Error(`Dependency ${key} has no published issue; enable GitHub on its entry graph.`);
        return dep.id;
      });
      if (required.length || own.ownedDependencies.length) {
        const current = list<RemoteIssue>(endpoint(entity.key) + '/dependencies/blocked_by').map(i => i.id);
        for (const id of required) {
          if (current.includes(id)) continue;
          if (!own.ownedDependencies.includes(id)) { own.ownedDependencies.push(id); save(); }
          client.request('POST', endpoint(entity.key) + '/dependencies/blocked_by', { issue_id: id });
        }
        for (const id of [...own.ownedDependencies]) {
          if (required.includes(id)) continue;
          if (current.includes(id)) client.request('DELETE', endpoint(entity.key) + '/dependencies/blocked_by/' + id);
          own.ownedDependencies = own.ownedDependencies.filter(value => value !== id); save();
        }
      }
    }
    const commentLists = new Map<string, RemoteComment[]>();
    for (const [key, item] of Object.entries(state.outbox)) {
      const own = state.issues[item.issueKey];
      if (!own) throw new Error(`Queued comment has no issue: ${item.issueKey}`);
      let comments = commentLists.get(item.issueKey);
      if (!comments) { comments = list<RemoteComment>(endpoint(item.issueKey) + '/comments'); commentLists.set(item.issueKey, comments); }
      const found = comments.find(c => c.body.includes(marker('comment', key)));
      const posted = found ?? client.request('POST', endpoint(item.issueKey) + '/comments', { body: item.body + '\n\n' + marker('comment', key) }) as RemoteComment;
      if (!Number.isSafeInteger(posted.id)) throw new Error('Invalid GitHub comment response');
      own.comments[key] = posted.id; delete state.outbox[key]; comments.push(posted); save();
    }
    const link = (key: string): string => { const issue = state!.issues[key]; return issue ? `[${key}](${issue.url})` : key; };
    const bodyFor = (entity: GitHubEntity): string => {
      let text = entity.body;
      if (entity.dependencies.length) text += '\n\n## Blocking issues\n' + entity.dependencies.map(key => '- ' + link(key)).join('\n');
      if (entity.children.length) text += '\n\n## Tasks\n' + entity.children.map(key => '- ' + link(key)).join('\n');
      // Graphs with very many tasks still have a native sub-issue list.
      if (text.length > 55000) text = text.slice(0, 50000) + '\n\nSee the native sub-issue list for the remaining tasks.';
      return marker('begin', entity.key) + '\n' + text + '\n' + marker('end', entity.key);
    };
    for (const entity of [...plan.entities].reverse()) {
      const issue = remote.get(entity.key)!;
      const before = issue.body ?? '';
      const begin = before.indexOf(marker('begin', entity.key));
      const end = before.indexOf(marker('end', entity.key), begin);
      if (begin < 0 || end < begin) throw new Error(`Managed body markers missing on ${entity.key}; restore them before syncing.`);
      const body = before.slice(0, begin) + bodyFor(entity) + before.slice(end + marker('end', entity.key).length);
      const title = entity.title.slice(0, 240);
      if (issue.title !== title || before !== body || issue.state !== entity.state || (entity.state === 'closed' && issue.state_reason !== entity.reason)) {
        client.request('PATCH', endpoint(entity.key), { title, body, state: entity.state, state_reason: entity.reason });
      }
    }
    state.fingerprint = plan.fingerprint;
    if (snapshot().fingerprint !== plan.fingerprint) throw new Error('Local tasks changed during sync; run github sync to publish the latest changes.');
    state.status = 'synced'; state.lastSuccess = new Date().toISOString(); save();
    return githubView(state);
  } catch (error) {
    if (state && release) { state.status = 'pending'; state.error = message(error); try { save(); } catch { /* report the original failure */ } }
    return { ...githubView(state), status: 'pending', error: message(error) };
  } finally { release?.(); }
}
