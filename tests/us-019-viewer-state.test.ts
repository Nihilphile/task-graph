import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempWorkspace } from './helpers/temp.js';
import { buildViewerFixture } from './helpers/viewer-fixture.js';
import { click, openViewer, taskNode, type ViewerPage } from './helpers/viewer-dom.js';

function badge(node: Element): string {
  return node.querySelector('.badge')?.textContent ?? '';
}

function assertPanel(page: ViewerPage, taskId: string): void {
  const body = page.document.getElementById('details-body')!;
  assert.equal(body.querySelector('h3')?.textContent, taskId);
  const labels = [...body.querySelectorAll('dt')].map((term) => term.textContent);
  for (const label of ['Graph', 'Status', 'Readiness', 'Claim', 'Blocked by', 'Depends on']) {
    assert.ok(labels.includes(label), `details panel is missing the ${label} row`);
  }
}

test('US-019: every task state carries a colour class and a non-colour indicator', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-019-states'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());
  assert.deepEqual([...page.errors], []);

  const done = taskNode(page, ids.done);
  assert.ok((done.getAttribute('class') ?? '').includes('status-done'));
  assert.equal(badge(done), '\u2713', 'finished work needs a check mark');

  const running = taskNode(page, ids.partialSuccessor);
  assert.ok((running.getAttribute('class') ?? '').includes('status-in_progress'));
  assert.equal(badge(running), '\u25cf', 'running work needs a non-colour indicator');

  const blocked = taskNode(page, ids.blocked);
  assert.ok((blocked.getAttribute('class') ?? '').includes('status-blocked'));
  assert.equal(badge(blocked), '!', 'blocked work needs an exclamation indicator');

  const unready = taskNode(page, ids.convergence);
  assert.ok(unready.classList.contains('readiness-unready'));
  assert.equal(badge(unready), '◷');
  const ready = taskNode(page, ids.ready);
  assert.ok((ready.getAttribute('class') ?? '').includes('readiness-ready'));
  assert.equal(badge(ready), '\u25b6', 'ready work needs a ready indicator');

  const cancelled = taskNode(page, ids.cancelled);
  assert.ok((cancelled.getAttribute('class') ?? '').includes('status-cancelled'));
  assert.equal(badge(cancelled), '\u00d7', 'cancelled work needs a cancellation indicator');

  const css = page.document.querySelector('style')!.textContent ?? '';
  assert.ok(css.includes('.node.status-done .node-body { fill:#e7f8ef; stroke:#12b76a; }'), 'green finished');
  assert.ok(css.includes('.node.status-in_progress .node-body { fill:#fffaeb; stroke:#f79009; }'), 'yellow running');
  assert.ok(
    css.includes('.node.status-blocked .node-body { fill:#fff1f0; stroke:#d92d20; stroke-width:2; }'),
    'red blocked',
  );
  assert.ok(
    css.includes('.node.readiness-ready.status-todo .node-body { fill:#eff4ff; stroke:#2f6feb; }'),
    'blue ready',
  );
  assert.ok(
    css.includes('.node.status-cancelled .node-body { fill:#f2f4f7; stroke:#98a2b3; }'),
    'gray cancelled',
  );
  assert.ok(
    css.includes('.node.status-cancelled text.title { text-decoration:line-through; fill:var(--muted); }'),
    'cancelled nodes must be struck through',
  );
});

test('US-019: a claim is a separate label that never replaces state styling', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-019-claim'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  const node = taskNode(page, ids.partialSuccessor);
  assert.equal(node.querySelector('.claim')?.textContent, 'implementer / thread-1');
  assert.ok(node.querySelector('.claim-chip'), 'the claim label needs its own background chip');
  // The persisted status class and its colour rule still apply unchanged.
  assert.ok((node.getAttribute('class') ?? '').includes('status-in_progress'));
  assert.equal(node.querySelector('.badge')?.textContent, '\u25cf');
  const css = page.document.querySelector('style')!.textContent ?? '';
  assert.ok(css.includes('.node.status-in_progress .node-body { fill:#fffaeb; stroke:#f79009; }'));

  // An unclaimed task shows no claim label at all.
  assert.equal(taskNode(page, ids.ready).querySelector('.claim'), null);
});

test('US-019: clicking a node opens the side panel with Markdown and metadata', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-019-details'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  assert.ok((page.document.getElementById('details-body')!.textContent ?? '').includes('Select a task node'));

  click(page, taskNode(page, ids.partialSuccessor));
  assertPanel(page, ids.partialSuccessor);
  const body = page.document.getElementById('details-body')!;
  const values = [...body.querySelectorAll('dd')].map((item) => item.textContent ?? '');
  assert.ok(values.includes('in_progress'));
  assert.ok(values.some((value) => value.includes('implementer / thread-1')));
  // Rendered Markdown from the task body, not the raw source.
  assert.equal(body.querySelector('h1')?.textContent, '接入前端');
  assert.ok((body.textContent ?? '').includes('目标'));

  // Selecting another node replaces the panel instead of appending to it.
  click(page, taskNode(page, ids.done));
  assertPanel(page, ids.done);
  assert.equal(page.document.querySelectorAll('#details-body h1').length, 1);
  assert.equal(page.document.getElementById('details-body')!.querySelector('h1')?.textContent, '搭建仓库');
});

test('US-019: the side panel explains why a task is blocked', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-019-blocked'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  click(page, taskNode(page, ids.blocked));
  const text = page.document.getElementById('details-body')!.textContent ?? '';
  assert.ok(text.includes('等待设计稿'), 'the manual blocker text must be shown');
  assert.ok(text.includes('ready'), 'the computed readiness must be shown');

  click(page, taskNode(page, ids.convergence));
  const convergence = page.document.getElementById('details-body')!.textContent ?? '';
  assert.ok(convergence.includes('unmet dependency'), 'unmet dependencies must be listed');
});
