import { recordTaskError } from '../../core/error-book.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';
import { emitResult } from '../output.js';
import { EXIT_OK, type CommandSpec } from '../context.js';

export function taskRecordErrorCommand(): CommandSpec {
  return {
    name: 'task record-error',
    summary: 'Append an observed incident to the error-book without changing task status',
    usage: 'task-graph task record-error T-NNNN --error-report <file.md> [--actor <name>] [--cwd <dir>] [--json]',
    details: ['Use for actual rework or extra work, including changes missed after refinement. Each successful call records one incident; inspect the error-book before retrying an uncertain result.'],
    run(ctx, args) {
      const id = args.positionals[0], report = args.opt('error-report');
      if (!id || !report) throw usageError('Pass task ID and --error-report');
      const task = recordTaskError(resolveCwd(ctx, args), { id, report, actor: args.opt('actor'), now: () => ctx.now() });
      emitResult(ctx, args, { ok: true, task: { id: task.id, status: task.status }, entry: {
        id: `${task.id}:${task.history.length - 1}`, read_path: task.history.at(-1)!.extra['error_snapshot'],
      } });
      return EXIT_OK;
    },
  };
}
