import { createHash } from 'node:crypto';
import path from 'node:path';
import { readDocument } from './documents.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import { computeReadiness } from './readiness.js';
import { contentBindings } from './task.js';
import { knowledgeContext } from './task-context.js';

export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export interface GitHubTarget { repo: string; container: string }
/** Descendant graphs use their owning task as the remote container. */
export function githubTargets(repository: TaskRepository): Map<string, GitHubTarget> {
  const targets = new Map<string, GitHubTarget>();
  for (const graph of repository.manifest.graphs) {
    if (graph.github) {
      if (!repository.manifest.entryGraphs.includes(graph.id)) throw new Error('Enable GitHub only on entry graphs');
      targets.set(graph.id, { repo: graph.github.repo, container: `graph:${graph.id}` });
    }
  }
  for (let pass = 0; pass < repository.manifest.graphs.length; pass++) {
    for (const task of repository.tasks) {
      const target = targets.get(task.graph);
      if (target && task.subgraph) targets.set(task.subgraph.graph, { repo: target.repo, container: task.id });
    }
  }
  return targets;
}
export interface GitHubEntity {
  key: string; repo: string; title: string; body: string;
  parent?: string; dependencies: string[]; children: string[];
  state: 'open' | 'closed'; reason: 'completed' | 'not_planned' | 'reopened';
}
export interface PlannedComment { key: string; issueKey: string; body: string }
export interface GitHubPlan { entities: GitHubEntity[]; comments: PlannedComment[]; fingerprint: string }

export function planGitHub(root: string): GitHubPlan {
  const repository = loadTaskRepository(root);
  const targets = githubTargets(repository);
  const readiness = computeReadiness(repository);
  const entities: GitHubEntity[] = [];
  const comments: PlannedComment[] = [];
  function comment(issueKey: string, identity: string, text: string): void {
    // Bound UTF-16 length conservatively below GitHub's body limit, without truncation.
    const chunks = text.match(/[\s\S]{1,20000}/gu) ?? [''];
    chunks.forEach((chunk, i) => comments.push({ key: digest(`${issueKey}:${identity}:${i}`), issueKey,
      body: chunks.length > 1 ? `Part ${i + 1}/${chunks.length}\n\n${chunk}` : chunk }));
  }
  for (const graph of repository.manifest.graphs) {
    if (!graph.github) continue;
    const tasks = repository.tasksInGraph(graph.id);
    const closed = tasks.length > 0 && tasks.every(t => t.status === 'done' || t.status === 'cancelled');
    entities.push({ key: `graph:${graph.id}`, repo: graph.github.repo, title: `[${graph.id}] ${graph.title}`, parent: undefined,
      body: `# ${graph.title}\n\nTask Graph · ${repository.manifest.name}\n\nProgress: ${tasks.filter(t => t.status === 'done').length}/${tasks.length} done; ${tasks.filter(t => t.status === 'cancelled').length} cancelled.`,
      dependencies: [], children: tasks.map(t => t.id), state: closed ? 'closed' : 'open',
      reason: closed ? (tasks.some(t => t.status === 'cancelled') ? 'not_planned' : 'completed') : 'reopened' });
  }
  for (const task of repository.tasks) {
    const target = targets.get(task.graph);
    if (!target) continue;
    const dependencies = task.dependsOn.flatMap(dep => dep.mode === 'full' ? [dep.task]
      : repository.taskById(dep.task)?.subgraph?.exposes.find(g => g.name === dep.gate)?.requires ?? []);
    const content = contentBindings(task).map(o => o.path === `.task-graph/tasks/${task.id}.md` ? task.body : readDocument(root, o.path).toString('utf8')).join('\n\n---\n\n');
    let body = `# ${task.title}\n\nGraph: ${task.graph}\nStatus: ${task.status}\nReadiness: ${readiness.get(task.id)?.readiness ?? 'ready'}\nClaim: ${task.claim ? `${task.claim.role} / ${task.claim.sessionId}` : '—'}\n\n`;
    body += `Depends on: ${task.dependsOn.map(d => d.task + (d.gate ? ':' + d.gate : '')).join(', ') || '—'}\n`;
    body += `Manual blockers: ${task.manualBlockers.join('; ') || '—'}\n\n`;
    const artifacts = task.outputs.filter(output => !output.kind);
    if (artifacts.length) body += `Artifacts (project-relative paths): ${artifacts.map(output => output.path).join(', ')}\n\n`;
    const references = task.outputs.filter(output => output.kind === 'reference');
    const knowledge = knowledgeContext(root, task, repository);
    if (knowledge.contracts.length) body += '## Current contracts (local authority)\n' + knowledge.contracts.map(c => `- ${c.id}: ${c.title} — \`${c.path}\`${c.sections ? ' · sections: ' + c.sections.join(', ') : ''}`).join('\n') + '\n\n';
    if (knowledge.code_references.length) body += '## Code entries\n' + knowledge.code_references.map(r => `- ${r.id}: \`${r.path}:${r.line}\` (${r.symbol}) — ${r.summary}`).join('\n') + '\n\n';
    if (references.length) body += '## References (project-relative files)\n' + references.map(output => `- ${output.title ?? output.path}: \`${output.path}\` (${output.snapshot ? 'snapshot: ' + output.snapshot : 'live'})${output.summary ? ' — ' + output.summary : ''}`).join('\n') + '\n\n';
    if (content.length > 35000) {
      body += 'Full task requirements are published in comments (content version ' + digest(content).slice(0, 12) + ').';
      comment(task.id, 'content:' + digest(content), '# Task requirements\n\n' + content);
    } else body += content;
    entities.push({ key: task.id, repo: target.repo, title: `[${task.id}] ${task.title}`, body,
      parent: target.container, dependencies: [...new Set(dependencies)],
      children: task.subgraph ? repository.tasksInGraph(task.subgraph.graph).map(t => t.id) : [],
      state: task.status === 'done' || task.status === 'cancelled' ? 'closed' : 'open',
      reason: task.status === 'cancelled' ? 'not_planned' : task.status === 'done' ? 'completed' : 'reopened' });
    task.history.forEach((event, index) => {
      if (event.event === 'work_logged' && typeof event.extra['text'] === 'string') {
        comment(task.id, `log:${index}:${digest(JSON.stringify(event))}`, `## Work log\n${event.at}${event.actor ? ' · ' + event.actor : ''}\n\n${event.extra['text']}`);
      }
    });
    for (const output of task.outputs) {
      if (!output.kind || output.kind === 'reference' || output.kind === 'content') continue; // Requirements already appear in the issue body.
      if (output.kind === 'log' && output.path === `.task-graph/logs/${task.id}.md`) continue;
      const bytes = readDocument(root, output.snapshot ?? output.path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (output.sha256 && output.sha256 !== hash) throw new Error(`Snapshot checksum mismatch: ${output.path}`);
      const text = /\.(md|markdown|txt|log|json|ya?ml|csv)$/i.test(path.extname(output.path))
        ? bytes.toString('utf8') : 'Binary artifact retained locally; this comment contains its metadata only.';
      comment(task.id, `${output.kind ?? 'report'}:${output.path}:${hash}`,
        `## ${output.kind ?? 'report'} · ${output.title ?? output.path}\n\n${output.summary ? output.summary + '\n\n' : ''}File: \`${output.path}\`\nSHA-256: \`${hash}\`\n${output.addedAt ?? ''}\n\n${text}`);
    }
  }
  return { entities, comments, fingerprint: digest(JSON.stringify({ entities, comments })) };
}
