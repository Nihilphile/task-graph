import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempWorkspace } from './helpers/temp.js';
import { buildViewerFixture } from './helpers/viewer-fixture.js';
import {
  click,
  edges,
  mouseDrag,
  openChildGraph,
  openViewer,
  setChecked,
  taskNodes,
  typeInto,
  viewportScale,
  viewportTranslate,
  wheel,
  type ViewerPage,
} from './helpers/viewer-dom.js';

function nodeIds(page: ViewerPage): string[] {
  return taskNodes(page).map((node) => node.getAttribute('data-task') ?? '');
}

function edgePairs(page: ViewerPage): string[] {
  return edges(page)
    .map((edge) => `${edge.getAttribute('data-from')}->${edge.getAttribute('data-to')}`)
    .sort();
}

function message(page: ViewerPage): string {
  return page.document.getElementById('canvas-message')!.textContent ?? '';
}

function selectGraph(page: ViewerPage, graphId: string): void {
  const button = [...page.document.querySelectorAll('#graph-list button')].find((entry) =>
    (entry.textContent ?? '').startsWith(graphId),
  );
  assert.ok(button, `entry graph ${graphId} is missing`);
  click(page, button);
}

function drillInto(page: ViewerPage, compositeTaskId: string): void {
  openChildGraph(page, compositeTaskId);
}

test('US-021: pan, zoom and fit-to-view transform the canvas', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-viewport'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());
  assert.deepEqual([...page.errors], []);

  const start = viewportTranslate(page);
  mouseDrag(page, { x: 20, y: 20 }, { x: 60, y: 45 });
  const dragged = viewportTranslate(page);
  assert.equal(dragged.x, start.x + 40);
  assert.equal(dragged.y, start.y + 25);
  assert.equal(page.document.getElementById('graph')!.classList.contains('dragging'), false);

  click(page, page.document.querySelector('[data-view="zoom-in"]')!);
  assert.ok(Math.abs(viewportScale(page) - 1.2) < 1e-9);
  click(page, page.document.querySelector('[data-view="zoom-out"]')!);
  assert.ok(Math.abs(viewportScale(page) - 1) < 1e-9);
  wheel(page, -100);
  assert.ok(Math.abs(viewportScale(page) - 1.1) < 1e-9);
  wheel(page, 100);
  assert.ok(Math.abs(viewportScale(page) - 1) < 1e-9);

  click(page, page.document.querySelector('[data-view="fit"]')!);
  const fitted = viewportScale(page);
  assert.ok(fitted >= 0.2 && fitted <= 1.4, `fit must clamp into its supported range, got ${fitted}`);
  const offset = viewportTranslate(page);
  for (const node of page.document.querySelectorAll('#graph g.node')) {
    const position = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '');
    assert.ok(position);
    const rectangle = node.querySelector('rect')!;
    const left = Number(position[1]) * fitted + offset.x;
    const top = Number(position[2]) * fitted + offset.y;
    assert.ok(left >= 0 && top >= 0, 'fit keeps every card inside the viewport');
    assert.ok(left + Number(rectangle.getAttribute('width')) * fitted <= 800);
    assert.ok(top + Number(rectangle.getAttribute('height')) * fitted <= 600);
  }
  assert.ok(taskNodes(page).length > 0, 'fit must keep every node rendered');
});

test('US-021: nodes filter by persisted status and computed readiness', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-filters'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  assert.equal(taskNodes(page).length, 7);
  assert.deepEqual(edgePairs(page), [
    `${ids.blocked}->${ids.convergence}`,
    `${ids.composite}->${ids.partialSuccessor}`,
    `${ids.ready}->${ids.convergence}`,
  ].sort());

  setChecked(page, page.document.querySelector('[data-status-filter="todo"]')!, true);
  assert.deepEqual(nodeIds(page).sort(), [
    ids.blocked,
    ids.composite,
    ids.convergence,
    ids.ready,
  ].sort());
  // Edges to filtered-out nodes disappear with them.
  assert.deepEqual(edgePairs(page), [
    `${ids.blocked}->${ids.convergence}`,
    `${ids.ready}->${ids.convergence}`,
  ]);
  assert.ok((page.document.getElementById('filter-summary')!.textContent ?? '').includes('4/7'));

  setChecked(page, page.document.querySelector('[data-status-filter="todo"]')!, false);
  setChecked(page, page.document.querySelector('[data-readiness-filter="blocked"]')!, true);
  assert.deepEqual(nodeIds(page).sort(), [ids.blocked, ids.convergence].sort());

  setChecked(page, page.document.querySelector('[data-readiness-filter="blocked"]')!, false);
  setChecked(page, page.document.querySelector('[data-readiness-filter="ready"]')!, true);
  // Finished and cancelled work is not blocked, so it computes as ready; the
  // status filter is what narrows the canvas to open work.
  assert.deepEqual(nodeIds(page).sort(), [
    ids.composite,
    ids.cancelled,
    ids.done,
    ids.partialSuccessor,
    ids.ready,
  ].sort());

  // Both filter groups combine.
  setChecked(page, page.document.querySelector('[data-status-filter="todo"]')!, true);
  assert.deepEqual(nodeIds(page).sort(), [ids.composite, ids.ready].sort());
});

