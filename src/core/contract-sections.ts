import { Marked } from 'marked';
import { TaskGraphError } from './errors.js';

export interface ContractSection { id: string; title: string; body: string; }

/** Explicit IDs survive heading edits; fenced examples are never headings. */
export function contractSections(body: string): ContractSection[] {
  const sections: ContractSection[] = [];
  let current: ContractSection | undefined;
  for (const token of new Marked().lexer(body)) {
    if (token.type === 'heading' && token.depth <= 2) {
      current = undefined;
      const match = token.depth === 2 && /^(.*?)\s+\{#([A-Za-z][A-Za-z0-9_-]*)\}$/.exec(token.text);
      if (match) {
        if (sections.some(s => s.id === match[2])) throw new TaskGraphError('E_CONTRACT_SECTION', `Duplicate contract section: ${match[2]}`);
        current = { id: match[2]!, title: match[1]!, body: token.raw };
        sections.push(current);
      }
    } else if (current) current.body += token.raw;
  }
  return sections;
}

export function contractBinding(value: string): { id: string; section?: string } {
  const match = /^(C-\d{4,})(?:#([A-Za-z][A-Za-z0-9_-]*))?$/.exec(value);
  if (!match) throw new TaskGraphError('E_CONTRACT_SECTION', `Invalid contract reference: ${value}`);
  return { id: match[1]!, ...(match[2] ? { section: match[2] } : {}) };
}

/** A whole-contract binding takes precedence over its individual sections. */
export function groupedContracts(bindings: readonly string[] = []): Map<string, string[] | undefined> {
  const groups = new Map<string, string[] | undefined>();
  for (const value of bindings) {
    const { id, section } = contractBinding(value);
    if (!section) groups.set(id, undefined);
    else if (!groups.has(id)) groups.set(id, [section]);
    else if (groups.get(id) && !groups.get(id)!.includes(section)) groups.get(id)!.push(section);
  }
  return groups;
}

export function selectContractText(body: string, selected?: readonly string[]): string {
  const sections = contractSections(body);
  if (!selected?.length) return body;
  for (const id of selected) if (!sections.some(s => s.id === id)) throw new TaskGraphError('E_CONTRACT_SECTION', `Unknown contract section: ${id}`);
  return sections.filter(s => selected.includes(s.id)).map(s => s.body.trimEnd()).join('\n\n') + '\n';
}
