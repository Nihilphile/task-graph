import { EXIT_FAILURE, EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { validateRepository } from '../../core/validate.js';
import { resolveCwd } from '../paths.js';

export function validateCommand(): CommandSpec {
  return {
    name: 'validate',
    summary: 'Validate the task graph and report every problem',
    usage: 'task-graph validate [--cwd <dir>] [--json]',
    details: [
      'Checks project.yaml, every task document, and every cross-file reference.',
      'Exits 0 when the project is valid and 1 when any problem is found.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const report = validateRepository(root);
      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            {
              ok: report.ok,
              issues: report.issues.map((issue) => ({
                code: issue.code,
                file: issue.file,
                field: issue.field,
                message: issue.message,
              })),
            },
            null,
            2,
          ),
        );
      } else if (report.ok) {
        ctx.io.out('Task graph is valid.');
      } else {
        for (const issue of report.issues) {
          const location = issue.field.length > 0 ? `${issue.file} -> ${issue.field}` : issue.file;
          ctx.io.err(`${location}: ${issue.message}`);
        }
        ctx.io.err(`Found ${report.issues.length} problem(s).`);
      }
      return report.ok ? EXIT_OK : EXIT_FAILURE;
    },
  };
}
