import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { addTask } from '../../core/taskops.js';
import { resolveCwd } from '../paths.js';
import path from 'node:path';
import { addPlannedTasks, readTaskPlan } from '../../core/planning.js';
import { computeReadiness } from '../../core/readiness.js';
import { loadTaskRepository } from '../../core/repo.js';

export function taskAddCommand(): CommandSpec {
  return {
    name: 'task add',
    summary: 'Create tasks with content bindings and dependency arrays, individually or from a JSON plan',
    usage:
      'task-graph task add (--summary <text> [--content <path>] | --from <plan.json>) [--graph G-NNN | --parent-task T-NNNN] [--depends-on T-NNNN[:gate]]... [--key <key>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Content is a project-relative Markdown/text file, shared by the controller, worker and viewer.',
      '--from accepts a JSON plan with tasks[], stable keys and @key dependency/parent references; the whole batch is atomic.',
      '--parent-task creates/reuses its child graph and adds the new task to its completion targets.',
      'Legacy --title, --goal, --condition, --work-log, --blocker and --derived-from remain supported.',
      '--graph is required when the project registers more than one graph.',
      'Every successful command validates the graph and rebuilds the generated artifacts.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      if (args.opt('from') !== undefined) {
        for (const option of ['summary', 'title', 'content', 'parent-task', 'depends-on', 'key', 'goal', 'condition', 'work-log', 'blocker', 'derived-from']) {
          if (args.has(option)) throw usageError(`Put --${option} inside the plan when using --from.`);
        }
        const inputs = readTaskPlan(path.resolve(ctx.cwd, args.opt('from')!)).map((input) => ({ ...input, graph: input.graph ?? (input.parentTask ? undefined : args.opt('graph')), actor: args.opt('actor'), now: () => ctx.now() }));
        const result = addPlannedTasks(root, inputs);
        const states = computeReadiness(loadTaskRepository(root));
        const tasks = result.tasks.map((task) => ({ id: task.id, graph: task.graph, summary: task.title, content: task.content ?? null, file: `.task-graph/tasks/${task.id}.md`, ...states.get(task.id) }));
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, tasks, keys: result.keys, view: '.task-graph/generated/index.html' }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(tasks.map((task) => `${task.id} (${task.readiness}): ${task.summary}`).join('\n'));
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
        content: args.opt('content'),
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

      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify(
            { ok: true, task: { id: created.id, graph: created.graph, status: created.status, title: created.title,
              content: created.content ?? null, file: `.task-graph/tasks/${created.id}.md`, ...computeReadiness(loadTaskRepository(root)).get(created.id) }, view: '.task-graph/generated/index.html' },
            null,
            2,
          ),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(`Created ${created.id} in ${created.graph}: ${created.title}`);
      }
      return EXIT_OK;
    },
  };
}
