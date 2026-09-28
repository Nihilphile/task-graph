import { createHash } from 'node:crypto';
import { contentBindings, historyEntry, type TaskDocument } from './task.js';
import { documentMetadata, readDocument } from './documents.js';
import { taskContext } from './task-context.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import { mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { readinessFor } from './readiness.js';
import { TaskGraphError } from './errors.js';

/** Hash requirements and direct upstream contracts; logs/claims do not invalidate a plan. */
export function refinementFingerprint(task: TaskDocument, repo: TaskRepository): string {
  const files = contentBindings(task).map(o => [o.path, o.path === `.task-graph/tasks/${task.id}.md`
    ? task.body.replace(/^##[ \t]+工作记录[\s\S]*$/m, '') : readDocument(repo.root, o.path).toString('utf8')]);
  const refs = taskContext(repo.root, task, repo).references.filter(o => o.scope === 'dependency').map(o => {
    if (o.error) throw new TaskGraphError('E_REFINEMENT_INPUT', o.error);
    return [o.source_task, o.path, o.read_path, o.summary, o.sha256 ?? createHash('sha256').update(readDocument(repo.root, o.read_path)).digest('hex')];
  });
  const ids = new Set(task.dependsOn.flatMap(d => [d.task, ...(d.mode === 'partial' ? repo.taskById(d.task)?.subgraph?.exposes.find(g => g.name === d.gate)?.requires ?? [] : [])]));
  const predecessors = [...ids].sort().map(id => {
    const source = repo.taskById(id);
    return [id, source?.status, source?.subgraph, source?.history.filter(h => ['completed', 'rejected', 'reopened'].includes(h.event))];
  });
  return createHash('sha256').update(JSON.stringify({ title: task.title, kind: task.kind, files, refs, dependencies: task.dependsOn, predecessors })).digest('hex');
}

export function planningState(task: TaskDocument, repo: TaskRepository): 'static' | 'skeleton' | 'awaiting_review' | 'refined' | 'stale' {
  if (task.planning !== 'dynamic') return 'static';
  if (task.refinement) {
    try { if (task.refinement.fingerprint === refinementFingerprint(task, repo)) return 'refined'; } catch { /* missing inputs also require review */ }
    return 'stale';
  }
  return readinessFor(task, new Map(repo.tasks.map(t => [t.id, t]))).readiness === 'ready' ? 'awaiting_review' : 'skeleton';
}

export function refineTask(root: string, options: ClockOptions & { id: string; reason: string; reset?: boolean }): TaskDocument {
  if (!options.reason.trim()) throw new TaskGraphError('E_REFINEMENT_REASON', 'Record the assessment with --reason');
  return mutateTaskDocument(root, options.id, current => {
    if (!['todo', 'reject', 'done'].includes(current.status) || current.claim) throw new TaskGraphError('E_REFINEMENT_STATE', 'Refine only unclaimed todo/reject/done tasks; coordinate active work before changing its plan');
    const repo = loadTaskRepository(root);
    const at = timestampOf(options.now);
    if (options.reset) return { ...current, planning: 'dynamic', refinement: undefined,
      history: [...current.history, historyEntry('refinement_reset', at, options.actor ?? null, { reason: options.reason })] };
    const state = readinessFor(current, new Map(repo.tasks.map(t => [t.id, t])));
    if (state.readiness !== 'ready') throw new TaskGraphError('E_TASK_BLOCKED', 'Resolve dependencies and manual blockers before refining');
    for (const o of contentBindings(current)) documentMetadata(root, o.path);
    const next: TaskDocument = { ...current, planning: 'dynamic' };
    const refinement = { at, actor: options.actor ?? null, reason: options.reason.trim(), fingerprint: refinementFingerprint(next, repo) };
    return { ...next, refinement, history: [...current.history, historyEntry('refined', at, options.actor ?? null, { reason: refinement.reason, fingerprint: refinement.fingerprint })] };
  });
}

export function assertPlanMutable(current: TaskDocument, next: TaskDocument): void {
  if (current.planning !== 'dynamic' || (current.status !== 'in_progress' && current.blockedFrom !== 'in_progress')) return;
  if (JSON.stringify(contentBindings(current)) !== JSON.stringify(contentBindings(next)) || JSON.stringify(current.dependsOn) !== JSON.stringify(next.dependsOn) || current.title !== next.title || current.body.replace(/^##[ \t]+工作记录[\s\S]*$/m, '') !== next.body.replace(/^##[ \t]+工作记录[\s\S]*$/m, '')) {
    throw new TaskGraphError('E_ACTIVE_PLAN', 'This dynamic task is running. Record the scope change and coordinate cancellation/replacement rather than silently editing its requirements or dependencies');
  }
}
