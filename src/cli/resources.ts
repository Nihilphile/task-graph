import { existsSync } from 'node:fs';
import { errorBookEntries } from '../core/error-book.js';
import path from 'node:path';
import { parseArgs, type ParsedArgs } from './args.js';
import type { CliContext, CommandSpec } from './context.js';
import { resolveCwd } from './paths.js';
import { usageError } from '../core/errors.js';
import { loadTaskRepository, type TaskRepository } from '../core/repo.js';
import { taskContext } from '../core/task-context.js';
import { computeReadiness } from '../core/readiness.js';

export interface ResourceAddress {
  address: string;
  type: string;
  graph?: string;
  task?: string;
  originGraph?: string;
  parents?: readonly string[];
}

export function taskAddress(graph: string, task: string): string {
  return `${graphAddress(graph)}.task[${task}]`;
}

function graphAddress(graph: string): string {
  return `graph[${encodeURIComponent(graph).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}]`;
}

/** A deliberately small address grammar, never evaluated as JavaScript. */
export function parseResource(address: string): ResourceAddress {
  if (['.', 'graph', 'task', 'source', 'github', 'skill', 'errorbook'].includes(address)) return { address, type: address };
  const invalid = (): never => {
    throw usageError(`Invalid resource address "${address}"`, ["Use 'graph[G-001].task[T-0001]' or run task-graph . describe."]);
  };
  const head = /^(?:graph\[([^\[\]\r\n]+)\](\.task(?:\[(T-\d{4,})\])?)?|task\[(T-\d{4,})\])/.exec(address);
  if (!head) return invalid();
  let graph: string | undefined;
  try { graph = head[1] === undefined ? undefined : decodeURIComponent(head[1]); }
  catch { throw usageError('Invalid percent encoding in graph selector. Use the address returned by graph list.'); }
  if (graph !== undefined && !graph.trim()) throw usageError('Graph selector cannot be empty.');
  let task = head[3] ?? head[4];
  let type = task ? 'task-item' : head[2] ? 'task' : 'graph-item';
  let tail = address.slice(head[0].length);
  const parents: string[] = [];
  while (tail.startsWith('.subgraph.task')) {
    if (!task) return invalid();
    const hop = /^\.subgraph\.task(?:\[(T-\d{4,})\])?/.exec(tail)!;
    parents.push(task);
    task = hop[1];
    type = task ? 'task-item' : 'task';
    tail = tail.slice(hop[0].length);
  }
  if (tail) {
    if (type === 'graph-item' && tail === '.watch') type = 'watch';
    else if (type === 'graph-item' && tail === '.errorbook') type = 'errorbook';
    else if (task && /^\.(content|report|reference|log|handoff|output|dependency|subgraph)$/.test(tail)) type = tail.slice(1);
    else return invalid();
  }
  const canonical = graph === undefined ? address : graphAddress(graph) + address.slice(address.indexOf(']') + 1);
  return { address: canonical, graph, originGraph: graph, task, parents, type };
}

interface Route { action: string; command?: CommandSpec; fixed?: string[]; summary: string; }

// Kept separate from legacy parsing so old scripts retain their accepted syntax.
// `status` is a value on task lists and a switch on graph watch.
function validateOptionValues(raw: readonly string[], route: Route): void {
  const booleans = new Set(['all', 'available', 'flush', 'allow-duplicate', 'needs-refinement', 'handoff', 'manifest',
    'preview', 'snapshot', 'gh', 'dry-run', 'entry', 'force', 'help', 'json', 'offline', 'quiet', 'reopen', 'replace', 'strict', 'takeover', 'verbose']);
  if (route.command?.name === 'graph watch') booleans.add('status');
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!;
    if (token === '--') break;
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const name = token.slice(2, eq < 0 ? undefined : eq);
    if (booleans.has(name)) {
      if (eq >= 0 && !['true', 'false'].includes(token.slice(eq + 1))) throw usageError(`--${name} accepts true or false.`);
    } else if (eq < 0) {
      if (raw[i + 1] === undefined || raw[i + 1]!.startsWith('--')) throw usageError(`--${name} requires a value.`);
      i++;
    } else if (token.slice(eq + 1).length === 0) throw usageError(`--${name} requires a value.`);
  }
}

