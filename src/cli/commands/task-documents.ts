import { EXIT_OK, type CommandSpec } from '../context.js';
import { attachDocument, createHandoff } from '../../core/documents.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';

export function taskDocumentCommands(): readonly CommandSpec[] {
  return [
    ...(['report', 'log', 'handoff'] as const).map((kind): CommandSpec => ({
      name: `task ${kind} attach`,
      summary: `Attach a ${kind} file for offline reading from a task label`,
      usage: `task-graph task ${kind} attach T-NNNN --path <file> [--title <text>] [--actor <name>] [--cwd <dir>] [--json]`,
      details: [kind === 'log' ? 'Log files are live references; task log appends to the managed work log.' : 'The file is snapshotted at attachment time for later audit. Markdown/text is embedded in the offline viewer.', 'Paths are relative to the project root. Files must exist.'],
      run(ctx, args): number {
        const id = args.positionals[0];
        const file = args.opt('path');
        if (!id || file === undefined) throw usageError('Pass a task ID and --path <file>.');
        const task = attachDocument(resolveCwd(ctx, args), { id, kind, path: file, title: args.opt('title'), actor: args.opt('actor'), now: () => ctx.now() });
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id, outputs: task.outputs } }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(`Attached ${kind} to ${id}: ${file}`);
        return EXIT_OK;
      },
    })),
    {
      name: 'task handoff create', summary: 'Save the current task requirements, progress and prerequisite outputs as a handoff snapshot',
      usage: 'task-graph task handoff create T-NNNN [--title <text>] [--actor <name>] [--cwd <dir>] [--json]',
      details: ['Use task show --handoff for a read-only preview. Starting a task also saves a handoff snapshot.'],
      run(ctx, args): number {
        const id = args.positionals[0];
        if (!id) throw usageError('Pass a task ID.');
        const task = createHandoff(resolveCwd(ctx, args), { id, title: args.opt('title'), actor: args.opt('actor'), now: () => ctx.now() });
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id, outputs: task.outputs } }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(`Saved handoff for ${id}`);
        return EXIT_OK;
      },
    },
  ];
}
