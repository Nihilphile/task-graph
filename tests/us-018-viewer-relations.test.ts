import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempWorkspace } from './helpers/temp.js';
import { buildViewerFixture } from './helpers/viewer-fixture.js';
import {
  click,
  edges,
  openChildGraph,
  openViewer,
  sourceNodes,
  taskNode,
  taskNodes,
  typeInto,
} from './helpers/viewer-dom.js';

function nodeX(node: Element): number {
  const transform = node.getAttribute('transform') ?? '';
  const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(transform);
  assert.ok(match, `node has no translate transform: ${transform}`);
  return Number(match[1]);
}

function nodeY(node: Element): number {
  const transform = node.getAttribute('transform') ?? '';
  const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(transform);
  assert.ok(match, `node has no translate transform: ${transform}`);
  return Number(match[2]);
}

test('US-018: the selected graph is laid out left to right', (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-layout'));
  const { ids } = fixture;

  return openViewer(fixture.indexFile).then((page) => {
    t.after(() => page.close());
    assert.deepEqual([...page.errors], []);

    // A successor sits one column right of the task it depends on.
    assert.ok(
      nodeX(taskNode(page, ids.partialSuccessor)) > nodeX(taskNode(page, ids.composite)),
      'a partial successor must be right of its predecessor',
    );

    // Independent branches share a column and the convergence node sits right of
    // both of them, so parallel work can converge or stop on its own.
    const blocked = taskNode(page, ids.blocked);
    const ready = taskNode(page, ids.ready);
    const cancelled = taskNode(page, ids.cancelled);
    const convergence = taskNode(page, ids.convergence);
    assert.equal(nodeX(blocked), nodeX(ready));
    assert.equal(nodeX(ready), nodeX(cancelled));
    assert.ok(nodeX(convergence) > nodeX(blocked));
    assert.ok(nodeX(convergence) > nodeX(ready));
    // Independent roots keep their own row instead of being merged.
    assert.notEqual(nodeY(blocked), nodeY(ready));

    // The partial successor terminates the chain instead of re-converging.
    const outgoing = edges(page, 'full').filter((edge) => edge.getAttribute('data-from') === ids.partialSuccessor);
    assert.deepEqual(outgoing, []);
  });
});

test('US-018: full dependencies are solid and partial dependencies are labelled', (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-edges'));
  const { ids } = fixture;

  return openViewer(fixture.indexFile).then((page) => {
    t.after(() => page.close());
    assert.deepEqual([...page.errors], []);

    const full = edges(page, 'full').map((edge) => `${edge.getAttribute('data-from')}->${edge.getAttribute('data-to')}`);
    assert.deepEqual(full.sort(), [
      `${ids.blocked}->${ids.convergence}`,
      `${ids.ready}->${ids.convergence}`,
    ]);

    const partial = edges(page, 'partial');
    assert.equal(partial.length, 1);
    assert.equal(partial[0]!.getAttribute('data-from'), ids.composite);
    assert.equal(partial[0]!.getAttribute('data-to'), ids.partialSuccessor);

    // The completion point name is rendered next to the dashed edge.
    const labels = [...page.document.querySelectorAll('#graph text.edge-label')].map(
      (label) => label.textContent,
    );
    assert.ok(labels.includes(fixture.gateName), `partial edge label missing: ${labels.join(', ')}`);

    // Style contract: solid for full, dashed and coloured for partial.
    const css = page.document.querySelector('style')!.textContent ?? '';
    assert.ok(css.includes('.edge-full { stroke:#475467; stroke-width:1.6; }'));
    assert.ok(css.includes('.edge-partial { stroke:#7a5af8; stroke-width:1.6; stroke-dasharray:7 4; }'));
  });
});

