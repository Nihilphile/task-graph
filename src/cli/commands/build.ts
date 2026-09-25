import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { buildProject } from '../../core/build.js';
import { resolveCwd } from '../paths.js';

export function buildCommand(): CommandSpec {
  return {
    name: 'build',
    summary: 'Rebuild the generated graph projection from source',
    usage: 'task-graph build [--cwd <dir>] [--json]',
    details: [
      'Validates the project, then regenerates .task-graph/generated/graph.json and the self-contained index.html viewer.',
      'Run this after editing task Markdown bodies directly.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const result = buildProject(root);
      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            {
              ok: true,
              file: result.file,
              htmlFile: result.htmlFile,
              tasks: result.taskCount,
              graphs: result.graphCount,
            },
            null,
            2,
          ),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(
          `Built ${result.file} and ${result.htmlFile} (${result.taskCount} task(s), ${result.graphCount} graph(s))`,
        );
      }
      return EXIT_OK;
    },
  };
}
