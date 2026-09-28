import { EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { claimTask, reassignClaim, releaseClaim, formatClaim } from '../../core/claims.js';
import { emitResult } from '../output.js';
import type { ParsedArgs } from '../args.js';
import type { TaskDocument } from '../../core/task.js';
import { repairReceipt } from '../../core/repair.js';
import { taskContext } from '../../core/task-context.js';
import { contextView } from '../output.js';
import { executionGuidance } from '../execution-guidance.js';
import { resolveCwd } from '../paths.js';

/** The `task claim|release|reassign` commands. */
export function taskClaimCommands(): readonly CommandSpec[] {
  return [claimCommand(), releaseCommand(), reassignCommand()];
}

function claimCommand(): CommandSpec {
  return {
    name: 'task claim',
    summary: 'Claim a task for a role and session',
    usage:
      'task-graph task claim T-NNNN --role <role> --session-id <id> [--execution-id <id>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'role, session_id and claimed_at are always recorded together.',
      '--execution-id is optional supplementary metadata and never replaces --session-id.',
      'An existing claim is never overwritten silently: use `task reassign` or `task release` first.',
      'Nothing expires a claim automatically; release is always explicit.',
      'Accepting a blocked task also enters in_progress and returns repair context; prerequisites still apply.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = requirePositional(args, 'task claim T-NNNN --role <role> --session-id <id>');
      const task = claimTask(root, {
        id,
        role: args.opt('role') ?? '',
        sessionId: args.opt('session-id') ?? '',
        executionId: args.opt('execution-id'),
        actor: args.opt('actor'),
        now: () => ctx.now(),
      });
      report(ctx, args, `Claimed ${task.id} for ${task.claim ? formatClaim(task.claim) : '(none)'}`, task);
      return EXIT_OK;
    },
  };
}

function releaseCommand(): CommandSpec {
  return {
    name: 'task release',
    summary: 'Release the current claim explicitly',
    usage:
      'task-graph task release T-NNNN [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'The previous role and session are kept in history together with the actor and timestamp.',
      'Release never happens automatically, including for cancelled or long-running tasks.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = requirePositional(args, 'task release T-NNNN');
      const task = releaseClaim(root, {
        id,
        reason: args.opt('reason'),
        actor: args.opt('actor'),
        now: () => ctx.now(),
      });
      report(ctx, args, `Released ${task.id}`, task);
      return EXIT_OK;
    },
  };
}

function reassignCommand(): CommandSpec {
  return {
    name: 'task reassign',
    summary: 'Reassign a task, or take it over from its current claim',
    usage:
      'task-graph task reassign T-NNNN --role <role> --session-id <id> [--execution-id <id>] [--takeover] [--reason <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: [
      'Both paths record the previous and new claim identities plus the actor and timestamp.',
      '--takeover requires an existing claim; a plain reassign may assign an unclaimed task.',
      'Claims are never expired by a timeout, so a handover is always an explicit decision.',
      'Reassigning blocked work begins repair in_progress and archives prior waiting reasons.',
    ],
    run(ctx: CliContext, args): number {
      const root = resolveCwd(ctx, args);
      const id = requirePositional(args, 'task reassign T-NNNN --role <role> --session-id <id>');
      const task = reassignClaim(root, {
        id,
        role: args.opt('role') ?? '',
        sessionId: args.opt('session-id') ?? '',
        executionId: args.opt('execution-id'),
        takeover: args.flag('takeover'),
        reason: args.opt('reason'),
        actor: args.opt('actor'),
        now: () => ctx.now(),
      });
      const verb = args.flag('takeover') ? 'Took over' : 'Reassigned';
      report(
        ctx,
        args,
        `${verb} ${task.id} for ${task.claim ? formatClaim(task.claim) : '(none)'}`,
        task,
      );
      return EXIT_OK;
    },
  };
}

function requirePositional(
  args: { positionals: readonly string[] },
  usage: string,
): string {
  const id = args.positionals[0];
  if (id === undefined) {
    throw usageError('A task ID is required', [`Usage: task-graph ${usage}`]);
  }
  return id;
}

function report(
  ctx: CliContext,
  args: ParsedArgs,
  message: string,
  task: TaskDocument,
): void {
  const repair = repairReceipt(task);
  const guidance = repair ? executionGuidance() : undefined;
  emitResult(ctx, args, { ok: true, task: { id: task.id, status: task.status,
    ...(args.flag('detail') ? { title: task.title, claim: task.claim } : { claim: task.claim ? { role: task.claim.role, sessionId: task.claim.sessionId } : null }) },
    ...(repair ? { repair, context: contextView(taskContext(resolveCwd(ctx, args), task), args.flag('detail')),
      guidance: args.flag('detail') ? guidance : { skill_path: guidance!.skill_path, message: 'Read task-take and the previous blockers; record context readiness, then repair.' } } : {}) });
}
