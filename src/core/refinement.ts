import { contentBindings, historyEntry, type TaskDocument } from './task.js';
import { documentMetadata } from './documents.js';
import { loadTaskRepository, type TaskRepository } from './repo.js';
import { mutateTaskDocument, timestampOf, type ClockOptions } from './mutate.js';
import { readinessFor } from './readiness.js';
import { TaskGraphError } from './errors.js';

/** Approval persists until the controller explicitly withdraws it. */
export function planningState(task: TaskDocument, repo: TaskRepository): 'static' | 'skeleton' | 'awaiting_review' | 'refined' {
  if (task.planning !== 'dynamic') return 'static';
  if (task.refinement) return 'refined';
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
    if (state.readiness !== 'ready') throw new TaskGraphError('E_TASK_UNREADY', 'Resolve dependencies and manual blockers before refining');
    for (const o of contentBindings(current)) documentMetadata(root, o.path);
    const next: TaskDocument = { ...current, planning: 'dynamic' };
    const refinement = { at, actor: options.actor ?? null, reason: options.reason.trim() };
    return { ...next, refinement, history: [...current.history, historyEntry('refined', at, options.actor ?? null, { reason: refinement.reason })] };
  });
}

export function assertPlanMutable(current: TaskDocument, next: TaskDocument): void {
  if (current.planning !== 'dynamic' || (current.status !== 'in_progress' && current.blockedFrom !== 'in_progress')) return;
  if (JSON.stringify(current.contracts ?? []) !== JSON.stringify(next.contracts ?? []) || JSON.stringify(contentBindings(current)) !== JSON.stringify(contentBindings(next)) || JSON.stringify(current.dependsOn) !== JSON.stringify(next.dependsOn) || current.title !== next.title || current.body.replace(/^##[ \t]+工作记录[\s\S]*$/m, '') !== next.body.replace(/^##[ \t]+工作记录[\s\S]*$/m, '')) {
    throw new TaskGraphError('E_ACTIVE_PLAN', 'This dynamic task is running. Record the scope change and coordinate cancellation/replacement rather than silently editing its requirements or dependencies');
  }
}
