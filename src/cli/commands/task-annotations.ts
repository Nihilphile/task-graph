import { EXIT_OK, type CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';
import { addTaskOutput, addWorkLog, removeTaskOutput } from '../../core/annotations.js';
import { resolveCwd } from '../paths.js';
import { emitResult, visibleOutputs } from '../output.js';

export function taskAnnotationCommands(): readonly CommandSpec[] {
  return [logCommand(), outputAddCommand(), outputRemoveCommand()];
}

function logCommand(): CommandSpec {
  return {
    name: 'task log',
    summary: 'Append a visible work log entry to a task',
    usage: 'task-graph task log T-NNNN --text <markdown> [--actor <name>] [--cwd <dir>] [--json]',
    details: ['Appends to the managed log for new tasks; legacy inline 工作记录 sections remain supported.'],
    run(ctx, args): number {
      const id = requireId(args.positionals[0]);
      const text = args.opt('text');
      if (text === undefined) throw usageError('Work log text is required', ['Pass --text <markdown>.']);
      const task = addWorkLog(resolveCwd(ctx, args), { id, text, actor: args.opt('actor'), now: () => ctx.now() });
      const managed = task.outputs.find(o => o.path === `.task-graph/logs/${id}.md`);
      emitResult(ctx, args, { ok: true, task: { id, ...(args.flag('detail') ? { outputs: visibleOutputs(task.outputs) } : {}) },
        log: managed ? { read_path: managed.path } : { read_path: `.task-graph/tasks/${id}.md`, section: 'work_log' } });
      return EXIT_OK;
    },
  };
}

function outputAddCommand(): CommandSpec {
  return {
    name: 'task output add',
    summary: 'Add a project-relative output path to a task',
    usage: 'task-graph task output add T-NNNN --path <path> [--note <text>] [--actor <name>] [--cwd <dir>] [--json]',
    details: ['The path is recorded in frontmatter outputs; the file need not exist yet.'],
    run(ctx, args): number {
      const id = requireId(args.positionals[0]);
      const outputPath = requirePath(args.opt('path'));
      const task = addTaskOutput(resolveCwd(ctx, args), {
        id, path: outputPath, note: args.opt('note'), actor: args.opt('actor'), now: () => ctx.now(),
      });
      emitResult(ctx, args, { ok: true, task: { id, ...(args.flag('detail') ? { outputs: visibleOutputs(task.outputs) } : {}) }, output: task.outputs.at(-1) });
      return EXIT_OK;
    },
  };
}

function outputRemoveCommand(): CommandSpec {
  return {
    name: 'task output remove',
    summary: 'Remove a project-relative output path from a task',
    usage: 'task-graph task output remove T-NNNN --path <path> [--actor <name>] [--cwd <dir>] [--json]',
    details: ['The path must match a listed output; the artifact itself is untouched.'],
    run(ctx, args): number {
      const id = requireId(args.positionals[0]);
      const outputPath = requirePath(args.opt('path'));
      const task = removeTaskOutput(resolveCwd(ctx, args), {
        id, path: outputPath, actor: args.opt('actor'), now: () => ctx.now(),
      });
      emitResult(ctx, args, { ok: true, task: { id, ...(args.flag('detail') ? { outputs: visibleOutputs(task.outputs) } : {}) }, removed: outputPath });
      return EXIT_OK;
    },
  };
}

function requireId(id: string | undefined): string {
  if (!id) throw usageError('A task ID is required', ['Pass T-NNNN.']);
  return id;
}

function requirePath(value: string | undefined): string {
  if (value === undefined) throw usageError('An output path is required', ['Pass --path <path>.']);
  return value;
}
