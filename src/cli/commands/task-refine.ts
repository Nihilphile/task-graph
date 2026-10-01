import { refineTask } from '../../core/refinement.js';
import { computeReadiness } from '../../core/readiness.js';
import { loadTaskRepository } from '../../core/repo.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';
import { EXIT_OK, type CommandSpec } from '../context.js';
import { emitResult } from '../output.js';

export function taskRefineCommands(): CommandSpec[] {
  return ['refine', 'unrefine'].map(action => ({
    name: `task ${action}`, summary: action === 'refine' ? 'Record controller assessment and make a dynamic task executable' : 'Return an unclaimed task to dynamic planning',
    usage: `task-graph task ${action} T-NNNN --reason <assessment> [--actor <controller>] [--cwd <dir>] [--json]`,
    details: ['Record controller approval after checking requirements and upstream capabilities. Input fingerprint checks are suspended.', 'Approval persists until unrefine; dependencies are still checked before execution.'],
    run(ctx, args) {
      const id = args.positionals[0], reason = args.opt('reason');
      if (!id || !reason) throw usageError('Pass task ID and --reason');
      const root = resolveCwd(ctx, args);
      const task = refineTask(root, { id, reason, reset: action === 'unrefine', actor: args.opt('actor'), now: () => ctx.now() });
      const state = computeReadiness(loadTaskRepository(root)).get(id);
      emitResult(ctx, args, { ok: true, task: { id, ...(args.flag('detail') ? { refinement: task.refinement } : {}), ...state } });
      return EXIT_OK;
    },
  }));
}
