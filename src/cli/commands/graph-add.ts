import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { addGraph } from '../../core/graphs.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';
import { resolveGitHubRepo } from '../../core/github-client.js';

export function graphAddCommand(): CommandSpec {
  return {
    name: 'graph add',
    summary: 'Register a graph with a stable ID and title',
    usage:
      'task-graph graph add --title <title> (--entry | --parent-task T-NNNN) [--id G-NNN] [--gh] [--repo owner/repo] [--cwd <dir>] [--json]',
    details: [
      'Allocates the next free G-NNN ID when --id is omitted; existing graph IDs are never reused or renumbered.',
      '--entry registers the new graph in entry_graphs.',
      '--parent-task T-NNNN registers the new graph as that composite task subgraph.',
      'One of the two is required so no graph is ever left unreachable.',
      '--gh enables persistent GitHub publishing for an entry graph and its descendants; --repo overrides the git remote.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const title = args.opt('title');
      if (title === undefined) {
        throw usageError('A graph title is required', ['Pass --title <title>.']);
      }
      const entry = args.flag('entry');
      const parentTask = args.opt('parent-task');
      if (!entry && parentTask === undefined) {
        throw usageError('A new graph needs a place in the project', [
          'Pass --entry to make it an entry graph, or --parent-task T-NNNN to make it a subgraph.',
        ]);
      }
      if (args.opt('repo') && !args.flag('gh')) throw usageError('--repo requires --gh.');
      if (args.flag('gh') && !entry) throw usageError('--gh belongs on an entry graph; child graphs inherit it.');
      const githubRepo = args.flag('gh') ? resolveGitHubRepo(root, args.opt('repo')) : undefined;
      const result = addGraph(root, { title, id: args.opt('id'), entry, parentTask, githubRepo });

      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            { ok: true, graph: result.graph, entry: result.entry },
            null,
            2,
          ),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(
          `Registered graph ${result.graph.id} "${result.graph.title}"${
            result.entry
              ? ' as an entry graph'
              : ` as the subgraph of ${result.parentTask}`
          }`,
        );
      }
      return EXIT_OK;
    },
  };
}