test('US-018: derives render as gray dotted source lines without implying readiness', (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-derives'));
  const { ids, sourceId } = fixture;

  return openViewer(fixture.indexFile).then((page) => {
    t.after(() => page.close());
    assert.deepEqual([...page.errors], []);

    openChildGraph(page, ids.composite);
    const sources = sourceNodes(page);
    assert.deepEqual(sources.map((node) => node.getAttribute('data-source')), [sourceId]);
    // The source is not executable work: it carries no status or readiness.
    const sourceClasses = sources[0]!.getAttribute('class') ?? '';
    assert.ok(sourceClasses.includes('source'));
    assert.equal(/status-|readiness-/.test(sourceClasses), false);

    const derives = edges(page, 'derives');
    assert.equal(derives.length, 1);
    assert.equal(derives[0]!.getAttribute('data-from'), sourceId);
    assert.equal(derives[0]!.getAttribute('data-to'), ids.childComposite);
    assert.ok((derives[0]!.getAttribute('class') ?? '').includes('edge-derives'));

    const css = page.document.querySelector('style')!.textContent ?? '';
    assert.ok(css.includes('.edge-derives { stroke:#98a2b3; stroke-width:1.4; stroke-dasharray:2 4; }'));

    // The derived task is still ready: derives never participates in readiness.
    const derived = taskNode(page, ids.childComposite);
    assert.equal(derived.getAttribute('data-readiness'), 'ready');
    assert.equal(derives[0]!.getAttribute('data-mode'), 'derives');

    const projection = JSON.parse(
      fixture.workspace.read('.task-graph/generated/graph.json'),
    ) as {
      relationships: { full: { from: string; to: string }[]; derives: { from: string; to: string }[] };
    };
    assert.deepEqual(projection.relationships.derives, [
      { from: sourceId, to: ids.childComposite },
    ]);
    assert.equal(
      projection.relationships.full.some(
        (edge) => edge.from === sourceId || edge.to === sourceId,
      ),
      false,
    );
  });
});

test('US-018: completion targets are highlighted without a mainline field', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-targets'));
  const { ids } = fixture;

  const child = await openViewer(fixture.indexFile);
  t.after(() => child.close());
  openChildGraph(child, ids.composite);
  const childTarget = taskNode(child, ids.childComposite);
  assert.ok((childTarget.getAttribute('class') ?? '').includes('completion-target'));
  assert.equal(childTarget.querySelector('.target-marker')?.textContent, '\u25c6');
  assert.ok(childTarget.querySelector('.target-ring'), 'completion target needs a highlight ring');
  // Highlighting never replaces persisted state styling.
  assert.ok((childTarget.getAttribute('class') ?? '').includes('status-done'));

  const grandchild = await openViewer(fixture.indexFile);
  t.after(() => grandchild.close());
  openChildGraph(grandchild, ids.composite);
  openChildGraph(grandchild, ids.childComposite);
  const leaf = taskNode(grandchild, ids.leaf);
  assert.ok((leaf.getAttribute('class') ?? '').includes('completion-target'));

  // No mainline execution field is introduced anywhere in the projection.
  const graphJson = fixture.workspace.read('.task-graph/generated/graph.json');
  assert.equal(/mainline/i.test(graphJson), false);
  const projection = JSON.parse(graphJson) as { tasks: Record<string, unknown>[] };
  for (const task of projection.tasks) {
    assert.equal(Object.hasOwn(task, 'mainline'), false);
  }
});

test('US-018: the viewer documents every relationship style in a legend', async (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-legend'));
  const page = await openViewer(fixture.indexFile);
  t.after(() => page.close());

  const legend = page.document.getElementById('legend');
  assert.ok(legend, 'the viewer needs a legend container');
  const text = legend.textContent ?? '';
  for (const phrase of ['Full dependency', 'Partial dependency', 'Derives', 'Completion target']) {
    assert.ok(text.includes(phrase), `legend is missing "${phrase}"`);
  }
  for (const swatch of ['swatch-full', 'swatch-partial', 'swatch-derives', 'swatch-target']) {
    assert.ok(legend.querySelector(`.${swatch}`), `legend is missing the ${swatch} symbol`);
  }
  assert.ok(
    page.document.querySelectorAll('#legend li').length >= 9,
    'the legend must also cover the visual task states',
  );
});

test('US-018: the CLI rebuild keeps the relationship rendering', (t) => {
  const fixture = buildViewerFixture(useTempWorkspace(test, 'us-018-cli'));
  return openViewer(fixture.indexFile, { hash: `#graph=${fixture.entryGraphs[0]}` }).then((page) => {
    t.after(() => page.close());
    assert.ok(taskNodes(page).length > 0);
    assert.ok(page.errors.length === 0, page.errors.join('; '));
    // Filtering removes relationships of filtered-out tasks and clearing them
    // restores the relationship rendering.
    typeInto(page, page.document.getElementById('claim-filter')!, 'implementer');
    assert.ok(edges(page, 'partial').length === 0);
    typeInto(page, page.document.getElementById('claim-filter')!, '');
    assert.equal(edges(page, 'partial').length, 1);
  });
});
