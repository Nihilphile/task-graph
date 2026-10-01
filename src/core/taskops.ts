import { TaskGraphError } from './errors.js';
import { buildProject } from './build.js';
import type { ProjectManifest } from './project.js';
import { loadTaskRepository } from './repo.js';
import {
  createTaskDocument,
  historyEntry,
  replaceTaskTitle,
  serializeTaskDocument,
  type DependencyMode,
  type TaskDependency,
  type TaskDocument,
  type TaskStatus,
} from './task.js';
import { toIsoTimestamp } from './time.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';
import { addPlannedTasks } from './planning.js';
import { requireContent } from './documents.js';
import { assertPlanMutable } from './refinement.js';

export interface ClockOptions {
  readonly actor?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface AddTaskOptions extends ClockOptions {
  readonly contracts?: readonly string[];
  readonly references?: readonly string[];
  readonly planning?: 'static' | 'dynamic';
  readonly kind?: 'work' | 'acceptance' | 'decision';
  readonly contentFiles?: readonly string[];
  /** Target graph; required when the project registers more than one graph. */
  readonly graph?: string | undefined;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly content?: string | undefined;
  readonly key?: string | undefined;
  readonly parentTask?: string | undefined;
  readonly goal?: string | undefined;
  readonly completionConditions?: readonly string[] | undefined;
  readonly workLog?: readonly string[] | undefined;
  readonly dependsOn?: readonly TaskDependency[] | undefined;
  readonly manualBlockers?: readonly string[] | undefined;
  readonly derivedFrom?: readonly string[] | undefined;
  /** Dependencies given as `T-NNNN` or `T-NNNN:gate` strings. */
  readonly dependsOnSpecs?: readonly string[] | undefined;
}

export interface ReviseTaskOptions extends ClockOptions {
  readonly id: string;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly content?: string | undefined;
  readonly goal?: string | undefined;
  readonly completionConditions?: readonly string[] | undefined;
  readonly note?: string | undefined;
}

export interface ReplaceTaskOptions extends ClockOptions {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly content?: string;
  readonly reason?: string | undefined;
  readonly goal?: string | undefined;
  readonly completionConditions?: readonly string[] | undefined;
}

/**
 * Creates a task with a stable ID, content binding and validated dependencies.
 */
export function addTask(root: string, options: AddTaskOptions): TaskDocument {
  return addPlannedTasks(root, [options]).tasks[0]!;
}

/**
 * Revises a task in place: the ID and file name never change, a `revised`
 * history event is appended, and the Markdown body keeps every byte that was
 * not explicitly edited.
 */
export function reviseTask(root: string, options: ReviseTaskOptions): TaskDocument {
  if (
    options.title === undefined &&
    options.summary === undefined &&
    options.content === undefined &&
    options.goal === undefined &&
    options.completionConditions === undefined &&
    options.note === undefined
  ) {
    throw new TaskGraphError('E_TASK_REVISE', 'Nothing to revise', [
      'Pass --summary, --content, --title, --goal, --condition or --note.',
    ]);
  }

  let revised = false;
  runProjectTransaction(
    root,
    (transaction) => {
      const repository = loadTaskRepository(root);
      const current = requireTask(repository.taskById(options.id), options.id);
      if (['pending_review', 'reviewing'].includes(current.status) || current.blockedFrom === 'pending_review') throw new TaskGraphError('E_REVIEW_ACTIVE', 'Requirements are fixed during review');
      const next = applyRevision(current, { ...options, title: options.summary ?? options.title,
        ...(options.content === undefined ? {} : { content: requireContent(root, options.content) }) });
      assertPlanMutable(current, next);
      transaction.write(
        `.task-graph/tasks/${current.id}.md`,
        serializeTaskDocument(next),
      );
      revised = true;
    },
    { validate: () => assertRepositoryValid(root) },
  );

  buildProject(root);
  if (!revised) throw new TaskGraphError('E_INTERNAL', 'Task revision produced no change');
  return reloadTask(root, options.id);
}

/**
 * Replaces a task whose goal changed: the old task is cancelled, a new task
 * with a new ID is created, and `supersedes` links the two.
 */
export function replaceTask(root: string, options: ReplaceTaskOptions): {
  cancelled: TaskDocument;
  created: TaskDocument;
} {
  const title = options.title.trim();
  if (title.length === 0) {
    throw new TaskGraphError('E_TASK_TITLE', 'A replacement title is required');
  }
  const at = timestamp(options);
  let newId: string | null = null;

  runProjectTransaction(
    root,
    (transaction) => {
      const repository = loadTaskRepository(root);
      const current = requireTask(repository.taskById(options.id), options.id);
      if (current.status === 'cancelled') {
        throw new TaskGraphError(
          'E_TASK_TRANSITION',
          `Task "${current.id}" is already cancelled`,
          ['Cancelled is terminal; create a new task instead.'],
        );
      }
      if (['pending_review', 'reviewing'].includes(current.status) || current.blockedFrom === 'pending_review') throw new TaskGraphError('E_REVIEW_ACTIVE', 'Finish the current review before replacing this task');

      const cancelled: TaskDocument = {
        ...current,
        status: 'cancelled',
        blockedFrom: undefined,
        history: [
          ...current.history,
          historyEntry('cancelled', at, options.actor ?? null, {
            from: current.status,
            to: 'cancelled',
            reason: options.reason ?? 'superseded',
          }),
        ],
      };
      transaction.write(
        `.task-graph/tasks/${current.id}.md`,
        serializeTaskDocument(cancelled),
      );

      const id = repository.nextTaskId();
      newId = id;
      const replacement = createTaskDocument({
        id,
        graph: current.graph,
        title,
        goal: options.goal,
        completionConditions: options.completionConditions,
      });
      const withLink: TaskDocument = {
        ...replacement,
        ...(current.planning === undefined ? {} : { planning: current.planning }),
        ...(current.kind === undefined ? {} : { kind: current.kind }),
        ...(options.summary !== undefined || options.content !== undefined ? { summary: title, body: `# ${title}\n` } : {}),
        ...(options.content === undefined ? {} : { content: requireContent(root, options.content) }),
        supersedes: [current.id],
        history: [
          historyEntry('created', at, options.actor ?? null, {
            graph: current.graph,
            supersedes: current.id,
          }),
        ],
      };
      transaction.write(`.task-graph/tasks/${id}.md`, serializeTaskDocument(withLink));
    },
    { validate: () => assertRepositoryValid(root) },
  );

  buildProject(root);
  if (newId === null) throw new TaskGraphError('E_INTERNAL', 'Replacement produced no task');
  return { cancelled: reloadTask(root, options.id), created: reloadTask(root, newId) };
}

function applyRevision(current: TaskDocument, options: ReviseTaskOptions): TaskDocument {
  let body = current.body;
  if (options.title !== undefined) {
    body = /^#[ \t]+/m.test(body) ? replaceTaskTitle(body, options.title.trim()) : body;
  }
  if (options.goal !== undefined) {
    body = replaceBodySection(body, '目标', [options.goal.trim()]);
  }
  if (options.completionConditions !== undefined) {
    const conditions = options.completionConditions.map((line) => `- ${line.trim()}`);
    body = replaceBodySection(
      body,
      '完成条件',
      conditions.length > 0 ? conditions : ['- （待补充）'],
    );
  }
  const title = options.title !== undefined ? options.title.trim() : current.title;
  return {
    ...current,
    body,
    title,
    ...(current.summary === undefined && options.summary === undefined ? {} : { summary: title }),
    ...(options.content === undefined ? {} : { content: options.content }),
    history: [
      ...current.history,
      historyEntry('revised', timestamp(options), options.actor ?? null, {
        ...(options.title !== undefined ? { title } : {}),
        ...(options.content !== undefined ? { content: options.content } : {}),
        ...(options.note !== undefined ? { note: options.note } : {}),
      }),
    ],
  };
}

/** Replaces the content of one `## heading` section, keeping the rest intact. */
export function replaceBodySection(
  body: string,
  heading: string,
  contentLines: readonly string[],
): string {
  const pattern = new RegExp(`^##[ \\t]+${escapeRegExp(heading)}[ \\t]*$`, 'm');
  const match = pattern.exec(body);
  if (!match) {
    throw new TaskGraphError('E_TASK_SECTION', `Task body has no "## ${heading}" section`);
  }
  const contentStart = match.index + match[0].length;
  const rest = body.slice(contentStart);
  const nextHeading = /^##[ \t]+/m.exec(rest);
  const contentEnd = nextHeading ? contentStart + nextHeading.index : body.length;
  const tail = body.slice(contentEnd);
  const prefix = body.slice(0, contentStart);
  const normalizedTail = tail.length === 0 ? '\n' : `\n\n${tail.replace(/^\n+/, '')}`;
  return `${prefix}\n\n${contentLines.join('\n')}${normalizedTail}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parses `T-NNNN` and `T-NNNN:gate` dependency specifications. */
export function parseDependencySpecs(specs: readonly string[]): TaskDependency[] {
  return specs.map((spec) => {
    const trimmed = spec.trim();
    if (trimmed.length === 0) {
      throw new TaskGraphError('E_TASK_DEP', 'Empty dependency specification');
    }
    const separator = trimmed.indexOf(':');
    if (separator < 0) return { task: trimmed, mode: 'full' as DependencyMode };
    const task = trimmed.slice(0, separator).trim();
    const gate = trimmed.slice(separator + 1).trim();
    if (task.length === 0 || gate.length === 0) {
      throw new TaskGraphError('E_TASK_DEP', `Malformed partial dependency "${spec}"`, [
        'Use T-NNNN:gate-name.',
      ]);
    }
    return { task, mode: 'partial' as DependencyMode, gate };
  });
}

/**
 * Chooses the graph for a new task.
 *
 * A single registered graph is unambiguous; with several graphs the caller must
 * say which one, and a project without graphs must register one first.
 */
export function resolveTargetGraph(
  manifest: ProjectManifest,
  requested: string | undefined,
): string {
  const wanted = requested?.trim();
  if (wanted !== undefined && wanted.length > 0) {
    if (!manifest.graphs.some((graph) => graph.id === wanted)) {
      throw new TaskGraphError('E_UNKNOWN_TASK_GRAPH', `Graph "${wanted}" is not registered`, [
        `Registered graphs: ${
          manifest.graphs.map((graph) => graph.id).join(', ') || '(none)'
        }`,
      ]);
    }
    return wanted;
  }
  if (manifest.graphs.length === 0) {
    throw new TaskGraphError('E_NO_GRAPH', 'This project has no graph yet', [
      'Run `task-graph graph add --title <title> --entry` first.',
    ]);
  }
  if (manifest.graphs.length > 1) {
    throw new TaskGraphError('E_GRAPH_AMBIGUOUS', 'Several graphs exist; say where the task belongs', [
      `Pass --graph <id>. Registered graphs: ${manifest.graphs
        .map((graph) => graph.id)
        .join(', ')}`,
    ]);
  }
  return manifest.graphs[0]!.id;
}

function requireTask(task: TaskDocument | undefined, id: string): TaskDocument {
  if (!task) {
    throw new TaskGraphError('E_NO_TASK', `Task "${id}" was not found`);
  }
  return task;
}

function reloadTask(root: string, id: string): TaskDocument {
  const task = loadTaskRepository(root).taskById(id);
  return requireTask(task, id);
}

function timestamp(options: ClockOptions): string {
  return toIsoTimestamp(options.now ? options.now() : new Date());
}

export type { TaskStatus };