/** Routing and discovery share the existing semantic command definitions. */
function routes(resource: ResourceAddress, commands: readonly CommandSpec[]): Route[] {
  const result: Route[] = [];
  const add = (action: string, name: string, fixed?: string[]) => {
    const command = commands.find(c => c.name === name);
    if (command) result.push({ action, command, fixed, summary: command.summary });
  };
  const read = (action: string, summary: string) => result.push({ action, summary });
  switch (resource.type) {
    case 'errorbook': read('list', 'List appended failure report snapshots'); read('show', 'Read failure reports in chronological order'); break;
    case '.':
      for (const action of ['init', 'validate', 'build']) add(action, action);
      break;
    case 'graph': add('add', 'graph add'); read('list', 'List graphs and their resource addresses'); break;
    case 'graph-item':
      read('show', 'Show graph registration, parent and task addresses');
      for (const action of ['watch', 'unwatch', 'publish']) add(action, `graph ${action}`);
      break;
    case 'task':
      for (const action of ['add', 'list']) add(action, `task ${action}`);
      break;
    case 'task-item':
      for (const command of commands) {
        const words = command.name.split(' ');
        if (words.length === 2 && words[0] === 'task' && !['add', 'list', 'log'].includes(words[1]!)) add(words[1]!, command.name);
      }
      break;
    case 'watch':
      add('add', 'graph watch'); add('remove', 'graph unwatch');
      add('status', 'graph watch', ['--status']); add('flush', 'graph watch', ['--flush']);
      add('retry', 'graph watch');
      break;
    case 'dependency':
      read('list', 'List direct dependencies with source addresses');
      add('add', 'task link'); add('remove', 'task unlink'); break;
    case 'subgraph': read('show', 'Show the child graph address and completion contract'); break;
    case 'source': add('add', 'source add'); break;
    case 'github': add('sync', 'github sync'); break;
    case 'skill': add('validate', 'skill validate'); break;
    default:
      read('list', 'List agent-visible file pointers, summaries and provenance; no bodies');
      for (const command of commands) {
        const prefix = `task ${resource.type} `;
        if (command.name.startsWith(prefix)) add(command.name.slice(prefix.length), command.name);
      }
      if (resource.type === 'log') add('add', 'task log');
  }
  return result;
}

function children(resource: ResourceAddress): string[] {
  if (resource.type === '.') return ['graph', 'task', 'source', 'github', 'skill', 'errorbook'];
  if (resource.type === 'graph') return ['graph[G-NNN]'];
  if (resource.type === 'graph-item') return [`${resource.address}.task`, `${resource.address}.watch`, `${resource.address}.errorbook`];
  if (resource.type === 'task') return [resource.address !== 'task' ? `${resource.address}[T-NNNN]` : 'graph[G-NNN].task[T-NNNN]'];
  if (resource.type === 'subgraph') return [`${resource.address}.task`];
  if (resource.type === 'task-item') return ['content', 'reference', 'report', 'log', 'handoff', 'output', 'dependency', 'subgraph'].map(k => `${resource.address}.${k}`);
  return [];
}

interface Inspection { repository?: TaskRepository; resource: ResourceAddress; exists: boolean; reason?: string; actual_resource?: string; }

function inspect(root: string, resource: ResourceAddress, required: boolean): Inspection {
  const fail = (reason: string, repository?: TaskRepository, actual_resource?: string): Inspection => {
    if (required) throw usageError(reason, actual_resource ? [`Use '${actual_resource}'.`] : []);
    return { repository, resource, exists: false, reason, actual_resource };
  };
  if (!existsSync(path.join(root, '.task-graph', 'project.yaml'))) {
    return fail('Project is not initialized. Use task-graph . init --name <name>; describe is read-only.');
  }
  const repository = loadTaskRepository(root);
  let graph = resource.originGraph;
  if (graph && !repository.manifest.graphs.some(g => g.id === graph)) return fail(`Unknown graph "${graph}"`, repository);
  const ids = [...(resource.parents ?? []), ...(resource.task ? [resource.task] : [])];
  for (let index = 0; index < ids.length; index++) {
    const task = repository.taskById(ids[index]!)!;
    if (!task) return fail(`Unknown task "${ids[index]}"`, repository);
    graph ??= task.graph;
    if (task.graph !== graph) return fail(`${task.id} belongs to ${graphAddress(task.graph)}, not ${graphAddress(graph)}`, repository, taskAddress(task.graph, task.id));
    if (index < (resource.parents?.length ?? 0)) {
      if (!task.subgraph) return fail(`${taskAddress(task.graph, task.id)} has no subgraph. Create or attach one explicitly.`, repository);
      graph = task.subgraph.graph;
      if (!repository.manifest.graphs.some(g => g.id === graph)) return fail(`Unknown subgraph "${graph}"`, repository);
    }
  }
  return { repository, resource: { ...resource, graph }, exists: true };
}

