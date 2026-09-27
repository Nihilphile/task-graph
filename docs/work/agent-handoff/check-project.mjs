// Read-only manifest check. Deliberately emit only counts, never task or attachment text.
import { main } from '../../../dist/src/cli/main.js';
const root = process.argv[2];
const ids = process.argv.slice(3);
if (!root || !ids.length) throw new Error('Pass project root and task IDs');
for (const id of ids) {
  const output = [];
  const code = await main(['task', 'show', id, '--handoff', '--manifest', '--json'], {
    cwd: root, io: { out: s => output.push(s), err: () => {} },
  });
  if (code !== 0) { console.log(JSON.stringify({ id, code })); continue; }
  let value;
  try { value = JSON.parse(output.join('\n')); }
  catch { console.log(JSON.stringify({ id, code: 'invalid_json' })); continue; }
  console.log(JSON.stringify({ id, mode: value.output_mode, handoff_chars: value.handoff?.length,
    reports: value.context.reports.length, references: value.context.references.length,
    excluded: value.context.excluded.length,
    expanded_files: value.preview.selected_files.length }));
}
