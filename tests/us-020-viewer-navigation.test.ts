import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempWorkspace } from './helpers/temp.js';
import { buildViewerFixture } from './helpers/viewer-fixture.js';
import { click, openViewer, taskNode, taskNodes, type ViewerPage } from './helpers/viewer-dom.js';

function sidebar(page: ViewerPage): { id: string; title: string }[] {
  return [...page.document.querySelectorAll('#graph-list button')].map((button) => {
    const text = button.textContent ?? '';
    const [id, title] = text.split(' \u00b7 ');
    return { id: id ?? '', title: title ?? '' };
  });
}

function selectGraph(page: ViewerPage, graphId: string): void {
  const button = [...page.document.querySelectorAll('#graph-list button')].find((entry) =>
    (entry.textContent ?? '').startsWith(graphId),
  );
  assert.ok(button, `entry graph ${graphId} is missing from the sidebar`);
  click(page, button);
}

function breadcrumbs(page: ViewerPage): string[] {
  return [...page.document.querySelectorAll('#breadcrumbs button')].map(
    (button) => button.textContent ?? '',
  );
}

test('US-020: the sidebar lists every entry graph and switches the canvas', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-sidebar'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());
  assert.deepEqual([...page.errors], []);

  assert.deepEqual(
    sidebar(page).map((entry) => entry.id),
    [...fixture.entryGraphs],
  );
  assert.ok(sidebar(page)[0]!.title.length > 0);

  selectGraph(page, fixture.entryGraphs[1]!);
  assert.equal(taskNodes(page).length, 0, 'the second entry graph is empty');
  assert.equal(
    page.document.querySelector('#graph-list button[aria-current="true"]')?.textContent?.startsWith(
      fixture.entryGraphs[1]!,
    ),
    true,
  );
  assert.equal(page.window.location.hash, `#graph=${fixture.entryGraphs[1]}`);

  selectGraph(page, fixture.entryGraphs[0]!);
  assert.ok(taskNodes(page).length >= 5);
});

test('US-020: a composite task opens its child graph and breadcrumbs walk back', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-drilldown'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  assert.deepEqual(breadcrumbs(page), ['交付登录能力 (G-001)']);

  click(page, taskNode(page, fixture.ids.composite));
  const button = page.document.querySelector('#details-body .composite-button');
  assert.ok(button, 'a composite task needs a control that opens its child graph');
  assert.equal(button.getAttribute('data-graph'), fixture.childGraph);
  click(page, button);

  assert.equal(page.window.location.hash, `#graph=${fixture.childGraph}`);
  assert.deepEqual(
    taskNodes(page).map((node) => node.getAttribute('data-task')),
    [fixture.ids.childComposite],
  );
  assert.deepEqual(breadcrumbs(page), ['交付登录能力 (G-001)', '登录子图 (G-002)']);

  // Drill one level deeper, then walk the unique parent chain back.
  click(page, taskNode(page, fixture.ids.childComposite));
  click(page, page.document.querySelector('#details-body .composite-button')!);
  assert.equal(page.window.location.hash, `#graph=${fixture.grandchildGraph}`);
  assert.deepEqual(breadcrumbs(page), [
    '交付登录能力 (G-001)',
    '登录子图 (G-002)',
    '接口联调 (G-003)',
  ]);

  click(page, page.document.querySelectorAll('#breadcrumbs button')[0]!);
  assert.equal(page.window.location.hash, '#graph=G-001');
  assert.ok(taskNodes(page).length >= 5);
});

test('US-020: the hash stores the current graph and selected task', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-hash'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  click(page, taskNode(page, fixture.ids.blocked));
  assert.equal(page.window.location.hash, `#graph=G-001&task=${fixture.ids.blocked}`);
  assert.equal(
    page.document.getElementById('details-body')!.querySelector('h3')?.textContent,
    fixture.ids.blocked,
  );
});

test('US-020: reloading a valid hash restores the graph and the selected task', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-reload'));
  const page = await openViewer(fixture.indexFile, {
    hash: `#graph=${fixture.childGraph}&task=${fixture.ids.childComposite}`,
  });
  t.after(() => page.close());
  assert.deepEqual([...page.errors], []);

  assert.deepEqual(
    taskNodes(page).map((node) => node.getAttribute('data-task')),
    [fixture.ids.childComposite],
  );
  assert.equal(
    page.document.getElementById('details-body')!.querySelector('h3')?.textContent,
    fixture.ids.childComposite,
  );
  assert.equal(page.window.location.hash, `#graph=${fixture.childGraph}&task=${fixture.ids.childComposite}`);
});

test('US-020: an invalid hash shows an actionable message and a route back', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-invalid'));
  const page = await openViewer(fixture.indexFile, { hash: '#graph=G-999&task=T-0001' });
  t.after(() => page.close());

  const message = page.document.getElementById('canvas-message')!;
  assert.equal(message.hidden, false);
  assert.ok((message.textContent ?? '').includes('G-999'), 'the message must name the unknown graph');

  const fallback = page.document.getElementById('hash-fallback');
  assert.ok(fallback, 'an invalid hash needs a route back to an entry graph');
  assert.ok((fallback.textContent ?? '').includes('交付登录能力'));
  click(page, fallback);

  assert.equal(page.window.location.hash, '#graph=G-001');
  assert.equal(message.hidden, true);
  assert.ok(taskNodes(page).length >= 5);
});

test('US-020: an unknown graph never leaves the canvas blank without a message', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-020-invalid-refresh'));
  const page = await openViewer(fixture.indexFile, { hash: '#graph=G-404' });
  t.after(() => page.close());

  // Re-rendering (for example after a filter change) must not lose the recovery
  // route, so the invalid-hash message is rebuilt by the renderer as well.
  const first = page.document.getElementById('claim-filter')!;
  (first as HTMLInputElement).value = 'nobody';
  first.dispatchEvent(new page.window.Event('input', { bubbles: true }));

  const message = page.document.getElementById('canvas-message')!;
  assert.equal(message.hidden, false);
  assert.ok((message.textContent ?? '').includes('G-404'));
  assert.ok(page.document.getElementById('hash-fallback'));
});
