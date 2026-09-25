import path from 'node:path';
import { readFileSync } from 'node:fs';
import { TaskGraphError } from './errors.js';
import { isTemporaryArtifact, listFilesWithExtension } from './fsx.js';
import { projectPaths, taskFileName } from './layout.js';
import { readProjectManifest, type ProjectManifest } from './project.js';
import {
  TASK_ID_PATTERN,
  parseTaskDocument,
  type TaskDocument,
} from './task.js';

export interface TaskRepository {
  readonly root: string;
  readonly manifest: ProjectManifest;
  /** Every task, sorted by task ID. */
  readonly tasks: readonly TaskDocument[];
  /** Task count keyed by declared graph; registered graphs are present even when empty. */
  readonly graphTasks: ReadonlyMap<string, readonly TaskDocument[]>;
  taskById(id: string): TaskDocument | undefined;
  tasksInGraph(graphId: string): readonly TaskDocument[];
  /** Next unused `T-NNNN` ID; never renames existing files. */
  nextTaskId(): string;
}

export function loadTaskRepository(root: string): TaskRepository {
  const paths = projectPaths(root);
  const manifest = readProjectManifest(root);
  const fileNames = listTaskFiles(paths.tasksDir);

  const tasks: TaskDocument[] = [];
  const byId = new Map<string, TaskDocument>();
  const seenInFile = new Map<string, string>();

  for (const fileName of fileNames) {
    const stem = fileName.slice(0, -'.md'.length);
    if (!TASK_ID_PATTERN.test(stem)) {
      throw new TaskGraphError(
        'E_TASK_FILENAME',
        `Task file "${fileName}" must be named T-NNNN.md`,
        [`Found stem "${stem}" in .task-graph/tasks/.`],
      );
    }
    const document = parseTaskDocument(
      readFileText(path.join(paths.tasksDir, fileName)),
      `.task-graph/tasks/${fileName}`,
    );
    const existing = seenInFile.get(document.id);
    if (existing) {
      throw new TaskGraphError('E_DUP_TASK', `Duplicate task ID "${document.id}"`, [
        `Declared in both ${existing} and ${fileName}.`,
      ]);
    }
    if (document.id !== stem) {
      throw new TaskGraphError(
        'E_TASK_ID_MISMATCH',
        `Task file "${fileName}" declares id "${document.id}"`,
        ['The frontmatter id must match the file name stem.'],
      );
    }
    seenInFile.set(document.id, fileName);
    byId.set(document.id, document);
    tasks.push(document);
  }

  tasks.sort((a, b) => compareIds(a.id, b.id));

  const graphTasks = new Map<string, TaskDocument[]>();
  for (const graph of manifest.graphs) graphTasks.set(graph.id, []);
  for (const task of tasks) {
    const bucket = graphTasks.get(task.graph);
    if (bucket) bucket.push(task);
    else graphTasks.set(task.graph, [task]);
  }

  return {
    root,
    manifest,
    tasks,
    graphTasks,
    taskById: (id) => byId.get(id),
    tasksInGraph: (graphId) => graphTasks.get(graphId) ?? [],
    nextTaskId: () => nextTaskId(tasks.map((task) => task.id)),
  };
}

function readFileText(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Sorted `T-NNNN.md` file names; scratch files are never source data. */
export function listTaskFiles(tasksDir: string): string[] {
  return listFilesWithExtension(tasksDir, '.md').filter(
    (fileName) => !isTemporaryArtifact(fileName),
  );
}

/**
 * Next free `T-NNNN` ID.
 *
 * Uses the highest existing number plus one so gaps left by cancelled or
 * superseded tasks are never reused, and existing file names never change.
 */
export function nextTaskId(existingIds: Iterable<string>): string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^T-(\d{4,})$/.exec(id);
    if (!match) continue;
    const value = Number.parseInt(match[1]!, 10);
    if (value > highest) highest = value;
  }
  return formatTaskId(highest + 1);
}

/** Formats a numeric task sequence as `T-NNNN` (at least four digits). */
export function formatTaskId(value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new TaskGraphError('E_TASK_ID', `Cannot format task sequence ${value}`);
  }
  return `T-${String(value).padStart(4, '0')}`;
}

/** Numeric part of a task ID, or `undefined` when it is not a task ID. */
export function taskIdNumber(id: string): number | undefined {
  const match = /^T-(\d{4,})$/.exec(id);
  if (!match) return undefined;
  return Number.parseInt(match[1]!, 10);
}

export function compareIds(a: string, b: string): number {
  const left = taskIdNumber(a);
  const right = taskIdNumber(b);
  if (left !== undefined && right !== undefined) return left - right;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Absolute path of a task document inside a project. */
export function taskDocumentPath(root: string, taskId: string): string {
  return path.join(projectPaths(root).tasksDir, taskFileName(taskId));
}
