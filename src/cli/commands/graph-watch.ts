import { watchGraph, unwatchGraph, watchStatus, retryWatchEvent, kickWatchWorker, deliverWatch } from '../../core/watch.js';
import { usageError } from '../../core/errors.js';
import { resolveCwd } from '../paths.js';
import { EXIT_OK, type CommandSpec } from '../context.js';

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
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, ...(subscription ? { subscription: { id: subscription.id, graph, thread: subscription.thread } } : {}), ...status }, null, 2));
      else if (!args.flag('quiet')) ctx.io.out(JSON.stringify(status, null, 2));
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
      if (args.flag('json')) ctx.io.out(JSON.stringify({ ok: true, ...watchStatus(root, graph) }, null, 2));
      return EXIT_OK;
    },
  }];
}
