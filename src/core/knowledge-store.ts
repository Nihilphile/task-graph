import path from 'node:path';
import { readTextIfExists } from './fsx.js';
import { TaskGraphError } from './errors.js';
import type { ProjectTransaction } from './transaction.js';

export interface CodeReference {
  id: string;
  path: string;
  line: number;
  symbol: string;
  summary: string;
}
export interface ContractNode {
  id: string;
  graph: string;
  title: string;
  file: string;
  references: string[];
  history: { at: string; actor: string | null; event: string }[];
}
export interface DecisionRecord {
  key: string;
  request: string;
  task: string;
  contract: string;
}
export interface KnowledgeStore {
  version: 1;
  contracts: ContractNode[];
  references: CodeReference[];
  decisions: DecisionRecord[];
}
export const KNOWLEDGE_FILE = '.task-graph/knowledge.json';
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export function assertCodeReference(r: CodeReference): void {
  if (!/^R-\d{4,}$/.test(r.id) || !nonempty(r.path) || /[\r\n\0]/.test(r.path) ||
      !Number.isSafeInteger(r.line) || r.line < 1 || !nonempty(r.symbol) || /[\r\n]/.test(r.symbol) ||
      !nonempty(r.summary) || /[\r\n]/.test(r.summary) || Array.from(r.summary).length > 30) {
    throw new TaskGraphError('E_REFERENCE', 'A reference needs a code path, positive line, symbol, and a single-line description of at most 30 characters');
  }
}
export function readKnowledge(root: string): KnowledgeStore {
  const text = readTextIfExists(path.join(root, KNOWLEDGE_FILE));
  if (text === undefined) return { version: 1, contracts: [], references: [], decisions: [] };
  try {
    const store = JSON.parse(text) as KnowledgeStore;
    if (store.version !== 1 || !Array.isArray(store.contracts) || !Array.isArray(store.references) || !Array.isArray(store.decisions)) throw Error('Invalid shape');
    const ids = new Set<string>(), files = new Set<string>(), keys = new Set<string>();
    for (const r of store.references) {
      assertCodeReference(r);
      if (ids.has(r.id)) throw Error('Duplicate reference ID');
      ids.add(r.id);
    }
    for (const c of store.contracts) {
      if (!/^C-\d{4,}$/.test(c.id) || ids.has(c.id) || !nonempty(c.graph) || !nonempty(c.title) ||
          !nonempty(c.file) || !/\.(md|markdown)$/i.test(c.file) || files.has(c.file) || !Array.isArray(c.references) ||
          c.references.some(r => !store.references.some(entry => entry.id === r)) || !Array.isArray(c.history) ||
          c.history.some(h => !nonempty(h.at) || !nonempty(h.event) || (h.actor !== null && typeof h.actor !== 'string'))) throw Error('Invalid contract');
      ids.add(c.id); files.add(c.file);
    }
    for (const d of store.decisions) {
      if (!nonempty(d.key) || keys.has(d.key) || !nonempty(d.request) || !/^T-\d{4,}$/.test(d.task) || !store.contracts.some(c => c.id === d.contract)) throw Error('Invalid decision receipt');
      keys.add(d.key);
    }
    return store;
  } catch (e) { throw new TaskGraphError('E_KNOWLEDGE', `Invalid ${KNOWLEDGE_FILE}`, [String(e)]); }
}
export function writeKnowledge(tx: ProjectTransaction, store: KnowledgeStore): void {
  tx.write(KNOWLEDGE_FILE, JSON.stringify({ ...store,
    contracts: [...store.contracts].sort((a,b) => a.id.localeCompare(b.id)),
    references: [...store.references].sort((a,b) => a.id.localeCompare(b.id)),
    decisions: [...store.decisions].sort((a,b) => a.key.localeCompare(b.key)),
  }, null, 2) + '\n');
}
export function nextKnowledgeId(prefix: 'C' | 'R', records: readonly { id: string }[]): string {
  return `${prefix}-${String(Math.max(0, ...records.map(r => Number(r.id.slice(2)))) + 1).padStart(4, '0')}`;
}
