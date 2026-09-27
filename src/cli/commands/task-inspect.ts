import { EXIT_OK, type CommandSpec } from '../context.js';
import { TaskGraphError, usageError } from '../../core/errors.js';
import { loadTaskRepository } from '../../core/repo.js';
import { assertRepositoryValid } from '../../core/validate.js';
import { resolveCwd } from '../paths.js';
import { agentHandoff, type DocumentKind } from '../../core/documents.js';
import { computeReadiness } from '../../core/readiness.js';
import { contextFiles, taskContext } from '../../core/task-context.js';
import { githubTargets } from '../../core/github-plan.js';
import { githubView, readGitHubState, type GitHubView } from '../../core/github-state.js';
import { executionGuidance, formatExecutionGuidance } from '../execution-guidance.js';

export function taskInspectCommands(): readonly CommandSpec[] {
  return [listCommand(), showCommand()];
}

function listCommand(): CommandSpec {
  return {
    name: 'task list',
    summary: 'List current tasks and computed readiness',
    usage: 'task-graph task list [--available | --needs-refinement] [--graph G-NNN] [--status todo|in_progress|done|reject|cancelled] [--readiness ready|blocked] [--cwd <dir>] [--json]',
    details: ['Reads source files and computes readiness; generated graph.json does not need to be current.'],
    run(ctx, args): number {
      const root = resolveCwd(ctx, args);
      assertRepositoryValid(root);
      const repository = loadTaskRepository(root);
      const readinessById = computeReadiness(repository);
      const targets = githubTargets(repository);
      let githubState: ReturnType<typeof readGitHubState>;
      let githubError: string | undefined;
      if (targets.size) {
        try { githubState = readGitHubState(root); }
        catch (cause) { githubError = cause instanceof Error ? cause.message : String(cause); }
      }
      const status = args.opt('status');
      const graph = args.opt('graph');
      const readiness = args.opt('readiness');
      if (status && !['todo', 'in_progress', 'done', 'reject', 'cancelled'].includes(status)) {
        throw usageError(`Unsupported status "${status}"`);
      }
      if (readiness && !['ready', 'blocked'].includes(readiness)) {
        throw usageError(`Unsupported readiness "${readiness}"`);
      }
      if (graph && !repository.manifest.graphs.some((item) => item.id === graph)) {
        throw usageError(`Unknown graph "${graph}"`);
      }
      const tasks = repository.tasks.map(task => ({ ...task, ...readinessById.get(task.id)! }))
        .filter((task) => !args.flag('available') || (task.status === 'todo' && task.readiness === 'ready' && task.claim === null))
        .filter(task => !args.flag('needs-refinement') || (['todo', 'reject'].includes(task.status) && !task.claim && ['awaiting_review', 'stale'].includes(task.planningState ?? '') && task.blockedBy.every(b => b.kind === 'refinement')))
        .filter((task) => !graph || task.graph === graph)
        .filter((task) => !status || task.status === status)
        .filter((task) => !readiness || task.readiness === readiness)
        .map(task => {
          const { id, graph, title, status, readiness, blockedBy, claim } = task;
          const allowed = contextFiles(taskContext(root, task, repository));
          const outputs = task.outputs.filter(o => allowed.some(f => f.source_task === id && f.path === o.path && f.sha256 === o.sha256));
          const target = targets.get(graph);
          const github = target ? { ...githubView(githubState, id, target.repo), ...(githubError ? { error: githubError } : {}) } : undefined;
          return { id, graph, title, status, readiness, blockedBy, claim, planning: task.planning ?? 'static', planningState: task.planningState ?? 'static', kind: task.kind ?? 'work', result: status === 'done' ? 'pass' : status === 'reject' ? 'reject' : null, outputs, ...(github ? { github } : {}) };
        });
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, tasks }, null, 2));
      else if (!args.flag('quiet')) {
        ctx.io.out(tasks.length === 0 ? 'No tasks.' : tasks.map((task) =>
          `${task.id}  ${task.status}  ${task.readiness}  ${task.title}${task.github ? '  GitHub: ' + task.github.status : ''}`,
        ).join('\n'));
      }
      return EXIT_OK;
    },
  };
}

