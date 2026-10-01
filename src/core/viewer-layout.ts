/** Browser-only layout adapter. It receives visual geometry, never workflow state. */
export const VIEWER_LAYOUT_JS = String.raw`
(function () {
  'use strict';
  var engine;
  window.TaskGraphLayout = {
    layout: function (input) {
      if (!engine) engine = new ELK();
      var connected = {}, originals = {};
      input.edges.forEach(function (edge) { connected[edge.from] = connected[edge.to] = true; });
      input.nodes.forEach(function (node) { originals[node.id] = node; });
      var active = input.nodes.filter(function (node) { return connected[node.id]; });
      var isolated = input.nodes.filter(function (node) { return !connected[node.id]; });
      var graph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered', 'elk.direction': input.direction, 'elk.edgeRouting': 'ORTHOGONAL',
          'elk.padding': '[top=36,left=36,bottom=36,right=36]',
          'elk.spacing.nodeNode': '44', 'elk.layered.spacing.nodeNodeBetweenLayers': '76',
          'elk.spacing.edgeNode': '18', 'elk.layered.spacing.edgeNodeBetweenLayers': '18',
          'elk.spacing.edgeEdge': '10', 'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
          'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.layered.thoroughness': '20', 'elk.randomSeed': '23', 'elk.layered.mergeEdges': 'false'
        },
        children: active.map(function (node) {
          return { id: node.id, width: node.width, height: node.height, ports: [],
            layoutOptions: { 'elk.portConstraints': node.kind === 'contract' ? 'FIXED_POS' : 'FIXED_SIDE' } };
        }),
        edges: []
      };
      var byId = {}; graph.children.forEach(function (node) { byId[node.id] = node; });
      input.edges.forEach(function (edge) {
        var from = originals[edge.from], out = { id: edge.id + ':out', width: 0, height: 0,
          layoutOptions: { 'elk.port.side': input.direction === 'DOWN' ? 'SOUTH' : 'EAST' } };
        if (from.kind === 'contract') {
          out.x = edge.portX; out.y = edge.portY;
          out.layoutOptions['elk.port.side'] = 'EAST';
          out.layoutOptions['elk.port.borderOffset'] = String(edge.portX - from.width);
        }
        var into = { id: edge.id + ':in', width: 0, height: 0,
          layoutOptions: { 'elk.port.side': input.direction === 'DOWN' ? 'NORTH' : 'WEST' } };
        byId[edge.from].ports.push(out); byId[edge.to].ports.push(into);
        var routed = { id: edge.id, sources: [out.id], targets: [into.id] };
        if (edge.label) routed.labels = [{ text: edge.label, width: edge.labelWidth, height: 16,
          layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }];
        graph.edges.push(routed);
      });
      return (active.length ? engine.layout(graph) : Promise.resolve({ children: [], edges: [], width: 0, height: 0 })).then(function (result) {
        var nodes = {}, edges = {}, width = result.width, height = result.height, group = null;
        result.children.forEach(function (node) { nodes[node.id] = { x: node.x, y: node.y }; });
        result.edges.forEach(function (edge) {
          var sections = (edge.sections || []).map(function (section) {
            return [section.startPoint].concat(section.bendPoints || [], [section.endPoint]);
          });
          if (!sections.length) throw new Error('Missing route for ' + edge.id);
          edges[edge.id] = { sections: sections, label: edge.labels && edge.labels[0] };
        });
        if (isolated.length) {
          var cellW = Math.max.apply(null, isolated.map(function (n) { return n.width; })) + 32;
          var cellH = Math.max.apply(null, isolated.map(function (n) { return n.height; })) + 32;
          var columns = Math.min(5, isolated.length, Math.max(1, Math.floor((width || cellW * 3 + 72) / cellW)));
          var top = active.length ? height + 48 : 36;
          isolated.forEach(function (node, index) {
            nodes[node.id] = { x: 36 + index % columns * cellW, y: top + (active.length ? 40 : 0) + Math.floor(index / columns) * cellH };
          });
          width = Math.max(width, columns * cellW + 72);
          height = top + (active.length ? 40 : 0) + Math.ceil(isolated.length / columns) * cellH;
          if (active.length) group = { x: 20, y: top, width: columns * cellW + 16, height: height - top,
            label: '独立节点 · ' + isolated.length + ' 个（没有当前视图内的连线）' };
        }
        return { nodes: nodes, edges: edges, width: Math.max(1, width), height: Math.max(1, height), group: group };
      });
    }
  };
})();
`;
