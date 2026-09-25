import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { reviseTask, replaceTask } from '../../core/taskops.js';
import { resolveCwd } from '../paths.js';

export function taskReviseCommand(): CommandSpec {
  return {
    name: 'task revise',
    summary: 'Revise a task in place, keeping its ID and file name',
    usage:
      'task-graph task revise T-NNNN [--summary <text>] [--content <path>] [--title <text>] [--goal <text>] [--condition <text>]... [--note <text>] [--actor <name>] [--replace] [--reason <text>] [--cwd <dir>] [--json]',
    details: [
      'The task ID and T-NNNN.md file name never change; a revised history event is appended.',
      '--note is stored in history only. Use `task log` for a visible 工作记录 entry.',
      'Use --replace when the goal itself changed: the old task is cancelled, a new task ID is created, and supersedes links them.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = args.positionals[0];
      if (id === undefined) {
        throw usageError('A task ID is required', ['Usage: task-graph task revise T-NNNN ...']);
      }
      const conditions = args.all('condition');

      if (args.flag('replace')) {
        const title = args.opt('summary') ?? args.opt('title');
        if (title === undefined) {
          throw usageError('A replacement title is required', ['Pass --title <text>.']);
        }
        const result = replaceTask(root, {
          id,
          title,
          summary: args.opt('summary'),
          content: args.opt('content'),
          reason: args.opt('reason'),
          goal: args.opt('goal'),
          completionConditions: conditions.length > 0 ? conditions : undefined,
          actor: args.opt('actor'),
          now: () => ctx.now(),
        });
        if (args.flag('json')) {
          ctx.io.out(
            JSON.stringify(
              {
                ok: true,
                cancelled: result.cancelled.id,
                created: result.created.id,
              },
              null,
              2,
            ),
          );
        } else if (!args.flag('quiet')) {
          ctx.io.out(
            `Replaced ${result.cancelled.id} with ${result.created.id}: ${result.created.title}`,
          );
        }
        return EXIT_OK;
      }

      const revised = reviseTask(root, {
        id,
        title: args.opt('title'),
        summary: args.opt('summary'),
        content: args.opt('content'),
        goal: args.opt('goal'),
        completionConditions: conditions.length > 0 ? conditions : undefined,
        note: args.opt('note'),
        actor: args.opt('actor'),
        now: () => ctx.now(),
      });
      if (args.flag('json')) {
        ctx.io.out(
          JSON.stringify({ ok: true, task: { id: revised.id, title: revised.title } }, null, 2),
        );
      } else if (!args.flag('quiet')) {
        ctx.io.out(`Revised ${revised.id}: ${revised.title}`);
      }
      return EXIT_OK;
    },
  };
}
