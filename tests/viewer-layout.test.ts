import assert from 'node:assert/strict';
import { test } from 'node:test';
import ELK from 'elkjs/lib/elk.bundled.js';
import { VIEWER_LAYOUT_JS } from '../src/core/viewer-layout.js';

interface Point { x: number; y: number }
interface Box extends Point { id: string; width: number; height: number }
interface LayoutInput {
  direction: string;
  nodes: { id: string; kind: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string; portX?: number; portY?: number; label?: string; labelWidth?: number }[];
}
interface LayoutResult {
  nodes: Record<string, Point>;
  edges: Record<string, { sections: Point[][]; label?: { text: string; x: number; y: number } }>;
  width: number;
  height: number;
  group: { x: number; y: number; width: number; height: number } | null;
}
function adapter(): { layout(input: LayoutInput): Promise<LayoutResult> } {
  const scope: { TaskGraphLayout?: ReturnType<typeof adapter> } = {};
  new Function('window', 'ELK', VIEWER_LAYOUT_JS)(scope, ELK);
  return scope.TaskGraphLayout!;
}
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function crosses(a: Point, b: Point, box: Box): boolean {
  const eps = 0.01;
  if (Math.abs(a.x - b.x) < eps) return a.x > box.x + eps && a.x < box.x + box.width - eps &&
    Math.max(a.y, b.y) > box.y + eps && Math.min(a.y, b.y) < box.y + box.height - eps;
  assert.ok(Math.abs(a.y - b.y) < eps, 'route segments must be orthogonal');
  return a.y > box.y + eps && a.y < box.y + box.height - eps &&
    Math.max(a.x, b.x) > box.x + eps && Math.min(a.x, b.x) < box.x + box.width - eps;
}

test('ELK routes every relation around variable-size cards, preserving fixed contract ports and gate labels', async () => {
  const engine = adapter();
  for (const direction of ['RIGHT', 'DOWN']) for (const expanded of [false, true]) {
    const input: LayoutInput = {
      direction,
      nodes: [
        ...['a', 'b', 'c', 'd', 'e', 'f', 'isolated'].map(id => ({ id, kind: 'task', width: id === 'c' && expanded ? 750 : 260, height: id === 'c' && expanded ? 450 : 150 })),
        { id: 'contract', kind: 'contract', width: 232, height: 220 },
        { id: 'source', kind: 'source', width: 220, height: 76 },
      ],
      edges: [
        ...[['a','b'],['a','c'],['a','d'],['b','e'],['c','e'],['d','e'],['a','f'],['e','f'],['source','b']].map(([from,to],i) => ({id:'edge-'+i,from:from!,to:to!})),
        { id:'contract-header',from:'contract',to:'c',portX:220,portY:38 },
        { id:'contract-section',from:'contract',to:'e',portX:220,portY:133 },
        { id:'partial',from:'c',to:'f',label:'api-ready',labelWidth:68 },
      ],
    };
    const before = JSON.stringify(input);
    const result = await engine.layout(input);
    assert.equal(JSON.stringify(input), before, 'layout must not mutate its input');
    assert.deepEqual(Object.keys(result.nodes).sort(), input.nodes.map(n => n.id).sort());
    assert.deepEqual(Object.keys(result.edges).sort(), input.edges.map(e => e.id).sort());
    const boxes: Box[] = input.nodes.map(n => ({...n,...result.nodes[n.id]!}));
    boxes.forEach((box,i) => boxes.slice(i+1).forEach(other => assert.equal(overlaps(box,other),false,box.id+' overlaps '+other.id)));
    for (const edge of input.edges) {
      const route = result.edges[edge.id]!;
      for (const points of route.sections) for (let i=1;i<points.length;i++) {
        for (const box of boxes.filter(n => n.id!==edge.from && n.id!==edge.to)) {
          assert.equal(crosses(points[i-1]!,points[i]!,box), false, edge.id+' crosses '+box.id);
        }
      }
      if (edge.portY !== undefined) {
        const start = route.sections[0]![0]!;
        assert.equal(start.x, result.nodes.contract!.x + edge.portX!);
        assert.equal(start.y, result.nodes.contract!.y + edge.portY);
      }
    }
    assert.equal(result.edges.partial!.label?.text, 'api-ready');
    assert.ok(result.group, 'disconnected node needs a separate area');
    assert.ok(result.nodes.isolated!.y >= result.group.y);
    assert.deepEqual(await engine.layout(input), result, 'fixed input produces stable placement and routing');
  }
});

test('empty and disconnected-only graphs have finite bounds without requiring any edges', async () => {
  const engine = adapter();
  for (const count of [0,1,9]) {
    const input: LayoutInput = {direction:'RIGHT',nodes:Array.from({length:count},(_,i)=>({id:'n'+i,kind:'task',width:220+i*10,height:100+i*10})),edges:[]};
    const result = await engine.layout(input);
    assert.ok(Number.isFinite(result.width) && result.width > 0);
    assert.ok(Number.isFinite(result.height) && result.height > 0);
    assert.equal(Object.keys(result.nodes).length,count);
    assert.deepEqual(result.edges,{});
    const boxes: Box[] = input.nodes.map(n => ({...n,...result.nodes[n.id]!}));
    boxes.forEach((box,i) => boxes.slice(i+1).forEach(other => assert.equal(overlaps(box,other),false)));
  }
});