function emit(ctx: CliContext, args: ParsedArgs, data: Record<string, unknown>, text?: string): void {
  if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, ...data }, null, 2));
  else if (!args.flag('quiet')) ctx.io.out(text ?? JSON.stringify(data, null, 2));
}

function describe(resource: ResourceAddress, choices: Route[], root: string, ctx: CliContext, args: ParsedArgs): void {
  const inspection = inspect(root, resource, false);
  const { repository, exists } = inspection;
  resource = inspection.resource;
  const task = resource.task ? repository?.taskById(resource.task) : undefined;
  const readiness = task && exists ? computeReadiness(repository!).get(task.id) : undefined;
  const actions = choices.map(route => ({ action: route.action, summary: route.summary,
    usage: route.command ? resourceUsage(resource, route) : `task-graph '${resource.address}' ${route.action} [--cwd <dir>] [--json]`,
    ...(route.command?.details ? { notes: route.command.details } : {}) }));
  const data = { resource: resource.address, exists, resource_type: resource.type,
    ...(task && exists ? { state: { status: task.status, claim: task.claim, ...readiness } } : {}),
    ...(inspection.actual_resource ? { actual_resource: inspection.actual_resource } : {}),
    operations: [...choices.map(r => r.action), 'describe'], children: children(resource), actions,
    preconditions: ['State, claims, dependencies and refinement are checked again when an action runs.',
      'A ready task is not necessarily unclaimed or pending. Inspect status and claim before dispatch.',
      'Dynamic tasks require current refinement before start; completed dependencies do not refine them automatically.'],
    ...(!exists ? { reason: inspection.reason } : {}) };
  emit(ctx, args, data, [`Resource: ${resource.address} (${exists ? 'exists' : 'not found'})`,
    ...(readiness ? [`State: ${task!.status}; ${readiness.readiness}; planning: ${readiness.planningState ?? 'static'}`, `Blockers: ${JSON.stringify(readiness.blockedBy)}`] : []),
    ...actions.flatMap(a => [`${a.action}: ${a.summary}`, `  ${a.usage}`]),
    `Children: ${data.children.join(', ') || 'none'}`, ...data.preconditions,
    'Use --json for complete notes and state.'].join('\n'));
}

function resourceUsage(resource: ResourceAddress, route: Route): string {
  if (resource.type === 'watch') {
    const input = route.action === 'add' || route.action === 'remove' ? ' --thread <UUID>' : route.action === 'retry' ? ' <event-id> [--allow-duplicate]' : '';
    return `task-graph '${resource.address}' ${route.action}${input} [--cwd <dir>] [--json]`;
  }
  let suffix = route.command!.usage.slice(`task-graph ${route.command!.name}`.length);
  if (resource.task) suffix = suffix.replace(/^ T-NNNN/, '');
  else if (resource.type === 'graph-item' || resource.type === 'watch') suffix = suffix.replace(/^ G-NNN/, '');
  if (resource.type === 'task' && resource.graph) suffix = suffix.replace(' [--graph G-NNN | --parent-task T-NNNN]', '').replace(' [--graph G-NNN]', '');
  return `task-graph '${resource.address}' ${route.action}${suffix}`;
}

