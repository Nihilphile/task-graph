import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TaskGraphError } from './errors.js';
import { buildProject } from './build.js';
import { nextGraphId } from './graphs.js';
import { requireContent, withDocument } from './documents.js';
import { readProjectManifest, serializeProjectManifest } from './project.js';
import { loadTaskRepository, formatTaskId, taskIdNumber } from './repo.js';
import { createTaskDocument, historyEntry, serializeTaskDocument, type TaskDocument, type TaskDependency } from './task.js';
import { resolveTargetGraph, parseDependencySpecs, type AddTaskOptions } from './taskops.js';
import { timestampOf } from './mutate.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';
import { recordWatchResult } from './watch.js';

export interface PlannedTask extends AddTaskOptions {
  readonly completionRequires?: readonly string[];
  readonly exposes?: Readonly<Record<string, readonly string[]>>;
}

export function addPlannedTasks(root: string, inputs: readonly PlannedTask[]): { tasks: TaskDocument[]; keys: Record<string, string> } {
  if (!inputs.length) throw new TaskGraphError('E_PLAN', 'A plan must contain at least one task');
  const ids: string[] = [];
  const keys: Record<string, string> = Object.create(null) as Record<string, string>;
  runProjectTransaction(root, (transaction) => {
    let manifest = readProjectManifest(root);
    const repository = loadTaskRepository(root);
    const tasks = new Map(repository.tasks.map((task) => [task.id, task]));
    const keysInBatch = new Set<string>();
    const pending = new Map<string, PlannedTask>();
    const fingerprints = new Map<string, string>();
    const dirty = new Set<string>();
    let sequence = taskIdNumber(repository.nextTaskId())!;
    for (const task of repository.tasks) if (task.key) {
      if (keys[task.key]) throw new TaskGraphError('E_DUP_KEY', `Duplicate task key "${task.key}"`);
      keys[task.key] = task.id;
    }
    for (const input of inputs) {
      const summary = (input.summary ?? input.title ?? '').trim();
      if (!summary) throw new TaskGraphError('E_TASK_TITLE', 'A task summary is required');
      if (input.summary !== undefined && input.title !== undefined && input.summary !== input.title) throw new TaskGraphError('E_PLAN', 'Use one summary; --title is a legacy alias');
      if (input.parentTask && input.graph) throw new TaskGraphError('E_PLAN', 'Use either graph or parent_task for task placement');
      const { actor: _actor, now: _now, ...request } = input;
      const fingerprint = createHash('sha256').update(JSON.stringify(stable(request))).digest('hex');
      const key = input.key?.trim();
      if (key !== undefined && (!key || keysInBatch.has(key))) throw new TaskGraphError('E_DUP_KEY', `Duplicate or empty plan key "${key}"`);
      if (key) keysInBatch.add(key);
      const previous = key ? tasks.get(keys[key] ?? '') : undefined;
      if (previous) {
        if (previous.creationFingerprint !== fingerprint) throw new TaskGraphError('E_KEY_CONFLICT', `Key "${key}" already belongs to ${previous.id} with different creation parameters`, ['Use task revise for an existing task.']);
        ids.push(previous.id);
        continue;
      }
      const id = formatTaskId(sequence++);
      ids.push(id);
      if (key) keys[key] = id;
      pending.set(id, input);
      fingerprints.set(id, fingerprint);
    }
    const resolveId = (value: string): string => {
      if (!value.startsWith('@')) return value;
      const id = keys[value.slice(1)];
      if (!id) throw new TaskGraphError('E_PLAN_REFERENCE', `Unknown task key "${value}"`);
      return id;
    };
    const placing = new Set<string>();
    const create = (id: string): TaskDocument => {
      const existing = tasks.get(id);
      if (existing) return existing;
      const input = pending.get(id);
      if (!input) throw new TaskGraphError('E_NO_TASK', `Task "${id}" was not found`);
      if (placing.has(id)) throw new TaskGraphError('E_PLAN_PARENT_CYCLE', `Cyclic parent relationship at ${id}`);
      placing.add(id);
      let graph: string;
      let parent: TaskDocument | undefined;
      if (input.parentTask) {
        parent = create(resolveId(input.parentTask));
        if (parent.status === 'done' || parent.status === 'cancelled') throw new TaskGraphError('E_TASK_TRANSITION', `Reopen or replace ${parent.id} before adding child work`);
        if (!parent.subgraph) {
          graph = nextGraphId(manifest);
          manifest = { ...manifest, graphs: [...manifest.graphs, { id: graph, title: parent.title }] };
          parent = { ...parent, subgraph: { graph, completionRequires: [], exposes: [] } };
        } else graph = parent.subgraph.graph;
        parent = { ...parent, subgraph: { ...parent.subgraph!, completionRequires: [...parent.subgraph!.completionRequires, id] } };
        tasks.set(parent.id, parent);
        dirty.add(parent.id);
      } else graph = resolveTargetGraph(manifest, input.graph);
      const title = (input.summary ?? input.title)!.trim();
      const content = input.content === undefined ? undefined : requireContent(root, input.content);
      const compact = input.summary !== undefined || content !== undefined;
      const document = createTaskDocument({ id, graph, title, goal: input.goal, completionConditions: input.completionConditions, workLog: input.workLog });
      const dependencies = [...(input.dependsOn ?? []), ...parseDependencySpecs(input.dependsOnSpecs ?? [])].map((dep) => ({ ...dep, task: resolveId(dep.task) }));
      let created: TaskDocument = { ...document,
        ...(input.planning ? { planning: input.planning } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(compact ? { summary: title, body: input.goal !== undefined || input.completionConditions?.length || input.workLog?.length ? document.body : `# ${title}\n` } : {}),
        ...(content ? { content } : {}),
        ...(input.key ? { key: input.key.trim(), creationFingerprint: fingerprints.get(id)! } : {}),
        ...(input.manualBlockers?.length ? { status: 'blocked' as const, blockedFrom: 'todo' as const } : {}),
        dependsOn: dependencies, manualBlockers: [...(input.manualBlockers ?? [])], derivedFrom: [...(input.derivedFrom ?? [])],
        history: [historyEntry('created', timestampOf(input.now), input.actor ?? null, { graph })],
      };
      for (const file of input.contentFiles ?? []) created = withDocument(root, created, transaction, { ...input, id, path: file, kind: 'content' });
      if (created.status === 'blocked') created = { ...created, history: [...created.history, historyEntry('blocked', timestampOf(input.now), input.actor ?? null, { from: 'todo', to: 'blocked', reason: created.manualBlockers.join('; ') })] };
      tasks.set(id, created);
      dirty.add(id);
      placing.delete(id);
      return created;
    };
    for (const id of pending.keys()) create(id);
    for (const [id, input] of pending) {
      if (input.completionRequires === undefined && input.exposes === undefined) continue;
      const task = tasks.get(id)!;
      if (!task.subgraph) throw new TaskGraphError('E_TASK_SUBGRAPH', `${id} needs child tasks before declaring completion points`);
      tasks.set(id, { ...task, subgraph: { ...task.subgraph,
        completionRequires: input.completionRequires?.map(resolveId) ?? task.subgraph.completionRequires,
        exposes: input.exposes ? Object.entries(input.exposes).map(([name, requires]) => ({ name, requires: requires.map(resolveId) })) : task.subgraph.exposes,
      } });
    }
    for (const id of dirty) transaction.write(`.task-graph/tasks/${id}.md`, serializeTaskDocument(tasks.get(id)!));
    if (manifest.graphs.length !== repository.manifest.graphs.length) transaction.write('.task-graph/project.yaml', serializeProjectManifest(manifest));
    for (const id of pending.keys()) {
      const task = tasks.get(id)!;
      if (task.status === 'blocked') recordWatchResult(root, task, transaction, 'blocked', { manifest, tasks: [...tasks.values()] });
    }
  }, { validate: () => assertRepositoryValid(root) });
  buildProject(root);
  const repository = loadTaskRepository(root);
  return { tasks: ids.map((id) => repository.taskById(id)!), keys: Object.fromEntries(inputs.flatMap((input, i) => input.key ? [[input.key, ids[i]!]] : [])) };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

/** Parse the batch boundary strictly so malformed plans fail before any write. */
export function readTaskPlan(file: string): PlannedTask[] {
  let plan: unknown;
  try { plan = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new TaskGraphError('E_PLAN', `Cannot read JSON plan "${file}"`, [String(error)]); }
  const object = record(plan, 'plan');
  for (const field of Object.keys(object)) if (!['graph', 'tasks'].includes(field)) throw new TaskGraphError('E_PLAN', `Unknown plan field "${field}"`);
  if (!Array.isArray(object['tasks'])) throw new TaskGraphError('E_PLAN', 'plan.tasks must be an array');
  const defaultGraph = optionalString(object['graph'], 'plan.graph');
  return object['tasks'].map((raw, index) => {
    const task = record(raw, `tasks[${index}]`);
    const allowed = ['key', 'summary', 'title', 'content', 'planning', 'kind', 'graph', 'parent_task', 'depends_on', 'manual_blockers', 'derived_from', 'completion_requires', 'exposes'];
    for (const field of Object.keys(task)) if (!allowed.includes(field)) throw new TaskGraphError('E_PLAN', `Unknown tasks[${index}] field "${field}"`);
    const parentTask = optionalString(task['parent_task'], 'parent_task');
    const dependencies = task['depends_on'] ?? [];
    if (!Array.isArray(dependencies)) throw new TaskGraphError('E_PLAN', 'depends_on must be an array');
    const dependsOn: TaskDependency[] = dependencies.map((dep) => {
      if (typeof dep === 'string') return parseDependencySpecs([dep])[0]!;
      const entry = record(dep, 'depends_on entry');
      const target = optionalString(entry['task'], 'depends_on.task');
      if (!target) throw new TaskGraphError('E_PLAN', 'A dependency needs a task');
      const gate = optionalString(entry['gate'], 'depends_on.gate');
      const mode = optionalString(entry['mode'], 'depends_on.mode') ?? (gate ? 'partial' : 'full');
      if (mode !== 'full' && mode !== 'partial') throw new TaskGraphError('E_PLAN', 'Dependency mode must be full or partial');
      return { task: target, mode, ...(gate ? { gate } : {}) };
    });
    const exposed = task['exposes'] === undefined ? undefined : record(task['exposes'], 'exposes');
    return {
      key: optionalString(task['key'], 'key'), summary: optionalString(task['summary'], 'summary'), title: optionalString(task['title'], 'title'),
      planning: choice(task['planning'], ['static', 'dynamic'] as const, 'planning'),
      kind: choice(task['kind'], ['work', 'acceptance', 'decision'] as const, 'kind'),
      ...planContents(task['content']), graph: optionalString(task['graph'], 'graph') ?? (parentTask ? undefined : defaultGraph), parentTask, dependsOn,
      manualBlockers: strings(task['manual_blockers'] ?? [], 'manual_blockers'), derivedFrom: strings(task['derived_from'] ?? [], 'derived_from'),
      ...(task['completion_requires'] === undefined ? {} : { completionRequires: strings(task['completion_requires'], 'completion_requires') }),
      ...(exposed === undefined ? {} : { exposes: Object.fromEntries(Object.entries(exposed).map(([name, value]) => [name, strings(Array.isArray(value) ? value : record(value, name)['requires'], `exposes.${name}.requires`)])) }),
    };
  });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskGraphError('E_PLAN', `${field} must be an object`);
  return value as Record<string, unknown>;
}
export function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new TaskGraphError('E_PLAN', `${field} must be ${choices.join('|')}`);
  return value as T;
}
function planContents(value: unknown): { content?: string; contentFiles?: readonly string[] } {
  if (!Array.isArray(value)) return { content: optionalString(value, 'content') };
  const files = strings(value, 'content');
  if (!files.length) throw new TaskGraphError('E_PLAN', 'content must contain at least one file');
  return { content: files[0]!, ...(files.length > 1 ? { contentFiles: files.slice(1) } : {}) };
}
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TaskGraphError('E_PLAN', `${field} must be a non-empty string`);
  return value.trim();
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new TaskGraphError('E_PLAN', `${field} must be an array of non-empty strings`);
  return value.map((item: string) => item.trim());
}
