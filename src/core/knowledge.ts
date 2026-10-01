import path from 'node:path';
import { contractBinding } from './contract-sections.js';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildProject } from './build.js';
import { documentPath, readDocument, snapshotDocument } from './documents.js';
import { TaskGraphError } from './errors.js';
import { assertPlanMutable } from './refinement.js';
import { loadTaskRepository } from './repo.js';
import { createTaskDocument, historyEntry, serializeTaskDocument, type TaskDocument } from './task.js';
import { runProjectTransaction, type ProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';
import { timestampOf, type ClockOptions } from './mutate.js';
import { assertCodeReference, nextKnowledgeId, readKnowledge, writeKnowledge, type ContractNode, type CodeReference, type KnowledgeStore } from './knowledge-store.js';

/** State is already committed here. A failed view build is safe to retry alone. */
export function refreshKnowledgeView(root: string) {
  try { buildProject(root); return { status: 'refreshed' as const }; }
  catch (error) { return { status: 'failed' as const, error: String(error), retry: { resource: '.', action: 'build', cwd: root } }; }
}
function checkedBody(root: string, options: { text?: string; file?: string }): string {
  if ((options.text === undefined) === (options.file === undefined)) throw new TaskGraphError('E_CONTRACT_INPUT', 'Pass exactly one of --text or --file');
  const body = options.text ?? readDocument(root, documentPath(options.file!)).toString('utf8');
  if (!body.trim()) throw new TaskGraphError('E_CONTRACT_INPUT', 'Contract text cannot be blank');
  return body;
}
function requireContract(store: KnowledgeStore, id: string): ContractNode {
  const c = store.contracts.find(c => c.id === id);
  if (!c) throw new TaskGraphError('E_NO_CONTRACT', `Unknown contract ${id}`);
  return c;
}
function writeBinding(tx: ProjectTransaction, task: TaskDocument, kind: 'contracts' | 'references', id: string, remove: boolean, options: ClockOptions): void {
  const before = task[kind] ?? [];
  const after = remove ? before.filter(v => v !== id) : [...new Set([...before, id])];
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (['pending_review', 'reviewing'].includes(task.status) || task.blockedFrom === 'pending_review') throw new TaskGraphError('E_REVIEW_ACTIVE', 'Task inputs are fixed during review');
  const next = { ...task, [kind]: after, history: [...task.history, historyEntry(`${kind === 'contracts' ? 'contract' : 'reference'}_${remove ? 'removed' : 'attached'}`, timestampOf(options.now), options.actor ?? null, { id })] };
  assertPlanMutable(task, next);
  tx.write(`.task-graph/tasks/${task.id}.md`, serializeTaskDocument(next));
}

export function saveContract(root: string, options: ClockOptions & { id?: string; graph?: string; title?: string; text?: string; file?: string; tasks?: readonly string[]; references?: readonly string[] }) {
  const contract = runProjectTransaction(root, tx => {
    const repo = loadTaskRepository(root), store = readKnowledge(root);
    const old = options.id ? requireContract(store, options.id) : undefined;
    const graph = old?.graph ?? options.graph;
    if (!graph || !repo.manifest.graphs.some(g => g.id === graph)) throw new TaskGraphError('E_CONTRACT_GRAPH', 'Pass an existing --graph for a new contract');
    const title = options.title?.trim() ?? old?.title;
    if (!title) throw new TaskGraphError('E_CONTRACT_TITLE', 'Pass --title for a new contract');
    const id = old?.id ?? nextKnowledgeId('C', store.contracts);
    const body = checkedBody(root, options);
    const file = old?.file ?? (options.file ? documentPath(options.file) : `.task-graph/contracts/${id}.md`);
    if (!/\.(md|markdown)$/i.test(file) || store.contracts.some(c => c.file === file && c.id !== id)) throw new TaskGraphError('E_CONTRACT_FILE', 'Each contract owns one distinct Markdown file');
    const references = options.references ? [...new Set(options.references)] : old?.references ?? [];
    for (const ref of references) if (!store.references.some(r => r.id === ref)) throw new TaskGraphError('E_REFERENCE', `Unknown reference ${ref}`);
    const result: ContractNode = { id, graph, title, file, references, history: [...old?.history ?? [], { event: old ? 'updated' : 'created', at: timestampOf(options.now), actor: options.actor ?? null }] };
    store.contracts = [...store.contracts.filter(c => c.id !== id), result];
    for (const target of new Set(options.tasks ?? [])) {
      const task = repo.taskById(target);
      if (!task) throw new TaskGraphError('E_NO_TASK', `Unknown task ${target}`);
      writeBinding(tx, task, 'contracts', id, false, options);
    }
    tx.write(file, body); writeKnowledge(tx, store);
    return result;
  }, { validate: () => assertRepositoryValid(root) });
  return { saved: true, contract, view: refreshKnowledgeView(root) };
}

export function bindKnowledge(root: string, options: ClockOptions & { task?: string; contract?: string; kind: 'contracts' | 'references'; id: string; remove?: boolean }) {
  runProjectTransaction(root, tx => {
    const store = readKnowledge(root), repo = loadTaskRepository(root);
    const targetId = options.kind === 'contracts' ? contractBinding(options.id).id : options.id;
    if (!(options.kind === 'contracts' ? store.contracts : store.references).some(r => r.id === targetId)) throw new TaskGraphError('E_KNOWLEDGE_ID', `Unknown ${options.kind} ID ${options.id}`);
    if (options.task) {
      const task = repo.taskById(options.task);
      if (!task) throw new TaskGraphError('E_NO_TASK', `Unknown task ${options.task}`);
      writeBinding(tx, task, options.kind, options.id, !!options.remove, options);
    } else if (options.contract && options.kind === 'references') {
      const c = requireContract(store, options.contract);
      c.references = options.remove ? c.references.filter(r => r !== options.id) : [...new Set([...c.references, options.id])];
      c.history.push({ event: `reference_${options.remove ? 'removed' : 'attached'}:${options.id}`, at: timestampOf(options.now), actor: options.actor ?? null });
      writeKnowledge(tx, store);
    } else throw new TaskGraphError('E_KNOWLEDGE_TARGET', 'Select a task or contract');
  }, { validate: () => assertRepositoryValid(root) });
  return { saved: true, id: options.id, view: refreshKnowledgeView(root) };
}

export function saveCodeReference(root: string, options: ClockOptions & { id?: string; path: string; line: number; symbol: string; summary: string; task?: string; contract?: string }) {
  const reference = runProjectTransaction(root, tx => {
    const store = readKnowledge(root);
    const absolute = realpathSync(path.resolve(root, options.path));
    if (/\.(md|markdown|pdf|png|jpe?g|gif|webp)$/i.test(absolute)) throw new TaskGraphError('E_REFERENCE', 'Reference entries point to code/scripts; use a contract for prose');
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
    if (options.line > lines.length) throw new TaskGraphError('E_REFERENCE', 'The specified line is outside the file');
    const relative = path.relative(root, absolute);
    const file = (relative.startsWith('..') || path.isAbsolute(relative) ? absolute : relative).split(path.sep).join('/');
    const existing = options.id ? store.references.find(r => r.id === options.id) : store.references.find(r => r.path === file && r.symbol === options.symbol.trim());
    if (options.id && !existing) throw new TaskGraphError('E_REFERENCE', `Unknown reference ${options.id}`);
    const result: CodeReference = { id: existing?.id ?? nextKnowledgeId('R', store.references), path: file, line: options.line, symbol: options.symbol.trim(), summary: options.summary.trim() };
    assertCodeReference(result);
    if (!options.id && existing && JSON.stringify(existing) !== JSON.stringify(result)) throw new TaskGraphError('E_REFERENCE_EXISTS', `Reuse ${existing.id}, or explicitly update it`);
    if (store.references.some(r => r.id !== result.id && r.path === file && r.symbol === result.symbol)) throw new TaskGraphError('E_REFERENCE_EXISTS', 'This code entry already has a reference ID');
    store.references = [...store.references.filter(r => r.id !== result.id), result];
    if (options.task) {
      const task = loadTaskRepository(root).taskById(options.task);
      if (!task) throw new TaskGraphError('E_NO_TASK', `Unknown task ${options.task}`);
      writeBinding(tx, task, 'references', result.id, false, options);
    }
    if (options.contract) {
      const c = requireContract(store, options.contract);
      c.references = [...new Set([...c.references, result.id])];
    }
    writeKnowledge(tx, store); return result;
  }, { validate: () => assertRepositoryValid(root) });
  return { saved: true, reference, view: refreshKnowledgeView(root) };
}

/** One request, one state transaction, one view build. This records an already-made decision. */
export function recordDecision(root: string, options: ClockOptions & { key: string; title: string; graph: string; text?: string; file?: string; tasks: readonly string[]; contract?: string }) {
  const result = runProjectTransaction(root, tx => {
    const repo = loadTaskRepository(root), store = readKnowledge(root);
    const body = checkedBody(root, options);
    const targets = [...new Set(options.tasks)].sort();
    if (!options.key.trim() || !options.title.trim()) throw new TaskGraphError('E_DECISION', 'Pass a stable --key and --title');
    const request = createHash('sha256').update(JSON.stringify({ title: options.title, graph: options.graph, body, targets, contract: options.contract ?? null })).digest('hex');
    const previous = store.decisions.find(d => d.key === options.key);
    if (previous) {
      if (previous.request !== request) throw new TaskGraphError('E_DECISION_KEY', 'This key belongs to a different request; use a new key for a new decision');
      return { task: repo.taskById(previous.task)!, contract: requireContract(store, previous.contract), reused: true };
    }
    if (!repo.manifest.graphs.some(g => g.id === options.graph)) throw new TaskGraphError('E_CONTRACT_GRAPH', 'Unknown graph');
    const old = options.contract ? requireContract(store, options.contract) : undefined;
    const cid = old?.id ?? nextKnowledgeId('C', store.contracts), id = repo.nextTaskId();
    const at = timestampOf(options.now), actor = options.actor ?? null;
    const file = old?.file ?? (options.file ? documentPath(options.file) : `.task-graph/contracts/${cid}.md`);
    if (!/\.(md|markdown)$/i.test(file) || store.contracts.some(c => c.file === file && c.id !== cid)) throw new TaskGraphError('E_CONTRACT_FILE', 'Each contract owns one distinct Markdown file');
    const contract: ContractNode = { id: cid, graph: old?.graph ?? options.graph, title: old?.title ?? options.title, file,
      references: old?.references ?? [], history: [...old?.history ?? [], { event: `decision:${id}`, at, actor }] };
    store.contracts = [...store.contracts.filter(c => c.id !== cid), contract];
    const snapshot = snapshotDocument(tx, file, Buffer.from(body));
    const task: TaskDocument = { ...createTaskDocument({ id, graph: options.graph, title: options.title, goal: '登记已定决策；正文见关联契约，交付快照保留本次决定。' }),
      kind: 'decision', status: 'done', content: snapshot.snapshot, contracts: [cid],
      outputs: [{ kind: 'report', path: file, title: options.title, ...snapshot, addedAt: at, actor: options.actor }],
      history: [historyEntry('created', at, actor, { graph: options.graph }),
        historyEntry('started', at, actor, { from: 'todo', to: 'in_progress', reason: '一次性登记已定决策；非实施或验证过程' }),
        historyEntry('contract_attached', at, actor, { id: cid }),
        historyEntry('report_attached', at, actor, { path: file, sha256: snapshot.sha256 }),
        historyEntry('completed', at, actor, { from: 'in_progress', to: 'done', reason: '已定决策登记完成；不代表消费者已实现' })] };
    for (const target of targets) {
      const consumer = repo.taskById(target);
      if (!consumer) throw new TaskGraphError('E_NO_TASK', `Unknown task ${target}`);
      writeBinding(tx, consumer, 'contracts', cid, false, options);
    }
    store.decisions.push({ key: options.key, request, task: id, contract: cid });
    tx.write(file, body); tx.write(`.task-graph/tasks/${id}.md`, serializeTaskDocument(task)); writeKnowledge(tx, store);
    return { task, contract, reused: false };
  }, { validate: () => assertRepositoryValid(root) });
  return { saved: true, task: { id: result.task.id, graph: result.task.graph, status: result.task.status }, contract: result.contract, reused: result.reused, view: refreshKnowledgeView(root) };
}