function query(resource: ResourceAddress, repository: TaskRepository, root: string, action: string): Record<string, unknown> {
  const address = resource.address;
  if (resource.type === 'errorbook') return { resource: address, project_root: root, entries: errorBookEntries(repository, resource.graph, action === 'show') };
  if (resource.type === 'graph') return { resource: address, graphs: repository.manifest.graphs.map(g => ({ ...g, resource: graphAddress(g.id), entry: repository.manifest.entryGraphs.includes(g.id) })) };
  if (resource.type === 'graph-item') {
    const graph = repository.manifest.graphs.find(g => g.id === resource.graph)!;
    const parent = repository.tasks.find(t => t.subgraph?.graph === graph.id);
    return { resource: address, graph, parent: parent ? taskAddress(parent.graph, parent.id) : null,
      tasks: repository.tasksInGraph(graph.id).map(t => ({ id: t.id, resource: taskAddress(t.graph, t.id), summary: t.title, status: t.status })) };
  }
  const task = repository.taskById(resource.task!)!;
  if (resource.type === 'dependency') return { resource: address, dependencies: task.dependsOn.map(d => {
    const source = repository.taskById(d.task)!;
    return { ...d, resource: taskAddress(source.graph, source.id), status: source.status };
  }) };
  if (resource.type === 'subgraph') return { resource: address, subgraph: task.subgraph ? { ...task.subgraph, resource: graphAddress(task.subgraph.graph) } : null };
  const context = taskContext(root, task, repository);
  const groups: Record<string, typeof context.contents> = { content: context.contents, reference: context.references, report: context.reports,
    log: context.logs, handoff: context.handoffs, output: context.outputs };
  const files = groups[resource.type]!;
  return { resource: address, project_root: context.project_root, files: files.map(file => {
    const source = file.source_task ? repository.taskById(file.source_task) : undefined;
    return { ...file, ...(source ? { source_resource: taskAddress(source.graph, source.id) } : {}) };
  }), excluded: context.excluded.filter(f => f.kind === resource.type) };
}

export interface ResourceInvocation { argv: string[]; resource: ResourceAddress; scopedGraph?: string; }

