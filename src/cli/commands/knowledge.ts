import { bindKnowledge, recordDecision, saveCodeReference, saveContract } from '../../core/knowledge.js';
import { readKnowledge } from '../../core/knowledge-store.js';
import { contractSections, selectContractText } from '../../core/contract-sections.js';
import { readDocument } from '../../core/documents.js';
import { loadTaskRepository } from '../../core/repo.js';
import { knowledgeContext, taskContext } from '../../core/task-context.js';
import { usageError } from '../../core/errors.js';
import { emitResult, fileView } from '../output.js';
import { resolveCwd } from '../paths.js';
import { EXIT_OK, type CommandSpec } from '../context.js';
import type { ParsedArgs } from '../args.js';

const need = (args: ParsedArgs, name: string): string => {
  const value = args.opt(name);
  if (!value?.trim()) throw usageError(`Pass --${name}`);
  return value;
};
const selected = (args: ParsedArgs): string => {
  if (!args.positionals[0]) throw usageError('Select an ID');
  return args.positionals[0];
};
const suffix = ' [--actor <name>] [--cwd <dir>] [--json]';
const codeInput = '--path <code-file> --line <number> --symbol <name> --summary <up-to-30-chars>';

export function knowledgeCommands(): CommandSpec[] {
  const commands: CommandSpec[] = [];
  for (const action of ['add', 'update'] as const) commands.push({
    name: `contract ${action}`, summary: action === 'add' ? 'Create one shared current contract node' : 'Update the authoritative text of a contract',
    usage: `task-graph contract ${action}${action === 'update' ? ' C-NNNN' : ' --graph G-NNN --title <text>'} (--text <Markdown> | --file <project-file>) [--task T-NNNN ...] [--reference R-NNNN ...]${suffix}`,
    details: ['Contracts have no execution status. Tasks bind them as current requirements; execution dependencies remain separate.', '--file registers existing Markdown on add; update copies supplied text into the existing authoritative file.'],
    run(ctx, args) {
      emitResult(ctx, args, { ok: true, ...saveContract(resolveCwd(ctx, args), {
        id: action === 'update' ? selected(args) : undefined, graph: args.opt('graph'), title: args.opt('title'),
        text: args.opt('text'), file: args.opt('file'), tasks: args.all('task'), references: args.has('reference') ? args.all('reference') : undefined,
        actor: args.opt('actor'), now: () => ctx.now(),
      }) }); return EXIT_OK;
    },
  });
  for (const kind of ['contract', 'reference'] as const) for (const action of ['list', 'show'] as const) commands.push({
    name: `${kind} ${action}`, summary: `${action === 'list' ? 'List' : 'Read'} ${kind} entries`,
    usage: `task-graph ${kind} ${action}${action === 'show' ? kind === 'contract' ? ' C-NNNN [--section <id> ...]' : ' R-NNNN' : ''} [--cwd <dir>] [--json]`,
    run(ctx, args) {
      const root = resolveCwd(ctx, args), store = readKnowledge(root);
      const entries = kind === 'contract' ? store.contracts : store.references;
      const entry = action === 'show' ? entries.find(e => e.id === selected(args)) : undefined;
      if (action === 'show' && !entry) throw usageError(`Unknown ${kind}`);
      const contractBody = kind === 'contract' && entry ? readDocument(root, store.contracts.find(c => c.id === entry.id)!.file).toString('utf8') : undefined;
      emitResult(ctx, args, { ok: true, project_root: root, ...(entry ? { [kind]: { ...entry,
        ...(contractBody !== undefined ? { sections: contractSections(contractBody).map(({ id, title }) => ({ id, title })), body: selectContractText(contractBody, args.all('section')) } : {}) } } : { [kind === 'contract' ? 'contracts' : 'references']: entries }) });
      return EXIT_OK;
    },
  });
  for (const scope of ['reference', 'task reference', 'contract reference'] as const) {
    commands.push({ name: `${scope} add`, summary: 'Register or reuse a code entry and optionally bind it to the selected owner',
      usage: `task-graph ${scope} add${scope === 'reference' ? '' : scope === 'task reference' ? ' T-NNNN' : ' C-NNNN'} ${codeInput}${suffix}`,
      details: ['One code/script entry plus a description of at most 30 Unicode characters. Path, line and symbol do not count toward that limit.', 'Existing path+symbol reuses its ID; use reference update to change a shared entry. Absolute paths may locate code in another worktree.'],
      run(ctx, args) {
        emitResult(ctx, args, { ok: true, ...saveCodeReference(resolveCwd(ctx, args), {
          path: need(args, 'path'), line: Number(need(args, 'line')), symbol: need(args, 'symbol'), summary: need(args, 'summary'),
          task: scope === 'task reference' ? selected(args) : undefined, contract: scope === 'contract reference' ? selected(args) : undefined,
          actor: args.opt('actor'), now: () => ctx.now(),
        }) }); return EXIT_OK;
      },
    });
  }
  commands.push({ name: 'reference update', summary: 'Update one shared code navigation entry',
    usage: `task-graph reference update R-NNNN ${codeInput}${suffix}`,
    run(ctx, args) { emitResult(ctx, args, { ok: true, ...saveCodeReference(resolveCwd(ctx, args), { id: selected(args), path: need(args, 'path'), line: Number(need(args, 'line')), symbol: need(args, 'symbol'), summary: need(args, 'summary'), actor: args.opt('actor'), now: () => ctx.now() }) }); return EXIT_OK; },
  });
  for (const scope of ['task contract', 'task reference', 'contract reference'] as const) {
    for (const action of ['attach', 'remove'] as const) commands.push({
      name: `${scope} ${action}`, summary: `${action === 'attach' ? 'Bind' : 'Unbind'} an existing ${scope.endsWith('contract') ? 'contract' : 'code reference'} ID`,
      usage: `task-graph ${scope} ${action} ${scope.startsWith('task') ? 'T-NNNN' : 'C-NNNN'} --id ${scope.endsWith('contract') ? 'C-NNNN[#section]' : 'R-NNNN'}${suffix}`,
      run(ctx, args) { emitResult(ctx, args, { ok: true, ...bindKnowledge(resolveCwd(ctx, args), { kind: scope.endsWith('contract') ? 'contracts' : 'references', id: need(args, 'id'), task: scope.startsWith('task') ? selected(args) : undefined, contract: scope.startsWith('contract') ? selected(args) : undefined, remove: action === 'remove', actor: args.opt('actor'), now: () => ctx.now() }) }); return EXIT_OK; },
    });
    commands.push({ name: `${scope} list`, summary: 'List current contracts or reusable code entries for this owner',
      usage: `task-graph ${scope} list ${scope.startsWith('task') ? 'T-NNNN' : 'C-NNNN'} [--cwd <dir>] [--json]`,
      run(ctx, args) {
        const root = resolveCwd(ctx, args), store = readKnowledge(root), id = selected(args);
        let result: unknown;
        let legacy: Record<string, unknown> = {};
        if (scope.startsWith('task')) {
          const repo = loadTaskRepository(root), task = repo.taskById(id);
          if (!task) throw usageError('Unknown task');
          result = scope.endsWith('contract') ? knowledgeContext(root, task, repo).contracts : knowledgeContext(root, task, repo).code_references;
          if (scope === 'task reference') {
            const context = taskContext(root, task, repo);
            const excluded = context.excluded.filter(f => f.kind === 'reference');
            if (context.references.length) legacy = { files: context.references.map(f => args.flag('detail')
              ? { ...f, source_resource: `graph[${encodeURIComponent(repo.taskById(f.source_task)!.graph)}].task[${f.source_task}]` }
              : fileView(f)) };
            if (excluded.length) legacy = { ...legacy, ...(args.flag('detail') ? { excluded } : { excluded_count: excluded.length }) };
          }
        } else {
          const c = store.contracts.find(c => c.id === id);
          if (!c) throw usageError('Unknown contract');
          result = store.references.filter(r => c.references.includes(r.id));
        }
        emitResult(ctx, args, { ok: true, project_root: root, entries: result, ...legacy }); return EXIT_OK;
      },
    });
  }
  commands.push({ name: 'decision record', summary: 'Atomically record a decided contract, completed decision task and consumer bindings',
    usage: `task-graph decision record --key <stable-key> --graph G-NNN --title <text> (--text <Markdown> | --file <project-file>) [--contract C-NNNN] [--task T-NNNN ...]${suffix}`,
    details: ['Use only for an already-made decision requiring its own audit record. Creates/updates one contract, snapshots that same text as the decision report, binds consumers, then refreshes once.', 'Repeating the same key and inputs returns the existing IDs. Different inputs with the same key fail. saved:true with view.status:failed means retry build only.', 'This records a decision, not implementation or independent acceptance; consumers retain their original status and execution dependencies.'],
    run(ctx, args) { emitResult(ctx, args, { ok: true, ...recordDecision(resolveCwd(ctx, args), { key: need(args, 'key'), title: need(args, 'title'), graph: need(args, 'graph'), text: args.opt('text'), file: args.opt('file'), tasks: args.all('task'), contract: args.opt('contract'), actor: args.opt('actor'), now: () => ctx.now() }) }); return EXIT_OK; },
  });
  return commands;
}
