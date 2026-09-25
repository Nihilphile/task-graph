import path from 'node:path';

/** Canonical on-disk layout of a Task Graph project. */
export const TASK_GRAPH_DIR = '.task-graph';
export const PROJECT_FILE = 'project.yaml';
export const TASKS_DIR = 'tasks';
export const GENERATED_DIR = 'generated';
export const GRAPH_JSON_FILE = 'graph.json';
export const INDEX_HTML_FILE = 'index.html';
export const LOCK_DIR = 'lock';

export const SCHEMA_VERSION = 1;

export interface ProjectPaths {
  /** Directory that contains `.task-graph/`. */
  readonly root: string;
  readonly taskGraphDir: string;
  readonly projectFile: string;
  readonly tasksDir: string;
  readonly generatedDir: string;
  readonly graphJsonFile: string;
  readonly indexHtmlFile: string;
  readonly lockDir: string;
}

export function projectPaths(root: string): ProjectPaths {
  const taskGraphDir = path.join(root, TASK_GRAPH_DIR);
  return {
    root,
    taskGraphDir,
    projectFile: path.join(taskGraphDir, PROJECT_FILE),
    tasksDir: path.join(taskGraphDir, TASKS_DIR),
    generatedDir: path.join(taskGraphDir, GENERATED_DIR),
    graphJsonFile: path.join(taskGraphDir, GENERATED_DIR, GRAPH_JSON_FILE),
    indexHtmlFile: path.join(taskGraphDir, GENERATED_DIR, INDEX_HTML_FILE),
    lockDir: path.join(taskGraphDir, LOCK_DIR),
  };
}

export function taskFileName(taskId: string): string {
  return `${taskId}.md`;
}

export function taskFilePath(root: string, taskId: string): string {
  return path.join(projectPaths(root).tasksDir, taskFileName(taskId));
}

/** Converts an absolute path to a repo-relative POSIX path for messages. */
export function relativePath(root: string, target: string): string {
  const rel = path.relative(root, target);
  if (rel.length === 0) return '.';
  return rel.split(path.sep).join('/');
}
