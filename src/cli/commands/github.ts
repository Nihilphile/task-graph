import { type CommandSpec, EXIT_OK } from '../context.js';
import { resolveCwd } from '../paths.js';
import { usageError } from '../../core/errors.js';
import { resolveGitHubRepo } from '../../core/github-client.js';
import { readProjectManifest, serializeProjectManifest } from '../../core/project.js';
import { runProjectTransaction } from '../../core/transaction.js';
import { readGitHubState } from '../../core/github-state.js';
import { buildProject } from '../../core/build.js';

export function githubCommands(): CommandSpec[] {
  return [{
    name: 'graph publish', summary: 'Enable persistent GitHub publishing for an existing entry graph',
    usage: 'task-graph graph publish G-NNN [--repo owner/repo] [--cwd <dir>] [--json]',
    details: ['Publishes tasks, reports and logs on future mutations and builds. Uses the current gh login.', 'Repository binding is permanent once enabled. Child graphs inherit it.'],
    run(ctx, args) {
      const root = resolveCwd(ctx, args); const id = args.positionals[0];
      if (!id) throw usageError('Pass an entry graph ID.');
      const manifest = readProjectManifest(root);
      const graph = manifest.graphs.find(g => g.id === id);
      if (!graph || !manifest.entryGraphs.includes(id)) throw usageError('Only an existing entry graph can be published.');
      const repo = resolveGitHubRepo(root, args.opt('repo') ?? graph.github?.repo);
      runProjectTransaction(root, transaction => {
        const current = readProjectManifest(root);
        const existing = current.graphs.find(g => g.id === id);
        const mapped = readGitHubState(root)?.issues[`graph:${id}`];
        if ((existing?.github && existing.github.repo !== repo) || (mapped && mapped.repo !== repo)) throw usageError('This graph is already bound to another GitHub repository.');
        transaction.write('.task-graph/project.yaml', serializeProjectManifest({ ...current,
          graphs: current.graphs.map(g => g.id === id ? { ...g, github: { repo } } : g) }));
      });
      buildProject(root);
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, graph: id, repo }));
      else if (!args.flag('quiet')) ctx.io.out(`Enabled GitHub for ${id}: ${repo}`);
      return EXIT_OK;
    }
  }, {
    name: 'github sync', summary: 'Retry pending GitHub publishing and refresh the offline viewer',
    usage: 'task-graph github sync [--cwd <dir>] [--json]',
    details: ['Synchronizes all enabled entry graphs. A remote failure is reported as pending; local work is retained.'],
    run(ctx, args) {
      if (!readProjectManifest(resolveCwd(ctx, args)).graphs.some(g => g.github)) throw usageError('No graph is published. Use graph add --gh or graph publish first.');
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true }));
      return EXIT_OK;
    }
  }];
}
