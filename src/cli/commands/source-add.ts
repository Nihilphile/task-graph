import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { registerSource } from '../../core/sources.js';
import { resolveCwd } from '../paths.js';

/** The `source add` command. */
export function sourceAddCommand(): CommandSpec {
  return {
    name: 'source add',
    summary: 'Register an optional PRD source with its confirmation time',
    usage:
      'task-graph source add --id <id> --file <path> [--confirmed-at <timestamp>] [--cwd <dir>] [--json]',
    details: [
      'A source records an ID, a file path and confirmed_at only; it has no status, claim or readiness.',
      'Tasks declare `derived_from` entries that point at source IDs; derives never affect readiness.',
      'The path is recorded as given, relative to the project root.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = args.opt('id');
      if (id === undefined || id.trim().length === 0) {
        throw usageError('A source ID is required', ['Pass --id <id>.']);
      }
      const file = args.opt('file');
      if (file === undefined || file.trim().length === 0) {
        throw usageError('A source file path is required', ['Pass --file <path>.']);
      }
      const source = registerSource(root, {
        id,
        file,
        confirmedAt: args.opt('confirmed-at'),
        now: () => ctx.now(),
      });

      if (args.flag('json')) {
        ctx.io.out(JSON.stringify({ ok: true, source }, null, 2));
      } else if (!args.flag('quiet')) {
        ctx.io.out(`Registered ${source.id}: ${source.file} (confirmed ${source.confirmedAt})`);
      }
      return EXIT_OK;
    },
  };
}
