import type { TaskRepository } from './repo.js';
import { documentView, type DocumentView } from './documents.js';

export interface ErrorBookEntry {
  readonly id: string;
  readonly task: string;
  readonly graph: string;
  readonly title: string;
  readonly at: string;
  readonly actor: string | null;
  readonly report: DocumentView;
  readonly evidence: readonly string[];
}

/** Rejection history is the append-only source; rebuilding never adds entries. */
export function errorBookEntries(repository: TaskRepository, graph?: string, expand = false): ErrorBookEntry[] {
  const included = new Set(graph ? [graph] : repository.manifest.graphs.map(g => g.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const task of repository.tasks) {
      if (included.has(task.graph) && task.subgraph && !included.has(task.subgraph.graph)) {
        included.add(task.subgraph.graph); changed = true;
      }
    }
  }
  const entries: ErrorBookEntry[] = [];
  for (const task of repository.tasks) {
    if (!included.has(task.graph)) continue;
    task.history.forEach((event, index) => {
      const extra = event.extra;
      if (event.event !== 'rejected' || typeof extra['error_report'] !== 'string' || typeof extra['error_snapshot'] !== 'string') return;
      const output = { path: extra['error_report'], snapshot: extra['error_snapshot'], title: '失败小报告' };
      entries.push({ id: `${task.id}:${index}`, task: task.id, graph: task.graph, title: task.title,
        at: event.at, actor: event.actor,
        report: expand ? documentView(repository.root, 'report', output) : { ...output, id: `${task.id}:${index}`, kind: 'report', read_path: output.snapshot },
        evidence: Array.isArray(extra['error_evidence']) ? extra['error_evidence'] : [],
      });
    });
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.task.localeCompare(b.task) || Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]));
}
