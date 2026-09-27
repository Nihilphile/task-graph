import path from 'node:path';
import { projectPaths } from './layout.js';
import { renderMarkdown } from './markdown.js';
import { computeReadiness, type BlockedReason, type Readiness } from './readiness.js';
import { loadTaskRepository } from './repo.js';
import type { TaskClaim, TaskOutput, TaskSubgraph, TaskDependency } from './task.js';
import { taskDocuments, type TaskDocuments } from './documents.js';
import type { TaskHistoryEntry } from './task.js';
import { referenceDocuments } from './task-context.js';
import { githubTargets, planGitHub } from './github-plan.js';
import { githubView, readGitHubState, type GitHubView, type GitHubState } from './github-state.js';

/** Version of the generated projection schema (independent of project.yaml). */
export const PROJECTION_VERSION = 2;

export interface ProjectedGraph {
  readonly github?: GitHubView;
  readonly id: string;
  readonly title: string;
  readonly entry: boolean;
  /** Composite task that opens this graph, or `null` for entry graphs. */
  readonly parentTask: string | null;
}

export interface ProjectedTask {
  readonly github?: GitHubView;
  readonly id: string;
  readonly graph: string;
  readonly title: string;
  readonly documents?: TaskDocuments;
  readonly history?: readonly TaskHistoryEntry[];
  readonly status: string;
  readonly planningState?: string;
  readonly kind?: string;
  readonly claim: TaskClaim | null;
  readonly dependsOn: readonly TaskDependency[];
  readonly manualBlockers: readonly string[];
  readonly subgraph: TaskSubgraph | null;
  readonly supersedes: readonly string[];
  readonly derivedFrom: readonly string[];
  readonly outputs: readonly TaskOutput[];
  /** Computed readiness; never stored in the task Markdown. */
  readonly readiness: Readiness;
  /** Reasons the task is not ready, in dependency then manual-blocker order. */
  readonly blockedBy: readonly BlockedReason[];
  readonly body: string;
  readonly html: string;
}

export interface ProjectedEdge {
  readonly from: string;
  readonly to: string;
  readonly gate?: string;
}

export interface GraphProjection {
  readonly version: number;
  readonly project: {
    readonly name: string;
    readonly schemaVersion: number;
    readonly entryGraphs: readonly string[];
  };
  readonly graphs: readonly ProjectedGraph[];
  readonly sources: readonly { id: string; file: string; confirmedAt: string }[];
  readonly tasks: readonly ProjectedTask[];
  readonly relationships: {
    readonly full: readonly ProjectedEdge[];
    readonly partial: readonly ProjectedEdge[];
    readonly derives: readonly ProjectedEdge[];
    readonly parent: readonly ProjectedEdge[];
  };
}

/**
 * Builds the machine-readable projection of the current source state.
 *
 * Ordering is derived from IDs only, so identical source input always produces
 * byte-identical output.
 */
