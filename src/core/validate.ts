import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { findDependencyCycles, formatCyclePath } from './dag.js';
import { isTemporaryArtifact, listFilesWithExtension, readTextIfExists } from './fsx.js';
import { projectPaths, relativePath } from './layout.js';
import {
  readProjectManifest,
  validateProjectManifest,
  type ProjectManifest,
} from './project.js';
import { TASK_ID_PATTERN, parseTaskDocument, validateTaskDocument, type TaskDocument } from './task.js';

export interface ValidationIssue {
  readonly code: string;
  /** Project-relative file the issue belongs to. */
  readonly file: string;
  /** Field path inside that file. */
  readonly field: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly root: string;
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ScannedTask {
  readonly file: string;
  readonly document: TaskDocument;
}
/**
 * Validates the whole project: manifest semantics, every task document, and all
 * cross-file references. Collects every problem instead of stopping at the
 * first one so a single run explains the full repair list.
 */
export function validateRepository(root: string): ValidationReport {
  const issues: ValidationIssue[] = [];
  const manifestFile = relativePath(root, projectPaths(root).projectFile);

  let manifest: ProjectManifest;
  try {
    manifest = readProjectManifest(root);
  } catch (error) {
    issues.push(errorToIssue(error, manifestFile));
    return { root, ok: false, issues };
  }

  for (const issue of validateProjectManifest(manifest, manifestFile)) {
    issues.push({
      code: issue.code,
      file: manifestFile,
      field: issue.field,
      message: issue.message.replace(`${manifestFile}: `, ''),
    });
  }

  const { tasks, taskIssues } = scanTaskDocuments(root);
  issues.push(...taskIssues);

  const taskById = new Map<string, ScannedTask>();
  for (const task of tasks) taskById.set(task.document.id, task);

  const graphIds = new Set(manifest.graphs.map((graph) => graph.id));
  const entryIds = new Set(manifest.entryGraphs);
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const parentByGraph = parentCompositeByGraph(tasks);
  const treeRootCache = new Map<string, string | undefined>();
  const treeRoot = (graphId: string): string | undefined => {
    if (!treeRootCache.has(graphId)) {
      treeRootCache.set(graphId, treeRootOf(graphId, manifest, parentByGraph));
    }
    return treeRootCache.get(graphId);
  };

  for (const task of tasks) {
    const document = task.document;
    const file = task.file;

    if (!graphIds.has(document.graph)) {
      issues.push({
        code: 'E_UNKNOWN_TASK_GRAPH',
        file,
        field: 'graph',
        message: `task "${document.id}" belongs to unregistered graph "${document.graph}"`,
      });
    }

    document.dependsOn.forEach((dependency, index) => {
      const target = taskById.get(dependency.task);
      if (!target) {
        issues.push({
          code: 'E_UNKNOWN_TASK_REF',
          file,
          field: `depends_on[${index}].task`,
          message: `task "${document.id}" depends on missing task "${dependency.task}"`,
        });
        return;
      }
      if (dependency.mode === 'partial') {
        const gate = dependency.gate ?? '';
        const composite = target.document.subgraph;
        if (!composite) {
          issues.push({
            code: 'E_UNKNOWN_GATE',
            file,
            field: `depends_on[${index}].gate`,
            message: `task "${document.id}" has a partial dependency on "${dependency.task}" which is not a composite task`,
          });
        } else if (gate.length === 0) {
          issues.push({
            code: 'E_EMPTY_GATE',
            file,
            field: `depends_on[${index}].gate`,
            message: `task "${document.id}" has a partial dependency on "${dependency.task}" without a completion point name`,
          });
        } else if (!composite.exposes.some((point) => point.name === gate)) {
          issues.push({
            code: 'E_UNKNOWN_GATE',
            file,
            field: `depends_on[${index}].gate`,
            message: `task "${document.id}" depends on unknown completion point "${gate}" of task "${dependency.task}"`,
          });
        }
      }
      if (target.document.graph === document.graph) return;
      const sameTree = treeRoot(document.graph) === treeRoot(target.document.graph);
      issues.push({
        code: sameTree ? 'E_CROSS_LAYER_DEP' : 'E_CROSS_ENTRY_DEP',
        file,
        field: `depends_on[${index}].task`,
        message: sameTree
          ? `task "${document.id}" in graph "${document.graph}" cannot depend directly on task "${dependency.task}" in nested graph "${target.document.graph}"`
          : `task "${document.id}" in entry graph tree "${
              treeRoot(document.graph) ?? document.graph
            }" cannot depend on task "${dependency.task}" in a different entry graph tree`,
      });
    });
    document.derivedFrom.forEach((sourceId, index) => {
      if (sourceIds.has(sourceId)) return;
      issues.push({
        code: 'E_UNKNOWN_SOURCE_REF',
        file,
        field: `derived_from[${index}]`,
        message: `task "${document.id}" derives from unregistered source "${sourceId}"`,
      });
    });

    document.supersedes.forEach((taskId, index) => {
      if (taskById.has(taskId)) return;
      issues.push({
        code: 'E_UNKNOWN_TASK_REF',
        file,
        field: `supersedes[${index}]`,
        message: `task "${document.id}" supersedes missing task "${taskId}"`,
      });
    });

    if (document.subgraph) {
      const childGraph = document.subgraph.graph;
      if (!graphIds.has(childGraph)) {
        issues.push({
          code: 'E_UNKNOWN_GRAPH_REF',
          file,
          field: 'subgraph.graph',
          message: `task "${document.id}" references unregistered subgraph "${childGraph}"`,
        });
      } else if (entryIds.has(childGraph)) {
        issues.push({
          code: 'E_ENTRY_IS_SUBGRAPH',
          file,
          field: 'subgraph.graph',
          message: `graph "${childGraph}" is an entry graph and cannot be used as a subgraph`,
        });
      }

      const childTaskIds = new Set(
        tasks.filter((entry) => entry.document.graph === childGraph).map((entry) => entry.document.id),
      );
      const checkMembership = (
        taskId: string,
        field: string,
        label: string,
      ): void => {
        if (!taskById.has(taskId)) {
          issues.push({
            code: 'E_UNKNOWN_TASK_REF',
            file,
            field,
            message: `task "${document.id}" ${label} missing task "${taskId}"`,
          });
          return;
        }
        if (!childTaskIds.has(taskId)) {
          issues.push({
            code: 'E_COMPLETION_OUTSIDE_SUBGRAPH',
            file,
            field,
            message: `task "${document.id}" ${label} task "${taskId}" outside child graph "${childGraph}"`,
          });
        }
      };

      document.subgraph.completionRequires.forEach((taskId, index) => {
        checkMembership(taskId, `subgraph.completion_requires[${index}]`, 'lists completion target');
      });
      document.subgraph.exposes.forEach((point) => {
        point.requires.forEach((taskId, index) => {
          checkMembership(
            taskId,
            `subgraph.exposes.${point.name}.requires[${index}]`,
            `exposes "${point.name}" requiring`,
          );
        });
      });
    }
  }

  for (const cycle of findDependencyCycles(tasks.map((task) => task.document))) {
    const owner = cycle[0] ?? '';
    issues.push({
      code: 'E_CYCLE',
      file: owner.length === 0 ? manifestFile : `.task-graph/tasks/${owner}.md`,
      field: 'depends_on',
      message: `dependency cycle: ${formatCyclePath(cycle)}`,
    });
  }

  for (const graph of manifest.graphs) {
    if (entryIds.has(graph.id)) continue;
    const parents = tasks.filter((task) => task.document.subgraph?.graph === graph.id);
    if (parents.length === 0) {
      issues.push({
        code: 'E_SUBGRAPH_ORPHAN',
        file: manifestFile,
        field: `graphs.${graph.id}`,
        message: `non-entry graph "${graph.id}" has no parent composite task`,
      });
    } else if (parents.length > 1) {
      issues.push({
        code: 'E_SUBGRAPH_MULTI_PARENT',
        file: manifestFile,
        field: `graphs.${graph.id}`,
        message: `non-entry graph "${graph.id}" is entered by ${
          parents.length
        } composite tasks (${parents.map((task) => task.document.id).sort().join(', ')})`,
      });
    }
  }

  return { root, ok: issues.length === 0, issues };
}

/** Throws one error listing every discovered validation issue. */
export function assertRepositoryValid(root: string): ValidationReport {
  const report = validateRepository(root);
  if (report.ok) return report;
  throw new TaskGraphError('E_VALIDATE', `Task graph has ${report.issues.length} problem(s)`, [
    ...report.issues.map((issue) => `${issue.file} -> ${issue.field}: ${issue.message}`),
  ]);
}

function errorToIssue(error: unknown, file: string): ValidationIssue {
  if (error instanceof TaskGraphError) {
    return { code: error.code, file, field: '', message: error.format() };
  }
  return {
    code: 'E_INTERNAL',
    file,
    field: '',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Reads every task file without throwing, capturing parse failures as issues. */
function scanTaskDocuments(root: string): {
  tasks: ScannedTask[];
  taskIssues: ValidationIssue[];
} {
  const tasksDir = projectPaths(root).tasksDir;
  const tasks: ScannedTask[] = [];
  const taskIssues: ValidationIssue[] = [];

  for (const fileName of listFilesWithExtension(tasksDir, '.md')) {
    if (isTemporaryArtifact(fileName)) continue;
    const file = `.task-graph/tasks/${fileName}`;
    const stem = fileName.slice(0, -'.md'.length);
    if (!TASK_ID_PATTERN.test(stem)) {
      taskIssues.push({
        code: 'E_TASK_FILENAME',
        file,
        field: 'file',
        message: `task file must be named T-NNNN.md, found stem "${stem}"`,
      });
      continue;
    }
    const text = readTextIfExists(path.join(tasksDir, fileName));
    if (text === undefined) continue;
    let document: TaskDocument;
    try {
      document = parseTaskDocument(text, file);
    } catch (error) {
      taskIssues.push(errorToIssue(error, file));
      continue;
    }
    for (const issue of validateTaskDocument(document, file)) {
      taskIssues.push({
        code: issue.code,
        file,
        field: issue.field,
        message: issue.message.replace(`${file}: `, ''),
      });
    }
    if (document.id !== stem) {
      taskIssues.push({
        code: 'E_TASK_ID_MISMATCH',
        file,
        field: 'id',
        message: `declares id "${document.id}" but the file name says "${stem}"`,
      });
    }
    tasks.push({ file, document });
  }

  tasks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { tasks, taskIssues };
}

/** Maps each subgraph to the composite task that enters it. */
export function parentCompositeByGraph(
  tasks: readonly { readonly document: TaskDocument }[],
): Map<string, TaskDocument> {
  const parents = new Map<string, TaskDocument>();
  for (const task of tasks) {
    const graph = task.document.subgraph?.graph;
    if (!graph) continue;
    parents.set(graph, task.document);
  }
  return parents;
}

/** Entry graph that owns `graphId`, or `undefined` when the chain is broken. */
export function treeRootOf(
  graphId: string,
  manifest: ProjectManifest,
  parentByGraph: ReadonlyMap<string, TaskDocument>,
): string | undefined {
  const entryIds = new Set(manifest.entryGraphs);
  const seen = new Set<string>();
  let current = graphId;
  while (!seen.has(current)) {
    if (entryIds.has(current)) return current;
    seen.add(current);
    const parent = parentByGraph.get(current);
    if (!parent) return undefined;
    current = parent.graph;
  }
  return undefined;
}
