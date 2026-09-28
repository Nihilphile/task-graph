import { watchGraph, unwatchGraph, watchStatus, retryWatchEvent, kickWatchWorker, deliverWatch, readWatchLedger } from '../../core/watch.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';
import { EXIT_OK, type CommandSpec } from '../context.js';
import { emitResult } from '../output.js';

export function graphWatchCommands(): CommandSpec[] {
  return [{
    name: 'graph watch', summary: 'Explicitly subscribe a Desktop thread to future graph/subgraph results',
    usage: 'task-graph graph watch G-NNN --thread <UUID> | --status | --flush | --retry <event-id> [--allow-duplicate] [--cwd <dir>] [--json]',
    details: ['No implicit environment registration. Repeated active graph/thread registration is idempotent; no historical result backfill. Future pass/reject and entry into blocked (manual or review) notify; remaining blocked does not repeat.', 'Desktop queue starts a subsequent turn; acceptance is not consumption. Unknown delivery outcomes are not automatically retried.', '--status is read-only. --flush resumes the project delivery worker. --retry targets a paused/uncertain event in this graph subscription.'],
    async run(ctx, args) {
      const root = resolveCwd(ctx, args), graph = args.positionals[0];
      if (!graph) throw usageError('Pass graph ID');
      if ([args.has('thread'), args.flag('status'), args.flag('flush'), args.has('retry')].filter(Boolean).length !== 1) throw usageError('Choose --thread, --status, --flush or --retry');
      if (args.flag('allow-duplicate') && !args.has('retry')) throw usageError('--allow-duplicate requires --retry');
      let subscription;
      if (args.has('thread')) subscription = await watchGraph(root, graph, args.opt('thread')!, ctx.desktopAdapter);
      else {
        watchStatus(root, graph);
        if (args.has('retry')) retryWatchEvent(root, args.opt('retry')!, args.flag('allow-duplicate'), graph);
      }
      if (!args.flag('status')) {
        if (ctx.desktopAdapter && args.flag('flush')) await deliverWatch(root, ctx.desktopAdapter, { singlePass: true });
        else if (!ctx.desktopAdapter) kickWatchWorker(root);
      }
      const status = watchStatus(root, graph);
      if (!args.flag('detail')) {
        if (subscription) emitResult(ctx, args, { ok: true, subscription: { id: subscription.id, graph, thread: subscription.thread, active: subscription.active } });
        else if (args.has('retry')) {
          const event = readWatchLedger(root)!.events.find(e => e.id === args.opt('retry'))!;
          emitResult(ctx, args, { ok: true, graph, event: { id: event.id, state: event.state, ...(event.error ? { error: event.error } : {}) } });
        } else emitResult(ctx, args, { ok: true, graph,
          ...(args.flag('status') ? { subscriptions: status.subscriptions.map(s => ({ thread: s.thread, active: s.active })) } : {}),
          counts: status.counts, delivery: status.delivery, consumption: status.consumption,
          events: (readWatchLedger(root)?.events ?? []).filter(e => status.subscriptions.some(s => s.id === e.subscription) && ['paused', 'uncertain'].includes(e.state)).map(e => ({ id: e.id, task: e.task, state: e.state, error: e.error,
            recovery: `graph[${graph}].watch retry ${e.id}${e.state === 'uncertain' ? ' --allow-duplicate (only after checking the target chat)' : ''}` })) });
        return EXIT_OK;
      }
      emitResult(ctx, args, { ok: true, ...(subscription ? { subscription: { id: subscription.id, graph, thread: subscription.thread } } : {}), ...status });
      return EXIT_OK;
    },
  }, {
    name: 'graph unwatch', summary: 'Unsubscribe a Desktop thread and cancel unsent notifications',
    usage: 'task-graph graph unwatch G-NNN --thread <UUID> [--cwd <dir>] [--json]',
    details: ['Does not withdraw an already in-flight or accepted Desktop message. Future registration does not replay cancelled notifications.'],
    run(ctx, args) {
      const root = resolveCwd(ctx, args), graph = args.positionals[0], thread = args.opt('thread');
      if (!graph || !thread) throw usageError('Pass graph ID and --thread UUID');
      unwatchGraph(root, graph, thread);
      emitResult(ctx, args, args.flag('detail') ? { ok: true, ...watchStatus(root, graph) } : { ok: true, graph, thread, active: false });
      return EXIT_OK;
    },
  }];
}
