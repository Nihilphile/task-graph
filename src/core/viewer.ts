import { VIEWER_JS } from './viewer-client.js';
import type { GraphProjection } from './projection.js';

/** Marker used by tests to distinguish the embedded projection from any other JSON. */
export const GRAPH_DATA_ELEMENT_ID = 'graph-data';

/** Project-relative path of the generated viewer. */
export function indexHtmlRelativePath(): string {
  return '.task-graph/generated/index.html';
}

/**
 * Renders the self-contained, read-only viewer.
 *
 * The projection data, styles and application script are all inlined, so the
 * file works from `file://` with no server and no network access. Output is a
 * pure function of the projection, which keeps builds deterministic.
 */
export function renderIndexHtml(projection: GraphProjection): string {
  const data = JSON.stringify(projection).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Task Graph</title>',
    `<style>${VIEWER_CSS}</style>`,
    '</head>',
    '<body>',
    '<header id="topbar">',
    '<strong id="project-name"></strong>',
    '<nav id="breadcrumbs" aria-label="graph breadcrumbs"></nav>',
    '<div id="viewport-controls">',
    '<button type="button" data-view="zoom-out" title="Zoom out">&minus;</button>',
    '<button type="button" data-view="zoom-in" title="Zoom in">+</button>',
    '<button type="button" data-view="fit" title="Fit to view">Fit</button>',
    '</div>',
    '</header>',
    '<div id="layout">',
    '<aside id="nav" aria-label="graphs">',
    '<h2>Graphs</h2>',
    '<ul id="graph-list"></ul>',
    '<section id="filters" aria-label="filters">',
    '<h2>Filters</h2>',
    '<div id="status-filters" class="filter-group"></div>',
    '<div id="readiness-filters" class="filter-group"></div>',
    '<label class="filter-field">Claim role or session',
    '<input type="search" id="claim-filter" placeholder="role or session" autocomplete="off">',
    '</label>',
    '<button type="button" id="clear-filters">Clear filters</button>',
    '<p id="filter-summary" class="muted"></p>',
    '<h2>Legend</h2>',
    '<ul id="legend" class="legend">',
    '<li><span class="legend-swatch swatch-full"></span>Full dependency (solid)</li>',
    '<li><span class="legend-swatch swatch-partial"></span>Partial dependency (dashed, named completion point)</li>',
    '<li><span class="legend-swatch swatch-derives"></span>Derives from a source (gray dotted, informational)</li>',
    '<li><span class="legend-swatch swatch-target"></span>Completion target of a composite task</li>',
    '<li><span class="legend-swatch swatch-done"></span>&#10003; finished</li>',
    '<li><span class="legend-swatch swatch-running"></span>&#9679; running</li>',
    '<li><span class="legend-swatch swatch-ready"></span>&#9654; ready</li>',
    '<li><span class="legend-swatch swatch-blocked"></span>! blocked</li>',
    '<li><span class="legend-swatch swatch-unready"></span>◷ unready · 前置条件未满足</li>',
    '<li><span class="legend-swatch swatch-cancelled"></span>&#215; cancelled</li>',
    '</ul>',
    '</section>',
    '</aside>',
    '<main id="canvas">',
    '<svg id="graph" role="img" aria-label="task graph"></svg>',
    '<p id="canvas-message" hidden></p>',
    '</main>',
    '<aside id="details" aria-label="task details">',
    '<h2>Task details</h2>',
    '<div id="details-body"><p class="muted">Select a task node.</p></div>',
    '</aside>',
    '</div>',
    `<script id="${GRAPH_DATA_ELEMENT_ID}" type="application/json">${data}</script>`,
    `<script>${VIEWER_JS}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const VIEWER_CSS = `
.node.error-book .node-body { fill:#fff8ed; stroke:#d99b39; }
.error-book-entry { border-top:1px solid var(--line); padding:12px 0; overflow-wrap:anywhere; }
.error-book-entry h4 { margin:0 0 8px; }
:root { --bg:#f7f8fa; --panel:#fff; --line:#d0d5dd; --text:#101828; --muted:#667085; --accent:#2f6feb; }
* { box-sizing:border-box; }
body { margin:0; font:14px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color:var(--text); background:var(--bg); }
#topbar { display:flex; align-items:center; gap:16px; padding:8px 16px; background:var(--panel); border-bottom:1px solid var(--line); }
#breadcrumbs { display:flex; gap:6px; flex:1; flex-wrap:wrap; font-size:13px; }
#breadcrumbs button { border:0; background:none; color:var(--accent); cursor:pointer; padding:2px 4px; }
#viewport-controls button { min-width:32px; height:28px; margin-left:4px; border:1px solid var(--line); background:var(--panel); border-radius:6px; cursor:pointer; }
#layout { display:grid; grid-template-columns:200px minmax(260px,1fr) minmax(340px,400px); height:calc(100vh - 53px); }
#nav,#filters,#details { overflow:auto; padding:12px; background:var(--panel); border-right:1px solid var(--line); }
#details { border-right:0; border-left:1px solid var(--line); }
#nav h2,#filters h2,#details h2 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
#filters h2 + .legend { margin-top:0; }
#graph-list { list-style:none; margin:0; padding:0; }
#graph-list button { width:100%; text-align:left; border:1px solid transparent; background:none; padding:6px 8px; border-radius:6px; cursor:pointer; color:var(--text); }
#graph-list button[aria-current="true"] { background:#eaf1ff; border-color:#c7d7fe; }
#canvas { position:relative; overflow:hidden; background:
  linear-gradient(0deg,transparent 0 23px,#eceff3 23px 24px) 0 0/24px 24px,
  linear-gradient(90deg,transparent 0 23px,#eceff3 23px 24px) 0 0/24px 24px; }
#graph { width:100%; height:100%; display:block; cursor:grab; }
#graph.dragging { cursor:grabbing; }

/* Node body: readiness colours first, persisted status wins over computed state. */
.node .node-body { fill:#fff; stroke:var(--line); stroke-width:1.5; rx:8; }
.node text { font-size:12px; fill:var(--text); pointer-events:none; }
.node .badge { font-size:12px; font-weight:700; }
.node.readiness-ready.status-todo .node-body { fill:#eff4ff; stroke:#2f6feb; }
.node.readiness-ready.status-todo .badge { fill:#2f6feb; }
.node.readiness-unready.status-todo .node-body { fill:#f2f4f7; stroke:#98a2b3; }
.node.readiness-unready.status-todo .badge { fill:#667085; }
.node.status-done .node-body { fill:#e7f8ef; stroke:#12b76a; }
.node.status-done .badge { fill:#12b76a; }
.node.status-in_progress .node-body { fill:#fffaeb; stroke:#f79009; }
.node.status-in_progress .badge { fill:#f79009; }
.node.status-blocked .node-body { fill:#fff1f0; stroke:#d92d20; stroke-width:2; }
.node.status-blocked .badge, .node.status-blocked .state-label { fill:#b42318; }
.node.status-reviewing .node-body { fill:#eef4ff; stroke:#6172f3; stroke-width:2; }
.node.status-reviewing .badge, .node.status-reviewing .state-label { fill:#3538cd; }
.node.status-cancelled .node-body { fill:#f2f4f7; stroke:#98a2b3; }
.node.status-cancelled .badge { fill:#98a2b3; }
.node.status-cancelled text.title { text-decoration:line-through; fill:var(--muted); }
.node .meta { font-size:10px; fill:var(--muted); }
.node .claim-chip { fill:#f2f4f7; stroke:#d0d5dd; stroke-width:1; rx:7; }
.node .claim { font-size:10px; fill:#475467; }
.node .target-marker { font-size:12px; fill:#7a5af8; font-weight:700; }
.node .target-ring { fill:none; stroke:#7a5af8; stroke-width:1.5; stroke-dasharray:6 4; rx:10; }
.node.completion-target .title { font-weight:600; }
.node.source .node-body { fill:#f9fafb; stroke:#98a2b3; stroke-dasharray:4 3; }
.node.source text { fill:var(--muted); }

.edge { fill:none; }
.edge-full { stroke:#475467; stroke-width:1.6; }
.edge-partial { stroke:#7a5af8; stroke-width:1.6; stroke-dasharray:7 4; }
.edge-derives { stroke:#98a2b3; stroke-width:1.4; stroke-dasharray:2 4; }
.edge-label { font-size:10px; fill:#7a5af8; }
#canvas-message { position:absolute; inset:auto 16px 16px; padding:10px 12px; margin:0; background:#fff4f3; border:1px solid #fecdca; border-radius:8px; }
#canvas-message[hidden] { display:none; }
#canvas-message button { margin-left:8px; padding:4px 8px; border:1px solid var(--accent); color:var(--accent); background:#fff; border-radius:6px; cursor:pointer; }
.filter-group { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.filter-group label { display:inline-flex; align-items:center; gap:4px; font-size:12px; border:1px solid var(--line); border-radius:999px; padding:2px 8px; cursor:pointer; }
.filter-field { display:block; font-size:12px; color:var(--muted); margin-bottom:10px; }
.filter-field input { width:100%; margin-top:4px; padding:5px 8px; border:1px solid var(--line); border-radius:6px; }
#clear-filters { width:100%; padding:6px; border:1px solid var(--line); background:var(--panel); border-radius:6px; cursor:pointer; }
.muted { color:var(--muted); }
.legend { list-style:none; margin:0; padding:0; font-size:11px; color:var(--muted); }
.legend li { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
.legend-swatch { flex:0 0 auto; width:22px; height:10px; border-radius:3px; }
.swatch-full { height:0; border-top:2px solid #475467; border-radius:0; }
.swatch-partial { height:0; border-top:2px dashed #7a5af8; border-radius:0; }
.swatch-derives { height:0; border-top:2px dotted #98a2b3; border-radius:0; }
.swatch-target { border:2px dashed #7a5af8; background:transparent; }
.swatch-done { border:2px solid #12b76a; background:#e7f8ef; }
.swatch-running { border:2px solid #f79009; background:#fffaeb; }
.swatch-ready { border:2px solid #2f6feb; background:#eff4ff; }
.swatch-blocked { border:2px solid #f04438; background:#fef3f2; }
.swatch-unready { border:2px solid #98a2b3; background:#f2f4f7; }
.swatch-cancelled { border:2px solid #98a2b3; background:#f2f4f7; }
.composite-button { margin:8px 0; padding:6px 10px; border:1px solid var(--accent); color:var(--accent); background:var(--panel); border-radius:6px; cursor:pointer; }
dl { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin:0 0 12px; font-size:12px; }
dt { color:var(--muted); }
dd { margin:0; word-break:break-word; }
#details-body h1 { font-size:16px; } #details-body h2 { font-size:14px; } #details-body h3 { font-size:13px; }
#topbar { height:53px; }
#nav { padding:16px 12px; }
#filters { padding:20px 0 0; border:0; overflow:visible; }
#details { padding:20px; }
.node { cursor:pointer; }
.node .node-body { filter:drop-shadow(0 2px 3px rgb(16 24 40 / 5%)); }
.node.selected .node-body { stroke-width:2.5; filter:drop-shadow(0 6px 10px rgb(16 24 40 / 15%)); }
.node .title { font-size:14px; font-weight:500; }
.node .identity { font-size:11px; fill:var(--muted); font-weight:600; }
.node .badge { font-size:11px; }
.node .state-label { font-size:11px; fill:var(--muted); }
.node .meta { font-size:11px; }
.doc-tab rect { fill:rgba(255,255,255,.85); stroke:rgba(16,24,40,.14); }
.doc-tab text { font-size:11px; fill:#344054; }
.doc-tab:hover rect,.doc-tab.active rect { fill:#eaf1ff; stroke:#2f6feb; }
.child-link rect { fill:rgba(255,255,255,.8); stroke:var(--line); }
.child-link text { font-size:17px; fill:var(--accent); }
.node:focus-visible .node-body,.doc-tab:focus-visible rect,.child-link:focus-visible rect { stroke:#175cd3; stroke-width:3; }
  .panel-tabs { display:flex; flex-wrap:wrap; gap:6px; padding:4px 0 18px; }
  .github-sync { padding:10px 12px; margin:0 0 12px; border:1px solid var(--line); border-radius:8px; font-size:12px; overflow-wrap:anywhere; }
  .github-sync p { margin:6px 0 0; }
.panel-tabs button,.back-to-list,.task-jump { border:1px solid var(--line); border-radius:7px; background:#fff; padding:5px 9px; font:inherit; font-size:12px; color:var(--muted); cursor:pointer; }
.panel-tabs button[aria-current=true] { color:#175cd3; border-color:#b2ccff; background:#eff4ff; }
.task-jump { padding:1px 5px; color:var(--accent); }
.document-list { display:grid; gap:10px; }
.document-item { text-align:left; width:100%; border:1px solid #e4e7ec; background:white; border-radius:10px; padding:14px; cursor:pointer; color:var(--text); }
.document-item:hover { background:#f8faff; border-color:#b2ccff; }
.document-item strong { display:block; font-size:14px; margin-bottom:6px; }
.document-item small,.document-heading small,.audit small { display:block; font-size:11px; color:var(--muted); overflow-wrap:anywhere; margin-top:4px; }
.document-heading { padding:18px 0; border-bottom:1px solid #eaecf0; margin-bottom:18px; }
.snapshot-label { display:inline-block; margin-top:10px; font-size:11px; color:#067647; background:#ecfdf3; padding:2px 6px; border-radius:4px; }
.document-content { overflow-wrap:anywhere; line-height:1.75; }
.document-content pre,.audit pre { overflow:auto; padding:12px; font-size:12px; background:#f8fafc; border-radius:6px; }
.document-content img { max-width:100%; }
.document-content table { border-collapse:collapse; display:block; overflow:auto; }
.document-content td,.document-content th { border:1px solid #e4e7ec; padding:6px; }
.document-error { color:#b42318; background:#fef3f2; padding:8px; border-radius:6px; font-size:12px; }
.audit { border-top:1px solid #eaecf0; padding-top:16px; margin-top:24px; font-size:12px; }
.audit summary { cursor:pointer; color:var(--muted); }
.audit ol { padding-left:18px; }
.audit li { margin:14px 0; }
@media(max-width:1000px) { #layout { grid-template-columns:160px minmax(200px,1fr) 320px; } #details { padding:12px; } }
@media(max-width:740px) { #layout { grid-template-columns:minmax(220px,1fr) 280px; } #nav { display:none; } #breadcrumbs { gap:2px; } }
`;