/** Returns undefined for a legacy spelling, null for a completed read-only request. */
export function prepareResource(argv: readonly string[], ctx: CliContext, commands: readonly CommandSpec[]): ResourceInvocation | null | undefined {
  const first = argv[0] ?? '';
  const resourceSyntax = first === '.' || first === 'errorbook' || first.includes('[') || first.includes(']') || first.startsWith('graph.')
    || (['graph', 'task', 'source', 'github', 'skill'].includes(first) && ['describe', '--help', '-h'].includes(argv[1] ?? ''))
    || (first === 'graph' && argv[1] === 'list');
  if (!resourceSyntax) return undefined;
  let resource = parseResource(first);
  const choices = routes(resource, commands);
  const help = ['--help', '-h'].includes(argv[1] ?? '');
  const action = help ? 'describe' : argv[1] ?? 'describe';
  const args = parseArgs(argv.slice(help ? 1 : 2), 0);
  const root = resolveCwd(ctx, args);
  const route = choices.find(r => r.action === action);
  if (action === 'describe' || (args.flag('help') && !route)) {
    validateOptionValues(argv.slice(help ? 1 : 2), { action: 'describe', summary: '' });
    if (args.positionals.length || [...args.options.keys()].some(k => !['json', 'cwd', 'quiet', 'help'].includes(k))) throw usageError('describe accepts only --cwd, --json, --quiet and --help.');
    describe(resource, choices, root, ctx, args); return null;
  }
  if (!route) throw usageError(`Unsupported action "${action}" on ${resource.address}`, [
    `Supported: ${choices.map(r => r.action).join(', ')}, describe`, `Run task-graph '${resource.address}' describe.`]);
  validateOptionValues(argv.slice(2), route);
  if (args.flag('help')) {
    emit(ctx, args, { resource: resource.address, action, usage: route.command ? resourceUsage(resource, route) : `task-graph '${resource.address}' ${action}`, notes: route.command?.details ?? [] });
    return null;
  }
  const inspection = action === 'init' ? undefined : inspect(root, resource, true);
  if (inspection) resource = inspection.resource;
  const repository = inspection?.repository;
  if (!route.command) {
    if (args.positionals.length || [...args.options.keys()].some(k => !['json', 'cwd', 'quiet'].includes(k))) throw usageError('This query accepts only --cwd, --json and --quiet.');
    emit(ctx, args, query(resource, repository!, root, action)); return null;
  }
  const options = new Map([...args.options].map(([key, values]) => [key, [...values]]));
  const allowed = new Set([...route.command.usage.matchAll(/--([a-z][a-z-]*)/g)].map(m => m[1]!));
  for (const key of ['cwd', 'json', 'quiet', 'help']) allowed.add(key);
  if (route.command.name === 'task add') for (const key of ['title', 'goal', 'condition', 'work-log', 'blocker', 'derived-from']) allowed.add(key);
  for (const key of options.keys()) if (!allowed.has(key)) throw usageError(`Unknown option --${key} for ${resource.address} ${action}`, [`Run task-graph '${resource.address}' ${action} --help.`]);
  for (const key of ['cwd', 'graph', 'from']) if ((options.get(key)?.length ?? 0) > 1) throw usageError(`Pass --${key} only once.`);
  const set = (name: string, value: string) => {
    if (options.has(name) && options.get(name)!.some(v => v !== value)) throw usageError(`--${name} conflicts with resource ${resource.address}`);
    options.set(name, [value]);
  };
  if (resource.type === 'task' && resource.graph) {
    set('graph', resource.graph);
    if (options.has('parent-task')) throw usageError('A graph-scoped task collection cannot use --parent-task. Use task add --parent-task for child creation.');
  }
  let positionals = [...args.positionals];
  if (resource.type === 'log' && action === 'add' && positionals.length === 1) { set('text', positionals[0]!); positionals = []; }
  if (resource.type === 'dependency' && ['add', 'remove'].includes(action) && positionals.length === 1) { set('depends-on', positionals[0]!); positionals = []; }
  if (resource.type === 'watch' && action === 'retry' && positionals.length === 1) { set('retry', positionals[0]!); positionals = []; }
  if (positionals.length) throw usageError('Unexpected positional arguments. The target is already selected by the resource address.');
  if (['task link', 'task unlink'].includes(route.command.name) && (options.get('depends-on')?.length ?? 0) > 1) {
    throw usageError('Add or remove one dependency per operation. Task creation accepts repeated --depends-on.');
  }
  if (resource.type === 'watch') {
    const expected = action === 'add' || action === 'remove' ? 'thread' : action;
    for (const flag of ['thread', 'status', 'flush', 'retry']) if (flag !== expected && options.has(flag)) throw usageError(`Use ${resource.address} ${flag === 'thread' ? 'add' : flag} for --${flag}.`);
  }
  // Full dependency addresses are checked, then normalized to the existing ID contract.
  if (options.has('depends-on')) options.set('depends-on', options.get('depends-on')!.map(value => {
    if (!value.startsWith('graph[') && !value.startsWith('task[')) return value;
    const [address, ...gate] = value.split(':');
    const target = parseResource(address!);
    if (target.type !== 'task-item' || gate.length > 1) throw usageError('A dependency must address one task, optionally followed by :gate.');
    inspect(root, target, true);
    if (gate.length && route.command!.name !== 'task add') {
      set('gate', gate[0]!);
      return target.task!;
    }
    return target.task! + (gate.length ? `:${gate[0]}` : '');
  }));
  const target = resource.task ?? (['graph-item', 'watch'].includes(resource.type) ? resource.graph : undefined);
  const translated = [...route.command.name.split(' '), ...(target ? [target] : []), ...(route.fixed ?? []),
    ...[...options].flatMap(([key, values]) => values.map(value => `--${key}=${value}`))];
  return { argv: translated, resource, ...(resource.type === 'task' && resource.graph ? { scopedGraph: resource.graph } : {}) };
}

/** New responses carry copyable addresses without changing legacy response shapes. */
export function resourceOutput(text: string, invocation: ResourceInvocation, root: string): string {
  const data = JSON.parse(text);
  if (!data.ok) return text;
  let repository: TaskRepository | undefined;
  const withAddress = (task: Record<string, unknown>) => {
    if (typeof task.id !== 'string') return task;
    const graph = typeof task.graph === 'string' ? task.graph : (repository ??= loadTaskRepository(root)).taskById(task.id)?.graph;
    return graph ? { ...task, resource: taskAddress(graph, task.id) } : task;
  };
  return JSON.stringify({ ...data, resource: invocation.resource.address,
    ...(data.graph?.id ? { graph: { ...data.graph, resource: graphAddress(data.graph.id) } } : {}),
    ...(data.task ? { task: withAddress(data.task) } : {}),
    ...(Array.isArray(data.tasks) ? { tasks: data.tasks.map(withAddress) } : {}) }, null, 2);
}
