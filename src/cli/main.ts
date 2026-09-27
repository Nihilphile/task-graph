import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, type CliContext, type CliIo } from './context.js';
import { parseArgs } from './args.js';
import { createRegistry } from './registry.js';
import { matchCommand, renderCommandHelp, renderHelp } from './commands/help.js';
import { isTaskGraphError, usageError } from '../core/errors.js';
import { type GitHubClient } from '../core/github-client.js';
import { synchronizeGitHub } from '../core/github-sync.js';
import { readProjectManifest } from '../core/project.js';
import { buildProject } from '../core/build.js';
import { resolveCwd } from './paths.js';
import { readGitHubState, type GitHubView } from '../core/github-state.js';
import { kickWatchWorker } from '../core/watch.js';
import type { DesktopAdapter } from '../core/desktop-notify.js';
import { prepareResource, resourceOutput } from './resources.js';

export interface MainOptions {
  desktopAdapter?: DesktopAdapter;
  githubClient?: GitHubClient;
  cwd?: string;
  io?: CliIo;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
}

export function defaultIo(): CliIo {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  };
}

/**
 * Runs the CLI in-process and returns the process exit code.
 *
 * Tests call this directly so no subprocess is needed; `cli.ts` wires it to
 * `process.argv` and `process.exitCode`.
 */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  let io = options.io ?? defaultIo();
  const commands = createRegistry();
  let ctx: CliContext = {
    desktopAdapter: options.desktopAdapter,
    cwd: options.cwd ?? process.cwd(),
    io,
    now: options.now ?? (() => new Date()),
    env: options.env ?? process.env,
    commands: commands.map((command) => command.name),
  };

  try {
    if (argv.length === 0) {
      io.out(renderHelp(commands));
      return EXIT_OK;
    }
    const first = argv[0] ?? '';
    if (first === '--help' || first === '-h') {
      io.out(renderHelp(commands));
      return EXIT_OK;
    }
    const invocation = prepareResource(argv, ctx, commands);
    if (invocation === null) return EXIT_OK;
    if (invocation) {
      argv = invocation.argv;
      const originalIo = io;
      const resourceArgs = parseArgs(argv, matchCommand(commands, argv).wordCount);
      if (resourceArgs.flag('json')) io = { ...io, out: text => originalIo.out(resourceOutput(text, invocation, resolveCwd(ctx, resourceArgs))) };
      ctx = { ...ctx, io, scopedGraph: invocation.scopedGraph };
    }
    const { command, wordCount } = matchCommand(commands, argv);
    if (!command) {
      const word = argv[0] ?? '';
      throw usageError(`Unknown command "${word}"`, ['Run `task-graph help` to list commands.']);
    }
    const args = parseArgs(argv, wordCount);
    if (args.flag('help') && command.name !== 'help') {
      io.out(renderCommandHelp(command));
      return EXIT_OK;
    }
    const readOnly = ['help', 'validate', 'skill validate', 'task list', 'task show'].includes(command.name);
    if (readOnly) return await command.run(ctx, args);
    if (command.name === 'graph watch' || command.name === 'graph unwatch') return await command.run(ctx, args);
    const output: string[] = [];
    let result: number;
    try { result = await command.run({ ...ctx, io: { out: text => output.push(text), err: io.err } }, args); }
    finally {
      if (!options.desktopAdapter) {
        try { kickWatchWorker(resolveCwd(ctx, args)); }
        catch (error) { io.err(`Desktop delivery pending: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    let github: GitHubView | undefined;
    if (result === EXIT_OK) {
      const root = resolveCwd(ctx, args);
      if (readProjectManifest(root).graphs.some(g => g.github)) {
        github = synchronizeGitHub(root, options.githubClient);
        try { buildProject(root); } catch (error) { io.err(`Local change saved; viewer rebuild failed: ${error instanceof Error ? error.message : String(error)}`); }
        if (github.status === 'pending') io.err(`Local change saved. GitHub pending: ${github.error ?? 'Run github sync to retry.'}`);
      }
    }
    for (const text of output) {
      if (!github || !args.flag('json')) { io.out(text); continue; }
      const payload = JSON.parse(text);
      let status = github;
      const graphId = payload.graph?.id ?? (typeof payload.graph === 'string' ? payload.graph : undefined);
      const key = payload.task?.id ?? (graphId ? `graph:${graphId}` : undefined);
      try {
        const issue = key ? readGitHubState(resolveCwd(ctx, args))?.issues[key] : undefined;
        if (issue) status = { ...github, url: issue.url, number: issue.number, repo: issue.repo };
      } catch { /* The sync result already explains state corruption. */ }
      io.out(JSON.stringify({ ...payload, github: status }, null, 2));
    }
    if (github && !args.flag('json') && !args.flag('quiet')) io.out(`GitHub: ${github.status}${github.pendingComments ? ` (${github.pendingComments} pending comments)` : ''}`);
    return result;
  } catch (error) {
    if (isTaskGraphError(error)) {
      if (argv.includes('--json') || argv.includes('--json=true')) io.out(JSON.stringify({ ok: false, error: { code: error.code, message: error.message, details: error.details } }, null, 2));
      io.err(error.format());
      return error.code === 'E_USAGE' ? EXIT_USAGE : EXIT_FAILURE;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes('--json') || argv.includes('--json=true')) io.out(JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message, details: [] } }, null, 2));
    io.err(`error [E_INTERNAL]: ${message}`);
    if (error instanceof Error && error.stack && process.env.TASK_GRAPH_DEBUG) {
      io.err(error.stack);
    }
    return EXIT_FAILURE;
  }
}
