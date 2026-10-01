import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { addTask } from '../../core/taskops.js';
import { resolveCwd } from '../paths.js';
import path from 'node:path';
import { addPlannedTasks, readTaskPlan, choice } from '../../core/planning.js';
import { computeReadiness } from '../../core/readiness.js';
import { loadTaskRepository } from '../../core/repo.js';
import { emitResult } from '../output.js';

export function taskAddCommand(): CommandSpec {
  return {
    name: 'task add',
    summary: 'Create tasks with content bindings and dependency arrays, individually or from a JSON plan',
    usage:
      'task-graph task add (--summary <text> [--content <path>]... | --from <plan.json>) [--planning static|dynamic] [--kind work|acceptance|decision] [--graph G-NNN | --parent-task T-NNNN] [--depends-on T-NNNN[:gate]]... [--contract C-NNNN[#section] ...] [--reference R-NNNN ...] [--key <key>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Content is a project-relative Markdown/text file, shared by the controller, worker and viewer.',
      'Repeat --content, or use a content array in JSON. All current content files jointly define the requirements.',
      'Dynamic tasks start as skeletons; task refine is required after dependencies finish. Static remains the default.',
      '--from accepts a JSON plan with tasks[], stable keys and @key dependency/parent references; the whole batch is atomic.',
      '--parent-task creates/reuses its child graph and adds the new task to its completion targets.',
      'Legacy --title, --goal, --condition, --work-log, --blocker and --derived-from remain supported.',
      '--graph is required when the project registers more than one graph.',
      'Every successful command validates the graph and rebuilds the generated artifacts.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      if (args.opt('from') !== undefined) {
        for (const option of ['summary', 'title', 'content', 'planning', 'kind', 'parent-task', 'depends-on', 'key', 'goal', 'condition', 'work-log', 'blocker', 'derived-from', 'contract', 'reference']) {
          if (args.has(option)) throw usageError(`Put --${option} inside the plan when using --from.`);
        }
        const plan = readTaskPlan(path.resolve(ctx.cwd, args.opt('from')!));
        if (ctx.scopedGraph && plan.some(input => input.parentTask || (input.graph && input.graph !== ctx.scopedGraph))) {
          throw usageError('Every task in this plan must belong to the addressed graph. Use task add --from for a plan spanning graphs or parent tasks.');
        }
        const inputs = plan.map((input) => ({ ...input, graph: input.graph ?? (input.parentTask ? undefined : args.opt('graph')), actor: args.opt('actor'), now: () => ctx.now() }));
        const result = addPlannedTasks(root, inputs);
        const states = computeReadiness(loadTaskRepository(root));
        const tasks = result.tasks.map((task) => ({ id: task.id, graph: task.graph, summary: task.title, status: task.status,
          ...(args.flag('detail') ? { content: task.content ?? null, file: `.task-graph/tasks/${task.id}.md` } : {}), ...states.get(task.id) }));
        emitResult(ctx, args, { ok: true, tasks, keys: result.keys, ...(args.flag('detail') ? { view: '.task-graph/generated/index.html' } : {}) });
        return EXIT_OK;
      }
      const title = args.opt('title');
      const summary = args.opt('summary');
      if (title === undefined && summary === undefined) {
        throw usageError('A task title is required', ['Pass --title <title>.']);
      }
      const created = addTask(root, {
        graph: args.opt('graph'),
        title,
        summary,
        ...(args.has('contract') ? { contracts: args.all('contract') } : {}),
        ...(args.has('reference') ? { references: args.all('reference') } : {}),
        content: args.opt('content'),
        planning: choice(args.opt('planning'), ['static', 'dynamic'] as const, 'planning'),
        kind: choice(args.opt('kind'), ['work', 'acceptance', 'decision'] as const, 'kind'),
        ...(args.all('content').length > 1 ? { contentFiles: args.all('content').slice(1) } : {}),
        parentTask: args.opt('parent-task'),
        key: args.opt('key'),
        goal: args.opt('goal'),
        completionConditions: args.all('condition'),
        workLog: args.all('work-log'),
        dependsOnSpecs: args.all('depends-on'),
        manualBlockers: args.all('blocker'),
        derivedFrom: args.all('derived-from'),
        actor: args.opt('actor'),
        now: () => ctx.now(),
      });

      if (!args.flag('detail')) {
        emitResult(ctx, args, { ok: true, task: { id: created.id, graph: created.graph, status: created.status, title: created.title,
          ...computeReadiness(loadTaskRepository(root)).get(created.id) } });
        return EXIT_OK;
      }

      emitResult(ctx, args, { ok: true, task: { id: created.id, graph: created.graph, status: created.status, title: created.title,
        content: created.content ?? null, file: `.task-graph/tasks/${created.id}.md`, ...computeReadiness(loadTaskRepository(root)).get(created.id) }, view: '.task-graph/generated/index.html' });
      return EXIT_OK;
    },
  };
}
