import { TaskGraphError } from './errors.js';
import { buildProject } from './build.js';
import {
  readProjectManifest,
  serializeProjectManifest,
  type GraphRegistration,
  type ProjectManifest,
} from './project.js';
import { readTaskDocument, serializeTaskDocument, type TaskDocument } from './task.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';

export interface AddGraphOptions {
  readonly githubRepo?: string;
  readonly title: string;
  /** Explicit graph ID; when omitted the next free `G-NNN` is allocated. */
  readonly id?: string | undefined;
  /** Register the new graph as an entry graph. */
  readonly entry?: boolean | undefined;
  /**
   * Composite task that immediately enters the new non-entry graph.
   *
   * A graph must always have exactly one place in the project, so `graph add`
   * requires either `entry` or `parentTask`; it never leaves a dangling graph.
   */
  readonly parentTask?: string | undefined;
}

export interface AddGraphResult {
  readonly root: string;
  readonly graph: GraphRegistration;
  readonly entry: boolean;
  readonly parentTask: string | null;
  readonly manifest: ProjectManifest;
}

/**
 * Registers a graph with a stable ID and title.
 *
 * Existing graphs are never renamed or renumbered: a new ID is always the
 * highest existing number plus one.
 */
export function addGraph(root: string, options: AddGraphOptions): AddGraphResult {
  const title = options.title.trim();
  if (title.length === 0) {
    throw new TaskGraphError('E_GRAPH_TITLE', 'A graph title is required');
  }
  const entry = options.entry === true;
  const parentTask = options.parentTask?.trim();
  if (entry && parentTask !== undefined && parentTask.length > 0) {
    throw new TaskGraphError(
      'E_GRAPH_PLACEMENT',
      'A graph cannot be both an entry graph and a subgraph',
      ['Pass either --entry or --parent-task, not both.'],
    );
  }
  if (!entry && (parentTask === undefined || parentTask.length === 0)) {
    throw new TaskGraphError('E_GRAPH_PLACEMENT', 'A new graph needs a place in the project', [
      'Pass --entry to make it an entry graph, or --parent-task T-NNNN to make it the subgraph of that composite task.',
    ]);
  }

  let registered: GraphRegistration | null = null;

  runProjectTransaction(
    root,
    (transaction) => {
      const manifest = readProjectManifest(root);
      const graphId = (options.id ?? nextGraphId(manifest)).trim();
      if (graphId.length === 0) {
        throw new TaskGraphError('E_GRAPH_ID', 'A graph ID must not be empty');
      }
      if (manifest.graphs.some((graph) => graph.id === graphId)) {
        throw new TaskGraphError('E_DUP_GRAPH', `Graph "${graphId}" is already registered`);
      }

      if (options.githubRepo && !entry) throw new TaskGraphError('E_GITHUB_GRAPH', 'Enable GitHub on the entry graph; child graphs inherit it.');
      const graph: GraphRegistration = { id: graphId, title, ...(options.githubRepo ? { github: { repo: options.githubRepo } } : {}) };
      const next: ProjectManifest = {
        ...manifest,
        graphs: [...manifest.graphs, graph],
        entryGraphs: entry ? [...manifest.entryGraphs, graphId] : [...manifest.entryGraphs],
      };
      transaction.write('.task-graph/project.yaml', serializeProjectManifest(next));

      if (!entry && parentTask !== undefined) {
        const parent = readTaskDocument(root, parentTask);
        if (['pending_review', 'reviewing'].includes(parent.status) || parent.blockedFrom === 'pending_review') throw new TaskGraphError('E_REVIEW_ACTIVE', 'Requirements are fixed during review');
        if (parent.subgraph) {
          throw new TaskGraphError(
            'E_TASK_SUBGRAPH',
            `Task "${parentTask}" already owns subgraph "${parent.subgraph.graph}"`,
            ['Detach the existing subgraph before attaching another one.'],
          );
        }
        const updated: TaskDocument = {
          ...parent,
          subgraph: { graph: graphId, completionRequires: [], exposes: [] },
        };
        transaction.write(
          `.task-graph/tasks/${parentTask}.md`,
          serializeTaskDocument(updated),
        );
      }

      registered = graph;
    },
    { validate: () => assertRepositoryValid(root) },
  );

  buildProject(root);

  if (registered === null) {
    throw new TaskGraphError('E_INTERNAL', 'Graph registration produced no graph');
  }
  return {
    root,
    graph: registered,
    entry,
    parentTask: entry ? null : (parentTask ?? null),
    manifest: readProjectManifest(root),
  };
}

/** Next free `G-NNN` graph ID: highest existing number plus one. */
export function nextGraphId(manifest: ProjectManifest): string {
  let highest = 0;
  for (const graph of manifest.graphs) {
    const match = /^G-(\d+)$/.exec(graph.id);
    if (!match) continue;
    const value = Number.parseInt(match[1]!, 10);
    if (value > highest) highest = value;
  }
  return `G-${String(highest + 1).padStart(3, '0')}`;
}