export function createGraphProjection(root: string): GraphProjection {
  const repository = loadTaskRepository(root);
  const manifest = repository.manifest;
  const entryIds = new Set(manifest.entryGraphs);
  const targets = githubTargets(repository);
  let githubState: GitHubState | undefined;
  let githubError: string | undefined;
  if (targets.size) {
    try {
      githubState = readGitHubState(root);
      if (githubState?.status === 'synced' && githubState.fingerprint !== planGitHub(root).fingerprint) githubError = 'Local changes are awaiting GitHub sync.';
    } catch (error) { githubError = error instanceof Error ? error.message : String(error); }
  }
  const remoteView = (graph: string, key: string): { github?: GitHubView } => {
    const target = targets.get(graph);
    return target ? { github: { ...githubView(githubState, key, target.repo), ...(githubError ? { status: 'pending', error: githubError } : {}) } } : {};
  };

  const parentsByGraph = new Map<string, string[]>();
  for (const task of repository.tasks) {
    const graph = task.subgraph?.graph;
    if (!graph) continue;
    const bucket = parentsByGraph.get(graph);
    if (bucket) bucket.push(task.id);
    else parentsByGraph.set(graph, [task.id]);
  }

  const graphs: ProjectedGraph[] = manifest.graphs.map((graph) => {
    const parents = [...(parentsByGraph.get(graph.id) ?? [])].sort();
    return {
      id: graph.id,
      title: graph.title,
      entry: entryIds.has(graph.id),
      parentTask: parents.length === 1 ? parents[0]! : null,
      ...remoteView(graph.id, targets.get(graph.id)?.container ?? graph.id),
    };
  });

  const readiness = computeReadiness(repository);

  const tasks: ProjectedTask[] = repository.tasks.map((task) => ({
    id: task.id,
    graph: task.graph,
    title: task.title,
    ...remoteView(task.graph, task.id),
    documents: { ...taskDocuments(root, task), references: referenceDocuments(root, task, repository) },
    history: task.history,
    status: task.status,
    planningState: readiness.get(task.id)?.planningState ?? 'static',
    kind: task.kind ?? 'work',
    claim: task.claim,
    dependsOn: task.dependsOn.map((dependency) =>
      dependency.gate === undefined
        ? { task: dependency.task, mode: dependency.mode }
        : { task: dependency.task, mode: dependency.mode, gate: dependency.gate },
    ),
    manualBlockers: [...task.manualBlockers],
    subgraph: task.subgraph
      ? {
          graph: task.subgraph.graph,
          completionRequires: [...task.subgraph.completionRequires],
          exposes: task.subgraph.exposes.map((point) => ({
            name: point.name,
            requires: [...point.requires],
          })),
        }
      : null,
    supersedes: [...task.supersedes],
    derivedFrom: [...task.derivedFrom],
    outputs: task.outputs.map((output) => ({ ...output })),
    readiness: readiness.get(task.id)?.readiness ?? 'ready',
    blockedBy: (readiness.get(task.id)?.blockedBy ?? []).map(copyBlockedReason),
    body: task.body,
    html: renderMarkdown(task.body),
  }));

  const full: ProjectedEdge[] = [];
  const partial: ProjectedEdge[] = [];
  const derives: ProjectedEdge[] = [];
  const parent: ProjectedEdge[] = [];

  for (const task of repository.tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency.mode === 'partial') {
        partial.push({ from: dependency.task, to: task.id, gate: dependency.gate ?? '' });
      } else {
        full.push({ from: dependency.task, to: task.id });
      }
    }
    for (const sourceId of task.derivedFrom) derives.push({ from: sourceId, to: task.id });
    if (task.subgraph) parent.push({ from: task.id, to: task.subgraph.graph });
  }

  return {
    version: PROJECTION_VERSION,
    project: {
      name: manifest.name,
      schemaVersion: manifest.version,
      entryGraphs: [...manifest.entryGraphs].sort(),
    },
    graphs,
    sources: manifest.sources.map((source) => ({
      id: source.id,
      file: source.file,
      confirmedAt: source.confirmedAt,
    })),
    tasks,
    relationships: {
      full: sortEdges(full),
      partial: sortEdges(partial),
      derives: sortEdges(derives),
      parent: sortEdges(parent),
    },
  };
}

function sortEdges(edges: readonly ProjectedEdge[]): ProjectedEdge[] {
  return [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    const left = a.gate ?? '';
    const right = b.gate ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Copies a blocked reason so generated data never shares source arrays. */
function copyBlockedReason(reason: BlockedReason): BlockedReason {
  return reason.kind === 'gate'
    ? { kind: 'gate', task: reason.task, gate: reason.gate, tasks: [...reason.tasks] }
    : reason;
}

/** Deterministic JSON text for a projection (two-space indent, trailing LF). */
export function serializeGraphProjection(projection: GraphProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

export function graphJsonRelativePath(): string {
  return ['.task-graph', 'generated', 'graph.json'].join('/');
}

export function graphJsonPath(root: string): string {
  return projectPaths(root).graphJsonFile;
}

export function generatedDirRelative(): string {
  return ['.task-graph', 'generated'].join('/');
}

export function generatedDirPath(root: string): string {
  return path.dirname(graphJsonPath(root));
}
