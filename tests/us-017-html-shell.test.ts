import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { initializeProject } from '../src/core/init.js';
import { addGraph } from '../src/core/graphs.js';
import { addTask } from '../src/core/taskops.js';
import { linkTask } from '../src/core/deps.js';
import { buildProject } from '../src/core/build.js';
import { GRAPH_DATA_ELEMENT_ID, renderIndexHtml } from '../src/core/viewer.js';
import { createGraphProjection } from '../src/core/projection.js';
import { runCliProcess, useTempWorkspace, type TempWorkspace } from './helpers/temp.js';

const INDEX = '.task-graph/generated/index.html';

function fixedClock(): () => Date {
  return () => new Date('2026-09-21T10:00:00+08:00');
}

function seed(workspace: TempWorkspace): void {
  initializeProject(workspace.root, { name: '查看器', task: '根任务' });
  addGraph(workspace.root, { title: '第二张入口图', entry: true });
  const first = addTask(workspace.root, { graph: 'G-001', title: '实现登录', now: fixedClock() });
  const second = addTask(workspace.root, { graph: 'G-001', title: '接入前端', now: fixedClock() });
  linkTask(workspace.root, { successor: second.id, predecessor: first.id });
}

/** Inline application script: the plain `<script>` tag without attributes. */
function inlineAppScript(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'index.html must contain an inline application script');
  return match[1]!;
}

test('US-017: build writes a self-contained index.html', () => {
  const workspace = useTempWorkspace(test, 'us-017-self-contained');
  seed(workspace);
  const result = buildProject(workspace.root);

  assert.equal(result.htmlFile, INDEX);
  const html = workspace.read(INDEX);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<style>'), 'styles must be inlined');
  assert.ok(html.includes(`id="${GRAPH_DATA_ELEMENT_ID}"`), 'graph data must be embedded');
  assert.ok(html.includes('<script>'), 'the application script must be inlined');
  assert.equal(html.includes('<link '), false);
  assert.equal(html.includes('<img '), false);
  assert.equal(/<script[^>]+src=/.test(html), false);

  // No network resource: the SVG namespace is the only absolute URL allowed.
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
  for (const url of urls) {
    assert.equal(url, 'http://www.w3.org/2000/svg');
  }
});

test('US-017: the viewer provides containers for navigation, canvas, filters and details', () => {
  const workspace = useTempWorkspace(test, 'us-017-containers');
  seed(workspace);
  buildProject(workspace.root);
  const html = workspace.read(INDEX);

  for (const id of [
    'nav',
    'graph-list',
    'breadcrumbs',
    'canvas',
    'graph',
    'filters',
    'status-filters',
    'readiness-filters',
    'claim-filter',
    'details',
    'details-body',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing container #${id}`);
  }
});

test('US-017: the embedded data equals the built projection', () => {
  const workspace = useTempWorkspace(test, 'us-017-embedded-data');
  seed(workspace);
  buildProject(workspace.root);

  const html = workspace.read(INDEX);
  const match = new RegExp(
    `<script id="${GRAPH_DATA_ELEMENT_ID}" type="application/json">([\\s\\S]*?)</script>`,
  ).exec(html);
  assert.ok(match, 'embedded graph data must be present');
  const embedded = JSON.parse(match[1]!) as { tasks: { id: string }[] };
  const projection = JSON.parse(workspace.read('.task-graph/generated/graph.json')) as {
    tasks: { id: string }[];
  };
  assert.deepEqual(
    embedded.tasks.map((task) => task.id),
    projection.tasks.map((task) => task.id),
  );
  assert.deepEqual(
    embedded,
    JSON.parse(renderIndexHtml(createGraphProjection(workspace.root)).match(
      new RegExp(`<script id="${GRAPH_DATA_ELEMENT_ID}" type="application/json">([\\s\\S]*?)</script>`),
    )![1]!),
  );
});

test('US-017: the application script is valid JavaScript', () => {
  const workspace = useTempWorkspace(test, 'us-017-script');
  seed(workspace);
  buildProject(workspace.root);
  const script = inlineAppScript(workspace.read(INDEX));

  // Compiling the inline script proves the page cannot fail with a parse error
  // before any rendering happens.
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes('selectGraph'));
  assert.ok(script.includes('readHash'));
});

test('US-017: identical source input produces identical HTML', () => {
  const first = useTempWorkspace(test, 'us-017-determinism-a');
  const second = useTempWorkspace(test, 'us-017-determinism-b');
  seed(first);
  seed(second);
  assert.equal(first.read(INDEX), second.read(INDEX));

  const htmlBefore = first.read(INDEX);
  rmSync(path.join(first.root, '.task-graph', 'generated'), { recursive: true, force: true });
  assert.equal(first.exists(INDEX), false);
  buildProject(first.root);
  assert.equal(first.read(INDEX), htmlBefore);
});

test('US-017: the build command reports the generated viewer', () => {
  const workspace = useTempWorkspace(test, 'us-017-cli');
  runCliProcess(['init', '--name', 'p', '--task', '根任务'], { cwd: workspace.root });
  const build = runCliProcess(['build', '--json'], { cwd: workspace.root });
  assert.equal(build.code, 0, build.stderr);
  const payload = JSON.parse(build.stdout) as { file: string; htmlFile: string };
  assert.equal(payload.htmlFile, INDEX);
  assert.ok(workspace.read(INDEX).includes('<!doctype html>'));
});
