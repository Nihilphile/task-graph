import { executeReview, superviseReviews } from './core/review-runner.js';
const [root, review] = process.argv.slice(2);
if (!root) throw Error('Project root is required');
try { if (review) await executeReview(root, review); else await superviseReviews(root); }
catch (e) { process.stderr.write(String(e) + '\n'); process.exitCode = 1; }
