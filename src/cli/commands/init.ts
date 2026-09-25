import path from 'node:path';
import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { initializeProject } from '../../core/init.js';
import { resolveCwd } from '../paths.js';

export function initCommand(): CommandSpec {
  return {
    name: 'init',
    summary: 'Create .task-graph/ (optionally with one entry graph and root task)',
    usage:
      'task-graph init [--name <name>] [--task <root task title>] [--graph-title <title>] [--goal <text>] [--cwd <dir>] [--json]',
    details: [
      'Creates project.yaml plus the tasks and generated directories.',
      'Passing --task also creates entry graph G-001 and root task T-0001 with the',
      'required 目标 / 完成条件 / 工作记录 sections (task-first initialisation).',
      'init never overwrites an existing project; extend it with `graph add` or `task add`.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const name = args.opt('name') ?? path.basename(path.resolve(root));
      const result = initializeProject(root, {
        name,
        task: args.opt('task'),
        graphTitle: args.opt('graph-title'),
        goal: args.opt('goal'),
        now: () => ctx.now(),
      });

      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            {
              ok: true,
              root: result.root,
              project: result.manifest.name,
              graphs: result.manifest.graphs.map((graph) => graph.id),
              entryGraphs: result.manifest.entryGraphs,
              task: result.task ? result.task.id : null,
            },
            null,
            2,
          ),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(`Initialized task graph project "${result.manifest.name}" in ${root}`);
        if (result.graph) ctx.io.out(`Entry graph: ${result.graph.id} ${result.graph.title}`);
        if (result.task) ctx.io.out(`Root task: ${result.task.id} ${result.task.title}`);
      }
      return EXIT_OK;
    },
  };
}
