import { EXIT_OK, type CommandSpec } from '../context.js';
import { attachDocument, createHandoff, setDocumentAudience } from '../../core/documents.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';

export function taskDocumentCommands(): readonly CommandSpec[] {
  return [
    ...(['report', 'log', 'handoff', 'reference'] as const).map((kind): CommandSpec => ({
      name: `task ${kind} attach`,
      summary: `Attach a ${kind} file for offline reading from a task label`,
      usage: `task-graph task ${kind} attach T-NNNN --path <file> [--title <text>] [--summary <text>] [--audience agent|user]${kind === 'reference' ? ' [--snapshot]' : ''} [--actor <name>] [--cwd <dir>] [--json]`,
      details: [kind === 'reference' ? 'References follow the live file by default; --snapshot freezes a version. Successors discover references through task dependencies.' : kind === 'log' ? 'Log files are live references; task log appends to the managed work log.' : 'The file is snapshotted at attachment time for later audit. Markdown/text is embedded in the offline viewer.', 'Paths are relative to the project root. Files must exist. Summary is optional and describes the file.'],
      run(ctx, args): number {
        const id = args.positionals[0];
        const file = args.opt('path');
        if (!id || file === undefined) throw usageError('Pass a task ID and --path <file>.');
        const audience = args.opt('audience');
        if (audience !== undefined && audience !== 'agent' && audience !== 'user') throw usageError('--audience must be agent or user');
        const task = attachDocument(resolveCwd(ctx, args), { id, kind, path: file, title: args.opt('title'), summary: args.opt('summary'), audience, snapshot: args.flag('snapshot'), actor: args.opt('actor'), now: () => ctx.now() });
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id, outputs: task.outputs } }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(`Attached ${kind} to ${id}: ${file}`);
        return EXIT_OK;
      },
    })),
    {
      name: 'task output set-audience', summary: 'Set the audience of all registered versions at a source path',
      usage: 'task-graph task output set-audience T-NNNN --path <file> --audience agent|user [--actor <name>] [--cwd <dir>] [--json]',
      details: ['user attachments stay visible in HTML but are excluded from agent context and handoff, even when expansion is requested.', 'Updates metadata without replacing snapshots. Existing unmarked generated handoffs require review before opting in as agent.'],
      run(ctx, args): number {
        const id = args.positionals[0], file = args.opt('path'), audience = args.opt('audience');
        if (!id || !file || !audience) throw usageError('Pass task ID, --path and --audience.');
        setDocumentAudience(resolveCwd(ctx, args), { id, path: file, audience, actor: args.opt('actor'), now: () => ctx.now() });
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id }, path: file, audience }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(`Audience ${audience}: ${id} ${file}`);
        return EXIT_OK;
      },
    },
    {
      name: 'task handoff create', summary: 'Save current requirements and a filtered attachment index as a handoff snapshot',
      usage: 'task-graph task handoff create T-NNNN [--title <text>] [--summary <text>] [--actor <name>] [--cwd <dir>] [--json]',
      details: ['Use task show --handoff for a read-only manifest. Starting a task also saves requirements and an attachment index; reports and logs are not copied into the snapshot.'],
      run(ctx, args): number {
        const id = args.positionals[0];
        if (!id) throw usageError('Pass a task ID.');
        const task = createHandoff(resolveCwd(ctx, args), { id, title: args.opt('title'), summary: args.opt('summary'), actor: args.opt('actor'), now: () => ctx.now() });
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id, outputs: task.outputs } }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(`Saved handoff for ${id}`);
        return EXIT_OK;
      },
    },
  ];
}
