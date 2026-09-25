import { EXIT_OK, type CommandSpec } from '../context.js';
import { TaskGraphError, usageError } from '../../core/errors.js';
import { createGraphProjection } from '../../core/projection.js';
import { loadTaskRepository } from '../../core/repo.js';
import { assertRepositoryValid } from '../../core/validate.js';
import { resolveCwd } from '../paths.js';
import { handoffText } from '../../core/documents.js';

export function taskInspectCommands(): readonly CommandSpec[] {
  return [listCommand(), showCommand()];
}

function listCommand(): CommandSpec {
  return {
    name: 'task list',
    summary: 'List current tasks and computed readiness',
    usage: 'task-graph task list [--available] [--graph G-NNN] [--status todo|in_progress|done|cancelled] [--readiness ready|blocked] [--cwd <dir>] [--json]',
    details: ['Reads source files and computes readiness; generated graph.json does not need to be current.'],
    run(ctx, args): number {
      const root = resolveCwd(ctx, args);
      assertRepositoryValid(root);
      const projection = createGraphProjection(root);
      const status = args.opt('status');
      const graph = args.opt('graph');
      const readiness = args.opt('readiness');
      if (status && !['todo', 'in_progress', 'done', 'cancelled'].includes(status)) {
        throw usageError(`Unsupported status "${status}"`);
      }
      if (readiness && !['ready', 'blocked'].includes(readiness)) {
        throw usageError(`Unsupported readiness "${readiness}"`);
      }
      if (graph && !projection.graphs.some((item) => item.id === graph)) {
        throw usageError(`Unknown graph "${graph}"`);
      }
      const tasks = projection.tasks
        .filter((task) => !args.flag('available') || (task.status === 'todo' && task.readiness === 'ready' && task.claim === null))
        .filter((task) => !graph || task.graph === graph)
        .filter((task) => !status || task.status === status)
        .filter((task) => !readiness || task.readiness === readiness)
        .map(({ id, graph, title, status, readiness, blockedBy, claim, outputs, github }) => ({
          id, graph, title, status, readiness, blockedBy, claim, outputs, ...(github ? { github } : {}),
        }));
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
    summary: 'Show a task with its computed blockers, outputs and work log',
    usage: 'task-graph task show T-NNNN [--handoff] [--cwd <dir>] [--json]',
    details: ['Reads source files and computes readiness; includes current history in JSON output.'],
    run(ctx, args): number {
      const id = args.positionals[0];
      if (!id) throw usageError('A task ID is required', ['Pass T-NNNN.']);
      const root = resolveCwd(ctx, args);
      assertRepositoryValid(root);
      const source = loadTaskRepository(root).taskById(id);
      if (!source) throw new TaskGraphError('E_NO_TASK', `Task "${id}" was not found`);
      if (args.flag('handoff')) {
        const content = handoffText(root, source);
        if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task: { id, contentPath: source.content ?? `.task-graph/tasks/${id}.md` }, handoff: content }, null, 2));
        else if (!args.flag('quiet')) ctx.io.out(content);
        return EXIT_OK;
      }
      const projected = createGraphProjection(root).tasks.find((task) => task.id === id);
      if (!projected) throw new TaskGraphError('E_INTERNAL', `Task "${id}" has no projection`);
      const { html: _html, ...view } = projected;
      const task = { ...view, history: source.history };
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, task }, null, 2));
      else if (!args.flag('quiet')) {
        ctx.io.out(`${task.id}  ${task.status}  ${task.readiness}  ${task.title}\n` +
          `Graph: ${task.graph}\n` +
          (task.github ? `GitHub: ${task.github.status}${task.github.url ? ' ' + task.github.url : ''}\n` : '') +
          `Blocked by: ${task.blockedBy.length ? JSON.stringify(task.blockedBy) : '(none)'}\n` +
          `Outputs: ${task.outputs.length ? task.outputs.map((output) => output.path).join(', ') : '(none)'}\n\n` +
          task.body.trimEnd());
      }
      return EXIT_OK;
    },
  };
}
