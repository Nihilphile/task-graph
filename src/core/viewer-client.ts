export const VIEWER_JS = String.raw`
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("graph-data").textContent);
  var STATUS_ORDER = ["todo", "in_progress", "blocked", "pending_review", "reviewing", "done", "reject", "cancelled"];
  var STATUS_LABEL = { blocked: "受阻", todo: "Todo", in_progress: "Running", pending_review: "待审查", reviewing: "审查中", done: "Finished", reject: "Rejected", cancelled: "Cancelled" };
  var STATUS_ICON = { done: "\u2713", in_progress: "\u25cf", cancelled: "\u00d7" };
  var READINESS_ICON = { ready: "\u25b6", unready: "◷" };
  var TARGET_MARKER = "\u25c6";
  var NODE_W = 220, NODE_H = 76, GAP_X = 110, GAP_Y = 60, PAD = 36;
  var SOURCE_LANE = NODE_W + GAP_X;
  var CONTRACT_HEADER = 76, CONTRACT_ROW = 38, collapsedContracts = {};

  var state = { graph: null, task: null, panel: 'overview', document: null, k: 1, x: PAD, y: PAD,
    filters: { status: [], readiness: [], claim: "" } };
  var graphBounds = { x: 0, y: 0, width: 1, height: 1 };
  var lastNodeClick = { id: null, at: 0 }, collapseTimer = null, suppressClickUntil = 0;
  var layoutDirection = 'RIGHT', showContracts = true;
  var layoutCache = new Map(), pendingLayouts = new Map(), layoutFailures = new Set();
  var activeLayoutKey = null, fitAfterLayout = false, layoutSelection = null, expansionScale = 1.1;
  var selectionAnchor = null;
  var readingHash = false;
  var ownHashChanges = new Map();

  var tasksById = {}; DATA.tasks.forEach(function (t) { tasksById[t.id] = t; });
  var graphsById = {}; DATA.graphs.forEach(function (g) { graphsById[g.id] = g; });
  var sourcesById = {}; DATA.sources.forEach(function (s) { sourcesById[s.id] = s; });

  // Tasks named by a composite task completion_requires are highlighted for
  // orientation only: no mainline execution field is introduced anywhere.
  var completionTargets = {};
  DATA.tasks.forEach(function (task) {
    if (!task.subgraph) return;
    task.subgraph.completionRequires.forEach(function (id) { completionTargets[id] = true; });
  });

  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var svgEl = function (name, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  };
  var tasksInGraph = function (graphId) {
    return DATA.tasks.filter(function (t) { return t.graph === graphId; })
      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  };
  var visualState = function (task) {
    if (task.status === 'blocked') return 'blocked';
    if (task.status === 'pending_review' || task.status === 'reviewing') return 'running';
    if (task.status === 'reject') return 'blocked';
    if (task.status === "cancelled") return "cancelled";
    if (task.status === "done") return "done";
    if (task.status === "in_progress") return "running";
    return task.readiness === "ready" ? "ready" : "unready";
  };
  var nodeIcon = function (task) {
    if (task.status === 'blocked') return '!';
    if (task.status === 'reviewing') return '◉';
    if (task.status === 'pending_review') return '⌛';
    if (task.status === 'reject') return '\u2717';
    if (task.status === "cancelled") return STATUS_ICON.cancelled;
    if (task.status === "done") return STATUS_ICON.done;
    if (task.status === "in_progress") return STATUS_ICON.in_progress;
    return READINESS_ICON[task.readiness] || "";
  };

  var textWidths = {};
  function textWidth(text, size) {
    var key = size + ':' + text;
    if (textWidths[key] != null) return textWidths[key];
    var measure = svgEl('text', { x: -10000, y: -10000, 'font-size': size, visibility: 'hidden' });
    measure.textContent = text;
    var width;
    if (typeof measure.getComputedTextLength === 'function') {
      document.getElementById('graph').appendChild(measure);
      width = measure.getComputedTextLength();
      measure.remove();
    }
    if (!width) width = Array.from(text).reduce(function (sum, letter) { return sum + (letter.charCodeAt(0) > 255 ? size : size * 0.59); }, 0);
    textWidths[key] = width;
    return width;
  }
  function wrapText(text, width, size, limit) {
    var lines = [], line = '';
    Array.from(text).forEach(function (letter) {
      if (line && textWidth(line + letter, size) > width) { lines.push(line); line = ''; }
      line += letter;
    });
    if (line) lines.push(line);
    if (lines.length > limit) {
      lines = lines.slice(0, limit);
      var tail = lines[limit - 1];
      while (tail && textWidth(tail + '…', size) > width) tail = Array.from(tail).slice(0, -1).join('');
      lines[limit - 1] = tail + '…';
    }
    return lines.length ? lines : [''];
  }
  function documentsFor(task) {
    return task.documents || { content: { id: 'content:inline', title: task.title, path: '', html: task.html }, reports: [], logs: [], handoffs: [], outputs: [] };
  }
  var PANEL_LABELS = { overview: '概览', content: '任务要求', contracts: '当前契约', codeReferences: '代码入口', reviewRequirements: '验收要求', references: '旧文件参考', reports: '报告', logs: '工作记录', handoffs: '交接', outputs: '产物' };
  function tabsFor(task) {
    var docs = documentsFor(task);
    var tabs = [{ key: 'content', label: '任务要求' }];
    if (task.codeReferences && task.codeReferences.length) tabs.push({ key: 'codeReferences', label: '代码入口 · ' + task.codeReferences.length });
    ['contracts', 'reviewRequirements', 'references', 'reports', 'logs', 'handoffs', 'outputs'].forEach(function (key) {
      if (docs[key] && docs[key].length) tabs.push({ key: key, label: PANEL_LABELS[key] + ' · ' + docs[key].length });
    });
    return tabs;
  }
  function nodeMetrics(task, expanded) {
    var baseWidth = Math.max(NODE_W, Math.min(300, textWidth(task.title, 14) + 32));
    // Freeze the expanded card's geometry until selection changes. Zoom is a
    // viewport transform, not a new layout request or a fit/resize feedback loop.
    var scale = expanded ? expansionScale : 1;
    var width = expanded ? Math.round(baseWidth * 1.25 * scale / 1.1) : baseWidth;
    var lines = wrapText(task.title, width - 32 * scale, 14 * scale, expanded ? 8 : 3);
    var metaY = (45 + (lines.length - 1) * 20 + 24) * scale;
    var tagsY = metaY + (task.claim ? 34 : 14) * scale;
    var x = 12 * scale, y = tagsY;
    var tags = tabsFor(task).map(function (tab) {
      var w = Math.ceil(textWidth(tab.label, 11 * scale)) + 18 * scale;
      if (x + w > width - 12 * scale) { x = 12 * scale; y += 32 * scale; }
      var result = { key: tab.key, label: tab.label, x: x, y: y, width: w };
      x += w + 6 * scale;
      return result;
    });
    return { width: width, height: y + 38 * scale, scale: scale, lines: lines, metaY: metaY, tagsY: tagsY, tags: tags };
  }

  // Immediate provisional layout, also retained if the embedded engine fails.
  function layout(tasks) {
    var ids = {}; tasks.forEach(function (t) { ids[t.id] = true; });
    var depth = {}, visiting = {};
    function depthOf(id) {
      if (depth[id] != null) return depth[id];
      if (visiting[id]) return 0;
      visiting[id] = true;
      var task = tasksById[id];
      var value = 0;
      (task ? task.dependsOn : []).forEach(function (dep) {
        if (!ids[dep.task]) return;
        value = Math.max(value, depthOf(dep.task) + 1);
      });
      visiting[id] = false;
      depth[id] = value;
      return value;
    }
    tasks.forEach(function (t) { depthOf(t.id); });
    var columns = {};
    tasks.forEach(function (t) {
      var column = depth[t.id] || 0;
      columns[column] = (columns[column] || 0) + 1;
      t.__column = column;
      t.__row = columns[column] - 1;
    });
    return tasks;
  }

  function routeId(mode, from, to, section) {
    return JSON.stringify([mode, from, to, section || '']);
  }
  function automaticLayout(positions, sourcePositions, contractPositions, visible, sources, contracts) {
    var input = { graph: state.graph, direction: layoutDirection, nodes: [], edges: [] };
    [[positions, 'task'], [sourcePositions, 'source'], [contractPositions, 'contract']].forEach(function (pair) {
      Object.keys(pair[0]).forEach(function (id) {
        var box = pair[0][id];
        input.nodes.push({ id: id, kind: pair[1], width: box.width, height: box.height });
      });
    });
    visible.forEach(function (task) {
      task.dependsOn.forEach(function (dep) {
        if (!positions[dep.task]) return;
        var edge = { id: routeId('dependency', dep.task, task.id), from: dep.task, to: task.id };
        if (dep.mode === 'partial' && dep.gate) { edge.label = dep.gate; edge.labelWidth = textWidth(dep.gate, 10) + 8; }
        input.edges.push(edge);
      });
      task.derivedFrom.forEach(function (id) {
        if (sourcePositions[id]) input.edges.push({ id: routeId('derives', id, task.id), from: id, to: task.id });
      });
    });
    (DATA.relationships.contracts || []).forEach(function (edge) {
      if (!contractPositions[edge.from] || !positions[edge.to]) return;
      var contract = contracts.find(function (c) { return c.id === edge.from; });
      var index = (contract.sections || []).findIndex(function (s) { return s.id === edge.section; });
      input.edges.push({ id: routeId('contract', edge.from, edge.to, edge.section), from: edge.from, to: edge.to,
        portX: NODE_W, portY: index >= 0 && !collapsedContracts[edge.from]
          ? CONTRACT_HEADER + index * CONTRACT_ROW + CONTRACT_ROW / 2 : CONTRACT_HEADER / 2 });
    });
    var key = JSON.stringify(input); activeLayoutKey = key;
    var cached = layoutCache.get(key), status = document.getElementById('layout-status');
    var svg = document.getElementById('graph');
    if (cached) {
      // Refresh LRU order; navigating to another graph cannot replace this view.
      layoutCache.delete(key); layoutCache.set(key, cached);
      [positions, sourcePositions, contractPositions].forEach(function (boxes) {
        Object.keys(boxes).forEach(function (id) { boxes[id].x = cached.nodes[id].x; boxes[id].y = cached.nodes[id].y; });
      });
      svg.setAttribute('data-layout-state', 'ready'); status.textContent = ''; status.title = '';
      return cached;
    }
    if (layoutFailures.has(key)) {
      svg.setAttribute('data-layout-state', 'fallback'); status.textContent = '基础排版';
      status.title = '自动排版未完成，已保留可浏览的基础布局。切换排版方向可重试。';
      return null;
    }
    svg.setAttribute('data-layout-state', 'pending'); status.textContent = '排版中…'; status.title = '';
    if (!pendingLayouts.has(key)) {
      var pending = Promise.resolve().then(function () { return window.TaskGraphLayout.layout(input); });
      pendingLayouts.set(key, pending);
      pending.then(function (result) {
        layoutCache.set(key, result);
        if (layoutCache.size > 20) layoutCache.delete(layoutCache.keys().next().value);
      }, function () {
        layoutFailures.add(key);
        if (layoutFailures.size > 20) layoutFailures.delete(layoutFailures.values().next().value);
      }).then(function () {
        pendingLayouts.delete(key);
        if (activeLayoutKey === key && window.document && window.document.getElementById('graph')) renderGraph();
      });
    }
    return null;
  }
  function routedPath(automatic, id, from, to) {
    var edge = automatic && automatic.edges[id];
    return edge ? edge.sections.map(function (points) {
      return points.map(function (point, index) { return (index ? 'L ' : 'M ') + point.x + ' ' + point.y; }).join(' ');
    }).join(' ') : edgePath(from, to);
  }

  function activeFilters() {
    var active = [];
    state.filters.status.forEach(function (value) { active.push("status: " + value); });
    state.filters.readiness.forEach(function (value) { active.push("readiness: " + value); });
    if (state.filters.claim) active.push("claim: " + state.filters.claim);
    return active;
  }
  function matchesFilters(task) {
    if (state.filters.status.length && state.filters.status.indexOf(task.status) < 0) return false;
    if (state.filters.readiness.length && state.filters.readiness.indexOf(task.readiness) < 0) return false;
    if (state.filters.claim) {
      var need = state.filters.claim.toLowerCase();
      var claim = task.claim || {};
      var hay = ((claim.role || "") + " " + (claim.sessionId || "")).toLowerCase();
      if (hay.indexOf(need) < 0) return false;
    }
    return true;
  }

  function renderNav() {
    var list = document.getElementById("graph-list");
    list.innerHTML = "";
    DATA.graphs.filter(function (g) { return g.entry; }).forEach(function (graph) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = graph.id + " \u00b7 " + graph.title;
      button.setAttribute("aria-current", String(state.graph === graph.id));
      button.addEventListener("click", function () { selectGraph(graph.id, null); });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function renderBreadcrumbs() {
    var nav = document.getElementById("breadcrumbs");
    nav.innerHTML = "";
    var chain = [];
    var current = state.graph ? graphsById[state.graph] : null;
    var guard = 0;
    while (current && guard++ < 32) {
      chain.unshift(current);
      var parentTask = current.parentTask ? tasksById[current.parentTask] : null;
      current = parentTask ? graphsById[parentTask.graph] : null;
    }
    if (chain.length === 0) return;
    chain.forEach(function (graph, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = graph.title + " (" + graph.id + ")";
      button.addEventListener("click", function () { selectGraph(graph.id, null); });
      nav.appendChild(button);
      if (index < chain.length - 1) {
        var separator = document.createElement("span");
        separator.textContent = "/";
        separator.className = "muted";
        nav.appendChild(separator);
      }
    });
  }

  function renderFilters() {
    var statusBox = document.getElementById("status-filters");
    statusBox.innerHTML = "";
    STATUS_ORDER.forEach(function (status) {
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-status-filter", status);
      input.checked = state.filters.status.indexOf(status) >= 0;
      input.addEventListener("change", function () {
        state.filters.status = toggle(state.filters.status, status, input.checked);
        renderGraph();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(STATUS_LABEL[status]));
      statusBox.appendChild(label);
    });
    var readinessBox = document.getElementById("readiness-filters");
    readinessBox.innerHTML = "";
    ["ready", "unready"].forEach(function (value) {
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-readiness-filter", value);
      input.checked = state.filters.readiness.indexOf(value) >= 0;
      input.addEventListener("change", function () {
        state.filters.readiness = toggle(state.filters.readiness, value, input.checked);
        renderGraph();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(value));
      readinessBox.appendChild(label);
    });
  }
  function toggle(list, value, on) {
    var next = list.filter(function (entry) { return entry !== value; });
    if (on) next.push(value);
    return next;
  }

  function setMessage(text, withFallback) {
    var message = document.getElementById("canvas-message");
    message.textContent = text;
    if (withFallback) {
      var fallback = DATA.graphs.filter(function (g) { return g.entry; })[0] || DATA.graphs[0];
      if (fallback) {
        var button = document.createElement("button");
        button.type = "button";
        button.id = "hash-fallback";
        button.textContent = "Open " + fallback.title;
        button.addEventListener("click", function () { selectGraph(fallback.id, null); });
        message.appendChild(button);
      }
    }
    message.hidden = !text;
  }

  function renderGraph() {
    var svg = document.getElementById("graph");
    activeLayoutKey = null;
    if (layoutSelection !== state.task) {
      layoutSelection = state.task; expansionScale = Math.max(1.1, 1 / state.k);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!graphsById[state.graph]) {
      setMessage('Unknown graph "' + state.graph + '" in the URL hash. Choose an entry graph to continue.', true);
      document.getElementById("filter-summary").textContent = "";
      svg.setAttribute('data-layout-state', 'empty');
      document.getElementById('layout-status').textContent = '';
      return;
    }
    var all = tasksInGraph(state.graph);
    var visible = all.filter(matchesFilters);
    var ids = {}; visible.forEach(function (t) { ids[t.id] = true; });
    layout(visible);
    var sources = visibleSources(visible);
    var contracts = showContracts ? (DATA.contracts || []).filter(function (c) { return c.graph === state.graph || visible.some(function (t) { return (t.contracts || []).some(function (binding) { return binding.split('#')[0] === c.id; }); }); }) : [];
    var offset = sources.length || contracts.length ? SOURCE_LANE : 0;

    var viewport = svgEl("g", { id: "viewport", transform: transform() });
    var defs = svgEl('defs');
    [['full', '#475467'], ['partial', '#7a5af8'], ['unmet', '#d92d20']].forEach(function (entry) {
      var marker = svgEl('marker', { id: 'arrow-' + entry[0], viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.appendChild(svgEl('path', { d: 'M 1 1 L 9 5 L 1 9 z', fill: entry[1] })); defs.appendChild(marker);
    });
    svg.appendChild(defs);
    svg.appendChild(viewport);
    var positions = {}, columnWidths = {}, columnLeft = {}, rowBottom = {};
    visible.forEach(function (task) {
      var base = nodeMetrics(task, false);
      columnWidths[task.__column] = Math.max(columnWidths[task.__column] || 0, base.width);
    });
    var left = PAD + offset;
    Object.keys(columnWidths).map(Number).sort(function (a, b) { return a - b; }).forEach(function (column) {
      columnLeft[column] = left;
      left += columnWidths[column] + GAP_X;
    });
    visible.forEach(function (task) {
      var base = nodeMetrics(task, false), expanded = task.id === state.task;
      var metrics = expanded ? nodeMetrics(task, true) : base;
      var top = rowBottom[task.__column] || PAD;
      positions[task.id] = { x: columnLeft[task.__column] - (metrics.width - base.width) / 2,
        y: top - (metrics.height - base.height) / 2, width: metrics.width, height: metrics.height, metrics: metrics };
      rowBottom[task.__column] = top + base.height + GAP_Y;
    });
    var sourcePositions = {};
    sources.forEach(function (source, index) {
      sourcePositions[source.id] = { x: PAD, y: PAD + index * (NODE_H + GAP_Y), width: NODE_W, height: NODE_H };
    });
    var contractPositions = {}, contractTop = PAD + sources.length * (NODE_H + GAP_Y);
    contracts.forEach(function (c) {
      var height = CONTRACT_HEADER + (collapsedContracts[c.id] ? 0 : (c.sections || []).length * CONTRACT_ROW) + 12;
      // Include the stacked sheets in obstacle geometry, not just the front card.
      contractPositions[c.id] = { x: PAD, y: contractTop, width: NODE_W + 12, height: height };
      contractTop += height + GAP_Y;
    });
    var automatic = automaticLayout(positions, sourcePositions, contractPositions, visible, sources, contracts);
    if (automatic && automatic.group) {
      var group = automatic.group;
      viewport.appendChild(svgEl('rect', { class: 'layout-group', x: group.x, y: group.y, width: group.width, height: group.height, rx: 10 }));
      var groupLabel = svgEl('text', { class: 'layout-group-label', x: group.x + 16, y: group.y + 25 });
      groupLabel.textContent = group.label; viewport.appendChild(groupLabel);
    }
    (DATA.relationships.contracts || []).forEach(function (edge) {
      var box = contractPositions[edge.from], target = positions[edge.to];
      if (!box || !target) return;
      var contract = contracts.find(function (c) { return c.id === edge.from; });
      var index = (contract.sections || []).findIndex(function (s) { return s.id === edge.section; });
      var y = box.y + (index >= 0 && !collapsedContracts[edge.from] ? CONTRACT_HEADER + index * CONTRACT_ROW + CONTRACT_ROW / 2 : CONTRACT_HEADER / 2);
      var line = svgEl('path', { class: 'edge edge-contract', 'data-mode': 'contract', 'data-from': edge.from, 'data-section': edge.section || '', 'data-to': edge.to, d: routedPath(automatic, routeId('contract', edge.from, edge.to, edge.section), { x: box.x, y: y, width: NODE_W, height: 0 }, target) });
      var label = svgEl('title'); label.textContent = edge.from + (edge.section ? '#' + edge.section : ' · 全文') + ' → ' + edge.to; line.appendChild(label); viewport.appendChild(line);
    });
    contracts.forEach(function (c) { viewport.appendChild(renderContractNode(c, contractPositions[c.id])); });

    // Full dependencies: solid. Partial dependencies: dashed, labelled with the
    // named completion point of the composite task they depend on.
    visible.forEach(function (task) {
      task.dependsOn.forEach(function (dep) {
        if (dep.mode === "partial" && !ids[dep.task]) return;
        if (dep.mode !== "partial" && !ids[dep.task]) return;
        var from = positions[dep.task], to = positions[task.id];
        if (!from || !to) return;
        // Use the projected readiness reasons for this specific dependency:
        // a partial gate can be satisfied while its parent task is still running.
        var unmet = task.blockedBy.some(function (reason) {
          return reason.task === dep.task && ((dep.mode !== 'partial' && reason.kind === 'task') ||
            (dep.mode === 'partial' && reason.kind === 'gate' && reason.gate === dep.gate));
        });
        var description = dep.task + (dep.mode === 'partial' ? ':' + dep.gate : '') + ' → ' + task.id +
          (unmet ? ' · 前置依赖未满足' : ' · 前置依赖已满足');
        var path = svgEl("path", {
          class: "edge edge-" + (dep.mode === "partial" ? "partial" : "full") + (unmet ? ' edge-unmet' : ''),
          "data-mode": dep.mode === "partial" ? "partial" : "full",
          "data-from": dep.task,
          "data-to": task.id,
          'data-satisfied': String(!unmet),
          'aria-label': description,
          'marker-end': 'url(#arrow-' + (unmet ? 'unmet' : dep.mode === 'partial' ? 'partial' : 'full') + ')',
          d: routedPath(automatic, routeId('dependency', dep.task, task.id), from, to)
        });
        var edgeTitle = svgEl('title'); edgeTitle.textContent = description; path.appendChild(edgeTitle);
        viewport.appendChild(path);
        if (dep.mode === "partial") {
          var route = automatic && automatic.edges[routeId('dependency', dep.task, task.id)];
          var labelBox = route && route.label;
          var label = svgEl("text", {
            class: "edge-label" + (unmet ? ' edge-unmet' : ''),
            x: labelBox ? labelBox.x : (from.x + to.x + from.width) / 2,
            y: labelBox ? labelBox.y + 12 : (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 8
          });
          label.textContent = dep.gate || "";
          viewport.appendChild(label);
        }
      });
    });

    // Derives relations: gray dotted source-to-task lines. They document where a
    // task came from and never participate in readiness.
    visible.forEach(function (task) {
      task.derivedFrom.forEach(function (sourceId) {
        var from = sourcePositions[sourceId], to = positions[task.id];
        if (!from || !to) return;
        viewport.appendChild(svgEl("path", {
          class: "edge edge-derives",
          "data-mode": "derives",
          "data-from": sourceId,
          "data-to": task.id,
          d: routedPath(automatic, routeId('derives', sourceId, task.id), from, to)
        }));
      });
    });

    sources.forEach(function (source) {
      viewport.appendChild(renderSourceNode(source, sourcePositions[source.id]));
    });
    visible.filter(function (task) { return task.id !== state.task; }).forEach(function (task) { viewport.appendChild(renderNode(task, positions[task.id])); });
    var selected = visible.find(function (task) { return task.id === state.task; });
    if (selected) viewport.appendChild(renderNode(selected, positions[selected.id]));
    var boxes = Object.keys(positions).map(function (id) { return positions[id]; }).concat(Object.keys(sourcePositions).map(function (id) { return sourcePositions[id]; }), Object.keys(contractPositions).map(function (id) { return contractPositions[id]; }));
    if (automatic) boxes.push({ x: 0, y: 0, width: automatic.width, height: automatic.height });
    var bookBox = { x: PAD, y: boxes.length ? Math.max.apply(null, boxes.map(function (b) { return b.y + b.height; })) + GAP_Y : PAD, width: NODE_W, height: 88 };
    viewport.appendChild(renderErrorBookNode(bookBox));
    boxes.push(bookBox);
    if (boxes.length) {
      var minX = Math.min.apply(null, boxes.map(function (b) { return b.x; })), minY = Math.min.apply(null, boxes.map(function (b) { return b.y; }));
      graphBounds = { x: minX, y: minY,
        width: Math.max.apply(null, boxes.map(function (b) { return b.x + b.width; })) - minX,
        height: Math.max.apply(null, boxes.map(function (b) { return b.y + b.height; })) - minY };
    } else graphBounds = { x: 0, y: 0, width: 1, height: 1 };

    if (visible.length === 0) {
      var active = activeFilters();
      setMessage(all.length === 0
        ? "This graph has no tasks yet."
        : "No task matches the active filters: " + active.join(", ") + ". Clear filters to see all " + all.length + " task(s).",
        false);
    } else {
      setMessage("", false);
    }
    var summary = document.getElementById("filter-summary");
    summary.textContent = activeFilters().length === 0
      ? "Showing all " + all.length + " task(s)."
      : "Filtering " + activeFilters().join(", ") + " \u2014 " + visible.length + "/" + all.length + " task(s).";
    var focus = state.task || (state.panel === 'contract' ? (state.document || '').split('#')[0] : null);
    viewport.querySelectorAll('.edge').forEach(function (edge) {
      var related = edge.getAttribute('data-from') === focus || edge.getAttribute('data-to') === focus;
      edge.classList.toggle('related', !!focus && related); edge.classList.toggle('unrelated', !!focus && !related);
    });
    if (fitAfterLayout && (automatic || layoutFailures.has(activeLayoutKey))) {
      fitAfterLayout = false; fit();
    } else if (automatic && selectionAnchor && selectionAnchor.id === state.task && positions[state.task]) {
      var selectedBox = positions[state.task];
      state.x = selectionAnchor.x - (selectedBox.x + selectedBox.width / 2) * state.k;
      state.y = selectionAnchor.y - (selectedBox.y + selectedBox.height / 2) * state.k;
      selectionAnchor = null; viewport.setAttribute('transform', transform());
    }
    if (automatic) svg.dispatchEvent(new CustomEvent('layoutready'));
  }

  function currentErrorBook() {
    var included = {}; included[state.graph] = true;
    var changed = true;
    while (changed) {
      changed = false;
      DATA.tasks.forEach(function (task) {
        if (included[task.graph] && task.subgraph && !included[task.subgraph.graph]) { included[task.subgraph.graph] = true; changed = true; }
      });
    }
    return (DATA.errorBook || []).filter(function (entry) { return included[entry.graph]; });
  }
  function renderErrorBookNode(position) {
    var group = svgEl('g', { class: 'node error-book' + (state.panel === 'error-book' ? ' selected' : ''),
      transform: 'translate(' + position.x + ',' + position.y + ')', 'data-kind': 'error-book', tabindex: 0, role: 'button', 'aria-label': '打开 error-book 错题本' });
    group.appendChild(svgEl('rect', { class: 'node-body', width: position.width, height: position.height, rx: 8 }));
    var title = svgEl('text', { class: 'title', x: 14, y: 29 }); title.textContent = 'error-book · 错题本'; group.appendChild(title);
    var subtitle = svgEl('text', { class: 'meta', x: 14, y: 56 }); subtitle.textContent = '点击阅读失败小报告'; group.appendChild(subtitle);
    return group;
  }
  function renderErrorBook(body) {
    var entries = currentErrorBook();
    var html = '<h3>error-book · 错题本</h3><p class="muted">当前图及子图 · 按时间追加</p>';
    if (!entries.length) html += '<p>暂无失败小报告。</p>';
    entries.forEach(function (entry) {
      html += '<article class="error-book-entry"><h4>' + esc(entry.at) + '</h4><p><button type="button" data-error-task="' + esc(entry.task) + '">' + esc(entry.task + ' · ' + entry.title) + '</button></p>';
      if (entry.actor) html += '<p class="muted">Reviewer: ' + esc(entry.actor) + '</p>';
      html += '<div class="markdown">' + (entry.report.html || '<p>' + esc(entry.report.error || '无法读取小报告') + '</p>') + '</div>';
      if (entry.evidence.length) html += '<details><summary>本轮验收报告快照</summary>' + entry.evidence.map(function (file) {
        return '<p><a target="_blank" rel="noopener" href="../../' + file.split('/').map(encodeURIComponent).join('/') + '">' + esc(file) + '</a></p>';
      }).join('') + '</details>';
      html += '</article>';
    });
    body.innerHTML = html;
  }
  function edgePath(from, to) {
    var x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2;
    var bend = Math.max(30, (x2 - x1) / 2);
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  function visibleSources(visible) {
    var wanted = {};
    visible.forEach(function (task) {
      task.derivedFrom.forEach(function (id) { wanted[id] = true; });
    });
    return DATA.sources.filter(function (source) { return wanted[source.id]; })
      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  }

  function transform() {
    return "translate(" + state.x + "," + state.y + ") scale(" + state.k + ")";
  }
  function renderSourceNode(source, position) {
    var group = svgEl("g", {
      class: "node source",
      transform: "translate(" + position.x + "," + position.y + ")",
      "data-source": source.id,
      "data-kind": "source"
    });
    group.appendChild(svgEl("rect", { class: "node-body", width: NODE_W, height: NODE_H, rx: 8 }));
    var title = svgEl("text", { class: "title", x: 12, y: 24 });
    title.textContent = source.id;
    group.appendChild(title);
    var meta = svgEl("text", { class: "meta", x: 12, y: 42 });
    meta.textContent = "source \u00b7 " + clip(source.file, 22);
    group.appendChild(meta);
    return group;
  }
  function renderNode(task, position) {
    var metrics = position.metrics, w = metrics.width, h = metrics.height, s = metrics.scale;
    var target = completionTargets[task.id] === true;
    var classes = "node status-" + task.status + " readiness-" + task.readiness +
      (target ? " completion-target" : "") +
      (task.subgraph ? " composite" : "") +
      (task.claim ? " claim" : "") + (state.task === task.id ? ' selected' : '');
    var group = svgEl("g", {
      class: classes,
      transform: "translate(" + position.x + "," + position.y + ")",
      "data-task": task.id,
      "data-status": task.status,
      "data-readiness": task.readiness,
      'data-expanded': String(state.task === task.id),
      'aria-label': task.id + ' ' + task.title + (task.subgraph ? '，双击进入子图' : ''),
      'aria-pressed': String(state.task === task.id),
      tabindex: "0",
      role: "button"
    });
    if (target) {
      group.appendChild(svgEl("rect", {
        class: "target-ring",
        x: -4, y: -4, width: w + 8, height: h + 8, rx: 12
      }));
    }
    group.appendChild(svgEl("rect", { class: "node-body", width: w, height: h, rx: 10 }));
    var tooltip = svgEl('title', {}); tooltip.textContent = task.title; group.appendChild(tooltip);
    var identity = svgEl('text', { class: 'identity', x: 14 * s, y: 23 * s, style: 'font-size:' + 11 * s + 'px' }); identity.textContent = task.id; group.appendChild(identity);
    var statusRight = w - (task.subgraph ? 48 : 14) * s;
    var badge = svgEl("text", { class: "badge", x: statusRight - 43 * s, y: 23 * s, style: 'font-size:' + 11 * s + 'px', "text-anchor": "end" });
    badge.textContent = nodeIcon(task);
    group.appendChild(badge);
    var statusLabel = svgEl('text', { class: 'state-label', x: statusRight, y: 23 * s, style: 'font-size:' + 11 * s + 'px', 'text-anchor': 'end' });
    statusLabel.textContent = { blocked: '受阻', pending_review: '待审查', reviewing: '审查中', reject: '未通过', done: '已完成', in_progress: '执行中', cancelled: '已取消', todo: '待开始' }[task.status] || task.status;
    group.appendChild(statusLabel);
    if (target) {
      var marker = svgEl("text", { class: "target-marker", x: w - 14, y: h - 10, "text-anchor": "middle" });
      marker.textContent = TARGET_MARKER;
      group.appendChild(marker);
    }
    var title = svgEl("text", { class: "title", x: 14 * s, y: 45 * s, style: 'font-size:' + 14 * s + 'px' });
    metrics.lines.forEach(function (line, index) {
      var span = svgEl('tspan', { x: 14 * s, y: (45 + index * 20) * s }); span.textContent = line; title.appendChild(span);
    });
    group.appendChild(title);
    var meta = svgEl("text", { class: "meta", x: 14 * s, y: metrics.metaY, style: 'font-size:' + 11 * s + 'px' });
    var planLabel = { skeleton: '骨架', awaiting_review: '待主控细化', refined: '已细化' };
    meta.textContent = (task.status === 'blocked' ? '受阻：' + ((task.manualBlockers || [])[0] || '查看阻塞原因').slice(0, 16) : planLabel[task.planningState] || (task.readiness === 'unready' ? '前置条件未满足' : '依赖已满足')) + ' · ' + task.dependsOn.length + ' 个依赖';
    group.appendChild(meta);
    if (task.claim) {
      var claimText = task.claim.role + " / " + task.claim.sessionId;
      var chipWidth = Math.min(w - 28 * s, 14 * s + textWidth(claimText, 10 * s));
      group.appendChild(svgEl("rect", {
        class: "claim-chip", x: 12 * s, y: metrics.metaY + 8 * s, width: chipWidth, height: 18 * s, rx: 7
      }));
      var claim = svgEl("text", { class: "claim", x: 18 * s, y: metrics.metaY + 21 * s, style: 'font-size:' + 10 * s + 'px' });
      claim.textContent = wrapText(claimText, chipWidth - 12 * s, 10 * s, 1)[0];
      group.appendChild(claim);
    }
    metrics.tags.forEach(function (tab) {
      var tag = svgEl('g', { class: 'doc-tab' + (state.task === task.id && state.panel === tab.key ? ' active' : ''),
        'data-panel': tab.key, tabindex: 0, role: 'button', 'aria-label': task.id + ' ' + tab.label });
      tag.appendChild(svgEl('rect', { x: tab.x, y: tab.y, width: tab.width, height: 26 * s, rx: 7 }));
      var label = svgEl('text', { x: tab.x + 9 * s, y: tab.y + 17 * s, style: 'font-size:' + 11 * s + 'px' }); label.textContent = tab.label; tag.appendChild(label);
      group.appendChild(tag);
    });
    if (task.subgraph) {
      var child = svgEl('g', { class: 'child-link', 'data-graph': task.subgraph.graph, tabindex: 0, role: 'button', 'aria-label': '进入子图 ' + task.subgraph.graph });
      child.appendChild(svgEl('rect', { x: w - 38 * s, y: 7 * s, width: 28 * s, height: 24 * s, rx: 6 }));
      var arrow = svgEl('text', { x: w - 24 * s, y: 24 * s, style: 'font-size:' + 17 * s + 'px', 'text-anchor': 'middle' }); arrow.textContent = '↳'; child.appendChild(arrow);
      group.appendChild(child);
    }
    return group;
  }
  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
  }

  function renderContractNode(contract, position) {
    var group = svgEl('g', { class: 'node contract', transform: 'translate(' + position.x + ',' + position.y + ')', 'data-kind': 'contract', 'data-contract': contract.id, role: 'button', tabindex: 0, 'aria-label': '契约 ' + contract.title });
    var height = position.height - 12, sections = contract.sections || [];
    [10, 5].forEach(function (shift) { group.appendChild(svgEl('rect', { class: 'contract-sheet', x: shift, y: shift, width: NODE_W, height: height, rx: 8 })); });
    group.appendChild(svgEl('rect', { class: 'node-body', width: NODE_W, height: height, rx: 8 }));
    var title = svgEl('text', { x: 14, y: 25 }); title.textContent = contract.id + ' · 契约'; group.appendChild(title);
    var name = svgEl('text', { x: 14, y: 47 }); name.textContent = clip(contract.title, 22); group.appendChild(name);
    var meta = svgEl('text', { x: 14, y: 65, class: 'node-meta' }); meta.textContent = sections.length ? sections.length + ' 个章节 · 点击标题查看全文' : '点击查看全文'; group.appendChild(meta);
    group.appendChild(svgEl('circle', { class: 'contract-port', cx: NODE_W, cy: CONTRACT_HEADER / 2, r: 4 }));
    if (sections.length) {
      var toggle = svgEl('g', { 'data-contract-toggle': contract.id, role: 'button', tabindex: 0, 'aria-label': collapsedContracts[contract.id] ? '展开章节' : '收起章节', 'aria-expanded': String(!collapsedContracts[contract.id]) });
      toggle.appendChild(svgEl('rect', { x: NODE_W - 34, y: 8, width: 26, height: 24, rx: 4, class: 'contract-toggle' }));
      var icon = svgEl('text', { x: NODE_W - 27, y: 25 }); icon.textContent = collapsedContracts[contract.id] ? '+' : '−'; toggle.appendChild(icon); group.appendChild(toggle);
    }
    if (!collapsedContracts[contract.id]) sections.forEach(function (section, index) {
      var selected = state.panel === 'contract' && state.document === contract.id + '#' + section.id;
      var row = svgEl('g', { class: 'contract-section' + (selected ? ' selected' : ''), transform: 'translate(0,' + (CONTRACT_HEADER + index * CONTRACT_ROW) + ')', 'data-section': section.id, role: 'button', tabindex: 0, 'aria-label': section.title });
      row.appendChild(svgEl('rect', { width: NODE_W, height: CONTRACT_ROW, class: 'contract-row' }));
      var label = svgEl('text', { x: 14, y: 24 }); label.textContent = clip(section.title, 22); row.appendChild(label);
      var hint = svgEl('title'); hint.textContent = contract.id + '#' + section.id; row.appendChild(hint);
      row.appendChild(svgEl('circle', { class: 'contract-port', cx: NODE_W, cy: CONTRACT_ROW / 2, r: 4 })); group.appendChild(row);
    });
    return group;
  }
  function renderCodeEntries(entries) {
    return '<h3>代码入口</h3>' + (entries.length ? '<ul>' + entries.map(function (r) {
      return '<li><strong>' + esc(r.id + ' · ' + r.symbol) + '</strong><br><code>' + esc(r.path + ':' + r.line) + '</code><p>' + esc(r.summary) + '</p></li>';
    }).join('') + '</ul>' : '<p class="muted">无登记入口。</p>');
  }
  function renderDetails() {
    var body = document.getElementById("details-body");
    if (state.panel === 'contract') {
      var address = (state.document || '').split('#');
      var contract = (DATA.contracts || []).find(function (c) { return c.id === address[0]; });
      if (contract) {
        var section = (contract.sections || []).find(function (s) { return s.id === address[1]; });
        body.innerHTML = '<h3>' + esc(contract.id + ' · ' + contract.title) + '</h3><p class="muted">' + esc(section ? '章节：' + section.title : '当前契约 · 全文') + '</p>' +
          '<small>' + esc(contract.file + (section ? '#' + section.id : '')) + '</small>' + (contract.document.error ? '<p>' + esc(contract.document.error) + '</p>' : section ? section.html : contract.document.html || '') +
          renderCodeEntries((DATA.references || []).filter(function (r) { return contract.references.indexOf(r.id) >= 0; }));
        return;
      }
    }
    if (state.panel === 'error-book') { renderErrorBook(body); return; }
    var task = state.task ? tasksById[state.task] : null;
    if (!task) { body.innerHTML = githubBadge(graphsById[state.graph]) + '<p class="muted">Select a task node.</p>'; return; }
    if (state.panel === 'codeReferences') { body.innerHTML = panelNav(task) + renderCodeEntries(task.codeReferences || []); return; }
    if (state.panel !== 'overview') { renderDocumentPanel(task, body); return; }
    var blockers = task.blockedBy.map(function (reason) {
      if (reason.kind === "manual") return "manual: " + reason.text;
      if (reason.kind === "task") return "unmet dependency: " + reason.task;
      if (reason.kind === "refinement") return "待主控细化: " + reason.state;
      return "unmet completion point: " + reason.task + ":" + reason.gate +
        (reason.tasks.length ? " (" + reason.tasks.join(", ") + ")" : "");
    });
    var html = "";
    html += "<h3>" + esc(task.id) + "</h3>" + panelNav(task) + '<dl>';
    html += "<dt>Graph</dt><dd>" + esc(task.graph) + "</dd>";
    html += "<dt>Status</dt><dd>" + esc(task.status) + "</dd>";
    if (task.planningState && task.planningState !== 'static') html += '<dt>Planning</dt><dd>' + esc(task.planningState) + '</dd>';
    if (task.review) html += '<dt>自动审查</dt><dd>' + (task.review.enabled ? '开启' : '关闭') + '</dd>' + (task.review.current ? '<dt>审查轮次</dt><dd>' + esc(task.review.current.id) + ' · ' + esc(task.review.current.state) + '</dd><dt>审查日志</dt><dd>' + esc(task.review.current.log) + '</dd>' + (task.review.current.error ? '<dt>审查异常</dt><dd>' + esc(task.review.current.error) + '</dd>' : '') : '');
    if (task.kind === 'acceptance') html += '<dt>验收</dt><dd>' + esc(task.status === 'done' ? 'pass' : task.status === 'reject' ? 'reject' : '待验收') + '</dd>';
    html += "<dt>Readiness</dt><dd>" + esc(task.readiness) + "</dd>";
    html += "<dt>Claim</dt><dd>" + (task.claim ? esc(task.claim.role + " / " + task.claim.sessionId) : "\u2014") + "</dd>";
    html += "<dt>Blocked by</dt><dd>" + (blockers.length ? esc(blockers.join("; ")) : "\u2014") + "</dd>";
    html += "<dt>Depends on</dt><dd>" + (task.dependsOn.length ? task.dependsOn.map(function (d) {
      return '<button class="task-jump" data-task-jump="' + esc(d.task) + '">' + esc(d.mode === 'partial' ? d.task + ':' + d.gate : d.task) + '</button>';
    }).join(' ') : "\u2014") + "</dd>";
    html += "</dl>";
    if (task.subgraph) {
      html += '<button type="button" class="composite-button" data-graph="' + esc(task.subgraph.graph) + '">' +
        "Open child graph " + esc(task.subgraph.graph) + "</button>";
    }
    html += documentsFor(task).content.path === '.task-graph/tasks/' + task.id + '.md' ? documentsFor(task).content.html : '<h1>' + esc(task.title) + '</h1><p class="muted">点击「任务要求」阅读完整说明。</p>';
    if (task.history && task.history.length) {
      html += '<details class="audit"><summary>操作历史 · ' + task.history.length + '</summary><ol>';
      task.history.slice().reverse().forEach(function (event) {
        html += '<li><strong>' + esc(event.event) + '</strong><small>' + esc(event.at + (event.actor ? ' · ' + event.actor : '')) + '</small><pre>' + esc(JSON.stringify(event.extra, null, 2)) + '</pre></li>';
      });
      html += '</ol></details>';
    }
    body.innerHTML = html;
    var composite = body.querySelector(".composite-button");
    if (composite) {
      composite.addEventListener("click", function () {
        selectGraph(composite.getAttribute("data-graph"), null);
      });
    }
  }

  function panelNav(task) {
    return githubBadge(task) + '<nav class="panel-tabs" aria-label="任务内容分类">' + [{ key: 'overview', label: '概览' }].concat(tabsFor(task)).map(function (tab) {
      return '<button data-panel="' + tab.key + '" aria-current="' + String(state.panel === tab.key) + '">' + esc(tab.label) + '</button>';
    }).join('') + '</nav>';
  }
  function githubBadge(entity) {
    var gh = entity && entity.github;
    if (!gh) return '';
    return '<div class="github-sync"><strong>GitHub · ' + (gh.status === 'synced' ? '已同步' : '待同步') + '</strong>' +
      (gh.url ? ' <a target="_blank" rel="noopener noreferrer" href="' + esc(gh.url) + '">#' + esc(gh.number) + '</a>' : ' · ' + esc(gh.repo || '')) +
      (gh.pendingComments ? '<p>' + gh.pendingComments + ' 条评论待发送</p>' : '') +
      (gh.error ? '<p class="muted">' + esc(gh.error) + '</p>' : '') + '</div>';
  }
  function renderDocumentPanel(task, body) {
    var docs = documentsFor(task), category = state.panel;
    var entries = category === 'content' ? (docs.contents || [docs.content]) : (docs[category] || []);
    var chosen = category === 'content' && entries.length === 1 ? entries[0] : entries.find(function (doc) { return doc.id === state.document; });
    var html = '<h3>' + esc(task.id) + '</h3>' + panelNav(task);
    if (chosen) {
      if (category !== 'content' || entries.length > 1) html += '<button class="back-to-list" data-document-back="true">← 返回' + PANEL_LABELS[category] + '列表</button>';
      html += '<div class="document-heading"><strong>' + esc(chosen.title) + '</strong><small>' + esc(chosen.path || '') + '</small>';
      if (chosen.summary) html += '<p>' + esc(chosen.summary) + '</p>';
      if (chosen.audience === 'user') html += '<small>仅供用户阅读 · 不参与代理交接</small>';
      if (chosen.source_task) html += '<small>来源任务：' + esc(chosen.source_task) + '</small>';
      if (chosen.read_path && chosen.read_path !== chosen.path) html += '<small>读取地址：' + esc(chosen.read_path) + '</small>';
      if (chosen.addedAt || chosen.actor) html += '<small>' + esc([chosen.addedAt, chosen.actor].filter(Boolean).join(' · ')) + '</small>';
      if (chosen.snapshot) html += '<span class="snapshot-label">已保存交付快照</span>';
      html += '</div><article class="document-content">';
      if (chosen.error) html += '<p class="document-error">' + esc(chosen.error) + '</p>';
      else if (chosen.html !== undefined) html += chosen.html;
      else if (chosen.href) html += '<a href="' + esc(chosen.href) + '" target="_blank" rel="noopener">打开文件</a>';
      html += '</article>';
    } else {
      html += '<h2>' + esc(PANEL_LABELS[category]) + ' <span class="muted">' + entries.length + '</span></h2><div class="document-list">';
      var previousScope = null;
      entries.forEach(function (doc) {
        if (category === 'references' && doc.scope !== previousScope) {
          html += '<h3>' + (doc.scope === 'self' ? '本任务提供的参考' : '依赖提供的参考') + '</h3>'; previousScope = doc.scope;
        }
        html += '<button class="document-item" data-document="' + esc(doc.id) + '"><strong>' + esc(doc.title) + '</strong>' +
          '<small>' + esc([doc.addedAt, doc.actor].filter(Boolean).join(' · ')) + '</small><small>' + esc(doc.path) + '</small>' +
          (doc.summary ? '<p>' + esc(doc.summary) + '</p>' : '') +
          (doc.audience === 'user' ? '<small>仅供用户阅读 · 不参与代理交接</small>' : '') +
          (doc.source_task ? '<small>来源：' + esc(doc.source_task) + ' · ' + (doc.snapshot ? '固定快照' : '当前文件') + '</small>' : '') +
          (doc.read_path && doc.read_path !== doc.path ? '<small>读取：' + esc(doc.read_path) + '</small>' : '') +
          (doc.error ? '<span class="document-error">文件不可读</span>' : '') + '</button>';
      });
      html += '</div>';
      if (!entries.length) html += '<p class="muted">暂时没有' + esc(PANEL_LABELS[category]) + '。</p>';
    }
    body.innerHTML = html;
  }

  function selectGraph(graphId, taskId) {
    selectionAnchor = null; layoutSelection = null; fitAfterLayout = true;
    if (!graphsById[graphId]) {
      state.graph = graphId;
      state.task = null;
      renderNav(); renderBreadcrumbs(); renderGraph(); renderDetails(); writeHash();
      return;
    }
    state.graph = graphId;
    state.task = taskId && tasksById[taskId] && tasksById[taskId].graph === graphId ? taskId : null;
    state.panel = 'overview'; state.document = null;
    state.x = PAD; state.y = PAD; state.k = 1;
    renderNav(); renderBreadcrumbs(); renderGraph(); renderDetails(); writeHash();
  }
  function selectTask(taskId) {
    captureSelectionAnchor(taskId); fitAfterLayout = false;
    state.task = taskId;
    state.panel = 'overview'; state.document = null;
    renderGraph(); renderDetails(); writeHash();
  }
  function selectPanel(taskId, panel) {
    captureSelectionAnchor(taskId); fitAfterLayout = false;
    if (collapseTimer) clearTimeout(collapseTimer);
    lastNodeClick = { id: null, at: 0 };
    state.task = taskId; state.panel = panel; state.document = null;
    renderGraph(); renderDetails(); writeHash();
  }
  function captureSelectionAnchor(taskId) {
    selectionAnchor = null;
    var node = Array.from(document.querySelectorAll('.node[data-task]')).find(function (n) { return n.getAttribute('data-task') === taskId; });
    if (!node) return;
    var match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
    var body = node.querySelector('.node-body');
    if (match && body) selectionAnchor = { id: taskId,
      x: state.x + (Number(match[1]) + Number(body.getAttribute('width')) / 2) * state.k,
      y: state.y + (Number(match[2]) + Number(body.getAttribute('height')) / 2) * state.k };
  }
  function writeHash() {
    if (readingHash) return;
    var hash = "#graph=" + encodeURIComponent(state.graph || "") +
      (state.task ? "&task=" + encodeURIComponent(state.task) : "") +
      ((state.task && state.panel !== 'overview') || state.panel === 'error-book' || state.panel === 'contract' ? '&panel=' + encodeURIComponent(state.panel) : '') +
      ((state.task || state.panel === 'contract') && state.document ? '&document=' + encodeURIComponent(state.document) : '');
    if (window.location.hash === hash) return;
    try {
      window.history.replaceState(null, "", hash);
    } catch (error) {
      var url = new URL(hash, window.location.href).href;
      ownHashChanges.set(url, (ownHashChanges.get(url) || 0) + 1);
      window.location.hash = hash;
    }
  }
  function readHash() {
    // Restore graph, task and document together. On file://, replaceState can
    // fall back to hash assignment; writing intermediate states would enqueue
    // alternating hashchange events forever (overview -> contract -> overview).
    readingHash = true;
    try {
    var raw = window.location.hash.replace(/^#/, "");
    var params = {};
    raw.split("&").forEach(function (pair) {
      var index = pair.indexOf("=");
      if (index < 0) return;
      params[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1));
    });
    var entry = DATA.graphs.filter(function (g) { return g.entry; })[0] || DATA.graphs[0];
    var graphId = params.graph || (entry ? entry.id : null);
    if (!graphId) { renderGraph(); return; }
    selectGraph(graphId, params.task || null);
    if (params.panel === 'contract' && (DATA.contracts || []).some(function (c) { var parts = (params.document || '').split('#'); return c.id === parts[0] && (!parts[1] || (c.sections || []).some(function (s) { return s.id === parts[1]; })); })) { state.task = null; state.panel = 'contract'; state.document = params.document; renderGraph(); renderDetails(); writeHash(); return; }
    if (params.panel === 'error-book' && graphsById[state.graph]) { state.task = null; state.panel = 'error-book'; renderGraph(); renderDetails(); writeHash(); return; }
    if (state.task && PANEL_LABELS[params.panel]) {
      state.panel = params.panel; state.document = params.document || null;
      renderGraph(); renderDetails(); writeHash();
    }
    } finally { readingHash = false; writeHash(); }
  }

  function fit() {
    var svg = document.getElementById("graph");
    var box = graphBounds;
    var width = svg.clientWidth || 800, height = svg.clientHeight || 600;
    var scale = Math.min(1.4, Math.max(0.005, Math.min(
      (width - 2 * PAD) / Math.max(box.width, 1),
      (height - 2 * PAD) / Math.max(box.height, 1)
    )));
    state.k = scale;
    state.x = (width - box.width * scale) / 2 - box.x * scale;
    state.y = (height - box.height * scale) / 2 - box.y * scale;
    var viewport = document.getElementById('viewport');
    if (viewport) viewport.setAttribute('transform', transform());
  }
  function zoom(factor) {
    fitAfterLayout = false; selectionAnchor = null;
    var svg = document.getElementById('graph'), old = state.k;
    state.k = Math.min(3, Math.max(0.005, state.k * factor));
    var x = (svg.clientWidth || 800) / 2, y = (svg.clientHeight || 600) / 2;
    state.x = x - (x - state.x) * state.k / old; state.y = y - (y - state.y) * state.k / old;
    var viewport = document.getElementById('viewport');
    if (viewport) viewport.setAttribute('transform', transform());
  }
  document.querySelectorAll("#viewport-controls button").forEach(function (button) {
    button.addEventListener("click", function () {
      var action = button.getAttribute("data-view");
      if (action === "fit") {
        selectionAnchor = null;
        fitAfterLayout = document.getElementById('graph').getAttribute('data-layout-state') === 'pending';
        fit();
      }
      else zoom(action === "zoom-in" ? 1.2 : 1 / 1.2);
    });
  });
  document.getElementById('layout-direction').addEventListener('change', function (event) {
    layoutDirection = event.target.value === 'DOWN' ? 'DOWN' : 'RIGHT';
    selectionAnchor = null; fitAfterLayout = true; renderGraph();
  });
  document.getElementById('show-contracts').addEventListener('change', function (event) {
    showContracts = event.target.checked;
    selectionAnchor = null; fitAfterLayout = true; renderGraph();
  });
  document.getElementById("claim-filter").addEventListener("input", function (event) {
    state.filters.claim = event.target.value.trim();
    renderGraph();
  });
  document.getElementById("clear-filters").addEventListener("click", function () {
    state.filters = { status: [], readiness: [], claim: "" };
    document.getElementById("claim-filter").value = "";
    renderFilters();
    renderGraph();
  });
  var svg = document.getElementById("graph");
  document.getElementById('details-body').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (button && button.hasAttribute('data-error-task')) {
      var errorTask = tasksById[button.getAttribute('data-error-task')];
      if (errorTask) selectGraph(errorTask.graph, errorTask.id);
      return;
    }
    if (!button || !state.task) return;
    if (button.hasAttribute('data-panel')) selectPanel(state.task, button.getAttribute('data-panel'));
    else if (button.hasAttribute('data-document')) {
      state.document = button.getAttribute('data-document'); renderDetails(); writeHash();
    } else if (button.hasAttribute('data-document-back')) {
      state.document = null; renderDetails(); writeHash();
    } else if (button.hasAttribute('data-task-jump')) {
      var target = tasksById[button.getAttribute('data-task-jump')];
      if (target) { if (target.graph === state.graph) selectTask(target.id); else selectGraph(target.graph, target.id); }
    }
  });
  function activateCanvasTarget(target, keyboard) {
    if (!target || typeof target.closest !== 'function') return;
    var contractNode = target.closest('[data-kind="contract"]');
    if (contractNode) {
      var contractId = contractNode.getAttribute('data-contract');
      if (target.closest('[data-contract-toggle]')) { collapsedContracts[contractId] = !collapsedContracts[contractId]; renderGraph(); return; }
      var sectionNode = target.closest('.contract-section');
      if (collapseTimer) clearTimeout(collapseTimer); state.task = null; state.panel = 'contract'; state.document = contractId + (sectionNode ? '#' + sectionNode.getAttribute('data-section') : ''); renderGraph(); renderDetails(); writeHash(); return;
    }
    if (target.closest('[data-kind="error-book"]')) {
      if (collapseTimer) clearTimeout(collapseTimer);
      state.task = null; state.panel = 'error-book'; state.document = null;
      renderGraph(); renderDetails(); writeHash(); return;
    }
    var node = target.closest('.node[data-task]');
    if (!node) { if (!target.closest('.node')) selectTask(null); return; }
    var id = node.getAttribute('data-task'), task = tasksById[id];
    var tab = target.closest('.doc-tab'), child = target.closest('.child-link');
    if (collapseTimer) clearTimeout(collapseTimer);
    if (tab) { selectPanel(id, tab.getAttribute('data-panel')); return; }
    if (child) { selectGraph(task.subgraph.graph, null); return; }
    var now = Date.now();
    if (!keyboard && task.subgraph && lastNodeClick.id === id && now - lastNodeClick.at < 350) {
      lastNodeClick = { id: null, at: 0 }; selectGraph(task.subgraph.graph, null); return;
    }
    lastNodeClick = { id: id, at: now };
    if (state.task === id && task.subgraph && !keyboard) {
      collapseTimer = setTimeout(function () { if (state.task === id) selectTask(null); }, 350);
    } else selectTask(state.task === id ? null : id);
  }
  svg.addEventListener('click', function (event) {
    if (Date.now() < suppressClickUntil) return;
    activateCanvasTarget(event.target, false);
  });
  svg.addEventListener('dblclick', function (event) {
    var node = event.target.closest('.node[data-task]');
    if (!node || event.target.closest('.doc-tab, .child-link')) return;
    var task = tasksById[node.getAttribute('data-task')];
    if (task && task.subgraph && task.graph === state.graph) {
      if (collapseTimer) clearTimeout(collapseTimer);
      event.preventDefault(); selectGraph(task.subgraph.graph, null);
    }
  });
  svg.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateCanvasTarget(event.target, true); }
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { if (collapseTimer) clearTimeout(collapseTimer); selectTask(null); }
  });
  svg.addEventListener("wheel", function (event) {
    if (event.preventDefault) event.preventDefault();
    zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  var dragging = null;
  svg.addEventListener("mousedown", function (event) {
    if (event.button !== 0 || event.target.closest('.node')) return;
    fitAfterLayout = false; selectionAnchor = null;
    dragging = { x: event.clientX, y: event.clientY, ox: state.x, oy: state.y };
    svg.classList.add("dragging");
  });
  window.addEventListener("mousemove", function (event) {
    if (!dragging) return;
    if (Math.abs(event.clientX - dragging.x) + Math.abs(event.clientY - dragging.y) > 4) dragging.moved = true;
    state.x = dragging.ox + (event.clientX - dragging.x);
    state.y = dragging.oy + (event.clientY - dragging.y);
    var viewport = document.getElementById("viewport");
    if (viewport) viewport.setAttribute("transform", transform());
  });
  window.addEventListener("mouseup", function () {
    if (dragging && dragging.moved) suppressClickUntil = Date.now() + 150;
    dragging = null; svg.classList.remove("dragging");
  });
  window.addEventListener("hashchange", function (event) {
    // file:// history fallbacks emit an event for state we already rendered.
    // Re-reading our own selection would reset its zoom and trigger another fit.
    var count = ownHashChanges.get(event.newURL) || 0;
    if (count) {
      if (count === 1) ownHashChanges.delete(event.newURL); else ownHashChanges.set(event.newURL, count - 1);
      return;
    }
    readHash();
  });

  document.getElementById("project-name").textContent = DATA.project.name;
  renderFilters();
  readHash();
})();
`;