test('US-021: nodes filter by claim role and by claim session', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-claim-filter'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  const input = page.document.getElementById('claim-filter')!;
  typeInto(page, input, 'implementer');
  assert.deepEqual(nodeIds(page), [ids.partialSuccessor]);
  typeInto(page, input, 'thread-1');
  assert.deepEqual(nodeIds(page), [ids.partialSuccessor]);
  typeInto(page, input, 'nobody');
  assert.deepEqual(nodeIds(page), []);
});

test('US-021: the active filters are shared by every graph in the session', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-shared'));
  const { ids } = fixture;
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  setChecked(page, page.document.querySelector('[data-status-filter="todo"]')!, true);
  assert.equal(taskNodes(page).length, 4);

  // The filter survives a graph switch: the child task is already done.
  drillInto(page, ids.composite);
  assert.deepEqual(nodeIds(page), []);
  assert.equal(
    (page.document.querySelector('[data-status-filter="todo"]') as HTMLInputElement).checked,
    true,
  );
  assert.ok(message(page).includes('No task matches the active filters'));
  assert.ok(message(page).includes('status: todo'));
  assert.equal(page.document.getElementById('canvas-message')!.hidden, false);

  // Clearing it in the child graph restores that graph, and the same filter box
  // then applies to the deeper graph as well: filter state is page-wide.
  setChecked(page, page.document.querySelector('[data-status-filter="todo"]')!, false);
  assert.deepEqual(nodeIds(page), [ids.childComposite]);
  drillInto(page, ids.childComposite);
  assert.deepEqual(nodeIds(page), [ids.leaf]);

  typeInto(page, page.document.getElementById('claim-filter')!, 'implementer');
  assert.deepEqual(nodeIds(page), []);
  selectGraph(page, 'G-001');
  assert.deepEqual(nodeIds(page), [ids.partialSuccessor]);

  setChecked(page, page.document.querySelector('[data-status-filter="done"]')!, true);
  assert.deepEqual(nodeIds(page), []);
  assert.ok(message(page).includes('claim: implementer'));
  assert.ok(message(page).includes('status: done'));
});

test('US-021: clearing the filters restores every node and relationship', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-clear'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  setChecked(page, page.document.querySelector('[data-status-filter="cancelled"]')!, true);
  typeInto(page, page.document.getElementById('claim-filter')!, 'nobody');
  assert.deepEqual(nodeIds(page), []);
  assert.ok(edges(page).length === 0);
  const blockedMessage = message(page);
  assert.ok(blockedMessage.includes('status: cancelled'));
  assert.ok(blockedMessage.includes('claim: nobody'));

  click(page, page.document.getElementById('clear-filters')!);
  assert.equal(taskNodes(page).length, 7);
  assert.equal(edges(page).length, 3);
  assert.equal(
    (page.document.querySelector('[data-status-filter="cancelled"]') as HTMLInputElement).checked,
    false,
  );
  assert.equal((page.document.getElementById('claim-filter') as HTMLInputElement).value, '');
  assert.equal(page.document.getElementById('canvas-message')!.hidden, true);
  assert.ok((page.document.getElementById('filter-summary')!.textContent ?? '').includes('Showing all 7'));
});

test('US-021: an empty graph explains itself instead of showing a filter message', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-021-empty'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  selectGraph(page, fixture.entryGraphs[1]!);
  assert.equal(taskNodes(page).length, 0);
  assert.equal(message(page), 'This graph has no tasks yet.');
});