function showCommand(): CommandSpec {
  return {
    name: 'task show',
    summary: 'Show task facts and a file manifest; expand selected bodies explicitly',
    usage: 'task-graph task show T-NNNN [--manifest] [--handoff] [--expand content|report|log|reference|handoff|output]... [--expand-path <file>]... [--exclude-path <file>]... [--preview] [--cwd <dir>] [--json]',
    details: ['Default and --manifest return addresses, summaries and provenance without attachment bodies or history text.', 'Repeat --expand to select categories, or --expand-path for specific source/snapshot paths. --preview returns a size estimate without reading bodies.', 'User-audience attachments and unreviewed legacy aggregate handoffs are always excluded. Path filters are exact project-relative paths, not globs.', '--handoff formats the same selected data as Markdown. It no longer implies expanding reports.'],
    run(ctx, args): number {
      const id = args.positionals[0];
      if (!id) throw usageError('A task ID is required', ['Pass T-NNNN.']);
      const root = resolveCwd(ctx, args);
      assertRepositoryValid(root);
      const repository = loadTaskRepository(root);
      const source = repository.taskById(id);
      if (!source) throw new TaskGraphError('E_NO_TASK', `Task "${id}" was not found`);
      const expand = args.all('expand');
      if (expand.some(kind => !['content', 'report', 'log', 'reference', 'handoff', 'output'].includes(kind))) throw usageError('Unsupported --expand category');
      if (args.flag('manifest') && (expand.length || args.has('expand-path'))) throw usageError('--manifest cannot be combined with body expansion');
      const result = agentHandoff(root, source, { expand: expand as DocumentKind[], expandPaths: args.all('expand-path'), excludePaths: args.all('exclude-path'), preview: args.flag('preview') });
      const context = result.context;
      const guidance = executionGuidance();
      const state = computeReadiness(repository).get(id)!;
      const target = githubTargets(repository).get(source.graph);
      let github: GitHubView | undefined;
      if (target) {
        try { github = githubView(readGitHubState(root), id, target.repo); }
        catch (cause) { github = { ...githubView(undefined, id, target.repo), error: cause instanceof Error ? cause.message : String(cause) }; }
      }
      const withBody = (file: typeof context.content) => !args.flag('handoff')
        ? result.documents.find(d => d.kind === file.kind && d.source_task === file.source_task && d.read_path === file.read_path && d.section === file.section) ?? file : file;
      const task = { id, graph: source.graph, title: source.title, summary: source.summary, contentPath: context.content.path,
        status: source.status, claim: source.claim, dependsOn: source.dependsOn, subgraph: source.subgraph,
        planning: source.planning ?? 'static', planningState: state.planningState ?? 'static', refinement: source.refinement, kind: source.kind ?? 'work', result: source.status === 'done' ? 'pass' : source.status === 'reject' ? 'reject' : null,
        manualBlockers: source.manualBlockers, supersedes: source.supersedes, derivedFrom: source.derivedFrom,
        outputs: source.outputs.filter(o => contextFiles(context).some(f => f.source_task === id && f.path === o.path && f.sha256 === o.sha256)),
        readiness: state.readiness, blockedBy: state.blockedBy,
        ...(github ? { github } : {}),
        documents: { content: withBody(context.content), contents: context.contents.map(withBody), references: context.references.map(withBody), reports: context.reports.map(withBody),
          logs: context.logs.map(withBody), handoffs: context.handoffs.map(withBody), outputs: context.outputs.map(withBody) } };
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, output_mode: args.flag('preview') ? 'preview' : expand.length || args.has('expand-path') ? 'expanded' : 'manifest',
        task, context, guidance, preview: result.preview, ...(args.flag('handoff') ? { handoff: result.text } : {}) }, null, 2));
      else if (!args.flag('quiet')) {
        ctx.io.out(result.text + (args.flag('preview') ? '\n' + JSON.stringify(result.preview, null, 2) : '') + '\n\n' + formatExecutionGuidance(guidance));
      }
      return EXIT_OK;
    },
  };
}
