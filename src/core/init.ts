import { TaskGraphError } from './errors.js';
import { ensureDir } from './fsx.js';
import { projectPaths } from './layout.js';
import {
  emptyProjectManifest,
  readProjectManifest,
  serializeProjectManifest,
  type GraphRegistration,
  type ProjectManifest,
} from './project.js';
import { buildProject, assertProjectMissing } from './build.js';
import {
  createTaskDocument,
  serializeTaskDocument,
  type TaskDocument,
} from './task.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';

export interface InitOptions {
  /** Project name stored in project.yaml. */
  readonly name: string;
  /** Optional root task title; providing it enables task-first initialisation. */
  readonly task?: string | undefined;
  /** Entry graph title; defaults to the root task title. */
  readonly graphTitle?: string | undefined;
  readonly goal?: string | undefined;
  readonly completionConditions?: readonly string[] | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface InitResult {
  readonly root: string;
  readonly manifest: ProjectManifest;
  readonly graph: GraphRegistration | null;
  readonly task: TaskDocument | null;
  readonly built: boolean;
}

export const FIRST_GRAPH_ID = 'G-001';
export const FIRST_TASK_ID = 'T-0001';

/**
 * Creates `.task-graph/` with project.yaml, the tasks and generated
 * directories, and — when a root task title is given — one entry graph plus one
 * root task that already contains the required Markdown sections.
 */
export function initializeProject(root: string, options: InitOptions): InitResult {
  assertProjectMissing(root);

  const name = options.name.trim();
  if (name.length === 0) {
    throw new TaskGraphError('E_INIT', 'A project name is required');
  }

  const taskTitle = options.task?.trim();
  const graphTitle = (options.graphTitle ?? taskTitle ?? '').trim();

  const base = emptyProjectManifest(name);
  const manifest: ProjectManifest =
    taskTitle === undefined || taskTitle.length === 0
      ? base
      : {
          ...base,
          graphs: [{ id: FIRST_GRAPH_ID, title: graphTitle.length > 0 ? graphTitle : taskTitle }],
          entryGraphs: [FIRST_GRAPH_ID],
        };

  const paths = projectPaths(root);
  ensureDir(paths.tasksDir);
  ensureDir(paths.generatedDir);

  let task: TaskDocument | null = null;
  runProjectTransaction(
    root,
    (transaction) => {
      transaction.write('.task-graph/project.yaml', serializeProjectManifest(manifest));
      if (taskTitle !== undefined && taskTitle.length > 0) {
        const created = createTaskDocument({
          id: FIRST_TASK_ID,
          graph: FIRST_GRAPH_ID,
          title: taskTitle,
          goal: options.goal,
          completionConditions: options.completionConditions,
        });
        task = created;
        transaction.write(
          `.task-graph/tasks/${FIRST_TASK_ID}.md`,
          serializeTaskDocument(created),
        );
      }
    },
    { validate: () => assertRepositoryValid(root) },
  );

  // Re-read from disk so the returned value matches the committed bytes.
  const persisted = readProjectManifest(root);
  buildProject(root);

  return {
    root,
    manifest: persisted,
    graph: persisted.graphs[0] ?? null,
    task,
    built: true,
  };
}
