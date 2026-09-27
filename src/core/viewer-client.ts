export const VIEWER_JS = String.raw`
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("graph-data").textContent);
  var STATUS_ORDER = ["todo", "in_progress", "done", "reject", "cancelled"];
  var STATUS_LABEL = { todo: "Todo", in_progress: "Running", done: "Finished", reject: "Rejected", cancelled: "Cancelled" };
  var STATUS_ICON = { done: "\u2713", in_progress: "\u25cf", cancelled: "\u00d7" };
  var READINESS_ICON = { ready: "\u25b6", blocked: "!" };
  var TARGET_MARKER = "\u25c6";
  var NODE_W = 220, NODE_H = 76, GAP_X = 110, GAP_Y = 60, PAD = 36;
  var SOURCE_LANE = NODE_W + GAP_X;

  var state = { graph: null, task: null, panel: 'overview', document: null, k: 1, x: PAD, y: PAD,
    filters: { status: [], readiness: [], claim: "" } };
  var graphBounds = { x: 0, y: 0, width: 1, height: 1 };
  var lastNodeClick = { id: null, at: 0 }, collapseTimer = null, suppressClickUntil = 0;

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
    if (task.status === 'reject') return 'blocked';
    if (task.status === "cancelled") return "cancelled";
    if (task.status === "done") return "done";
    if (task.status === "in_progress") return "running";
    return task.readiness === "ready" ? "ready" : "blocked";
  };
  var nodeIcon = function (task) {
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
  var PANEL_LABELS = { overview: '概览', content: '任务要求', references: '参考', reports: '报告', logs: '工作记录', handoffs: '交接', outputs: '产物' };
  function tabsFor(task) {
    var docs = documentsFor(task);
    var tabs = [{ key: 'content', label: '任务要求' }];
    ['references', 'reports', 'logs', 'handoffs', 'outputs'].forEach(function (key) {
      if (docs[key] && docs[key].length) tabs.push({ key: key, label: PANEL_LABELS[key] + ' · ' + docs[key].length });
    });
    return tabs;
  }
  function nodeMetrics(task, expanded) {
    var baseWidth = Math.max(NODE_W, Math.min(300, textWidth(task.title, 14) + 32));
    var scale = expanded ? Math.max(1.1, 1 / state.k) : 1;
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

  // Left-to-right layered layout: each node sits one column right of its
  // longest dependency path, so branches may converge or end independently.
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
    ["ready", "blocked"].forEach(function (value) {
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
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!graphsById[state.graph]) {
      setMessage('Unknown graph "' + state.graph + '" in the URL hash. Choose an entry graph to continue.', true);
      document.getElementById("filter-summary").textContent = "";
      return;
    }
    var all = tasksInGraph(state.graph);
    var visible = all.filter(matchesFilters);
    var ids = {}; visible.forEach(function (t) { ids[t.id] = true; });
    layout(visible);
    var sources = visibleSources(visible);
    var offset = sources.length ? SOURCE_LANE : 0;

    var viewport = svgEl("g", { id: "viewport", transform: transform() });
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

    // Full dependencies: solid. Partial dependencies: dashed, labelled with the
    // named completion point of the composite task they depend on.
    visible.forEach(function (task) {
      task.dependsOn.forEach(function (dep) {
        if (dep.mode === "partial" && !ids[dep.task]) return;
        if (dep.mode !== "partial" && !ids[dep.task]) return;
        var from = positions[dep.task], to = positions[task.id];
        if (!from || !to) return;
        var path = svgEl("path", {
          class: "edge edge-" + (dep.mode === "partial" ? "partial" : "full"),
          "data-mode": dep.mode === "partial" ? "partial" : "full",
          "data-from": dep.task,
          "data-to": task.id,
          d: edgePath(from, to)
        });
        viewport.appendChild(path);
        if (dep.mode === "partial") {
          var label = svgEl("text", {
            class: "edge-label",
            x: (from.x + to.x + from.width) / 2,
            y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 8
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
          d: edgePath(from, to)
        }));
      });
    });

    sources.forEach(function (source) {
      viewport.appendChild(renderSourceNode(source, sourcePositions[source.id]));
    });
    visible.filter(function (task) { return task.id !== state.task; }).forEach(function (task) { viewport.appendChild(renderNode(task, positions[task.id])); });
    var selected = visible.find(function (task) { return task.id === state.task; });
    if (selected) viewport.appendChild(renderNode(selected, positions[selected.id]));
    var boxes = Object.keys(positions).map(function (id) { return positions[id]; }).concat(Object.keys(sourcePositions).map(function (id) { return sourcePositions[id]; }));
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
    statusLabel.textContent = { done: '已完成', in_progress: '执行中', cancelled: '已取消', todo: '待开始' }[task.status] || task.status;
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
    var planLabel = { skeleton: '骨架', awaiting_review: '待主控细化', refined: '已细化', stale: '需重新细化' };
    meta.textContent = (planLabel[task.planningState] || (task.readiness === 'blocked' ? '存在阻塞' : '依赖已满足')) + ' · ' + task.dependsOn.length + ' 个依赖';
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

  function renderDetails() {
    var body = document.getElementById("details-body");
    var task = state.task ? tasksById[state.task] : null;
    if (!task) { body.innerHTML = githubBadge(graphsById[state.graph]) + '<p class="muted">Select a task node.</p>'; return; }
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
    state.task = taskId;
    state.panel = 'overview'; state.document = null;
    renderGraph(); renderDetails(); writeHash();
  }
  function selectPanel(taskId, panel) {
    if (collapseTimer) clearTimeout(collapseTimer);
    lastNodeClick = { id: null, at: 0 };
    state.task = taskId; state.panel = panel; state.document = null;
    renderGraph(); renderDetails(); writeHash();
  }
  function writeHash() {
    var hash = "#graph=" + encodeURIComponent(state.graph || "") +
      (state.task ? "&task=" + encodeURIComponent(state.task) : "") +
      (state.task && state.panel !== 'overview' ? '&panel=' + encodeURIComponent(state.panel) : '') +
      (state.task && state.document ? '&document=' + encodeURIComponent(state.document) : '');
    if (window.location.hash === hash) return;
    try {
      window.history.replaceState(null, "", hash);
    } catch (error) {
      window.location.hash = hash;
    }
  }
  function readHash() {
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
    if (state.task && PANEL_LABELS[params.panel]) {
      state.panel = params.panel; state.document = params.document || null;
      renderGraph(); renderDetails(); writeHash();
    }
  }

  function fit() {
    var svg = document.getElementById("graph");
    var box = graphBounds;
    var width = svg.clientWidth || 800, height = svg.clientHeight || 600;
    var scale = Math.min(1.4, Math.max(0.2, Math.min(
      (width - 2 * PAD) / Math.max(box.width, 1),
      (height - 2 * PAD) / Math.max(box.height, 1)
    )));
    state.k = scale;
    state.x = PAD - box.x * scale;
    state.y = PAD - box.y * scale;
    renderGraph();
  }
  function zoom(factor) {
    state.k = Math.min(3, Math.max(0.15, state.k * factor));
    renderGraph();
  }
  document.querySelectorAll("#viewport-controls button").forEach(function (button) {
    button.addEventListener("click", function () {
      var action = button.getAttribute("data-view");
      if (action === "fit") fit();
      else zoom(action === "zoom-in" ? 1.2 : 1 / 1.2);
    });
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
  window.addEventListener("hashchange", readHash);

  document.getElementById("project-name").textContent = DATA.project.name;
  renderFilters();
  readHash();
})();
`;
