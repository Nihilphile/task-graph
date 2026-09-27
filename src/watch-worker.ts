import { deliverWatch } from './core/watch.js';
const root = process.argv[2];
if (root) await deliverWatch(root).catch(() => { process.exitCode = 1; });
