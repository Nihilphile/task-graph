import path from 'node:path';
import { initializeProject } from '../../src/core/init.js';
import { addGraph } from '../../src/core/graphs.js';
import { addTask } from '../../src/core/taskops.js';
import { linkTask } from '../../src/core/deps.js';
import { exposeCompletionPoint, setCompletionRequires } from '../../src/core/composites.js';
import { claimTask } from '../../src/core/claims.js';
import { addManualBlocker } from '../../src/core/blockers.js';
import { cancelTask, completeTask, startTask } from '../../src/core/lifecycle.js';
import { registerSource } from '../../src/core/sources.js';
import { buildProject } from '../../src/core/build.js';
import type { TempWorkspace } from './temp.js';

/** Frozen timestamp so every generated artifact stays deterministic. */
export const FIXTURE_AT = '2026-09-21T10:00:00+08:00';

export interface ViewerFixture {
  readonly workspace: TempWorkspace;
  /** Absolute path of the generated self-contained viewer. */
  readonly indexFile: string;
  readonly entryGraphs: readonly [string, string];
  /** Child graph of the root composite task. */
  readonly childGraph: string;
  /** Grandchild graph, so the fixture has a two-level subgraph hierarchy. */
  readonly grandchildGraph: string;
  readonly ids: {
    /** Root composite task in G-001; owns G-002 and exposes "api-ready". */
    readonly composite: string;
    /** Composite task in G-002; owns G-003 and derives from PRD-001. */
    readonly childComposite: string;
    /** Done leaf in G-003, the completion target of the child composite. */
    readonly leaf: string;
    /** Running task in G-001 with a claim and a satisfied partial dependency. */
    readonly partialSuccessor: string;
    /** Blocked task in G-001 (manual blocker). */
    readonly blocked: string;
    /** Ready task in G-001. */
    readonly ready: string;
    /** Cancelled task in G-001. */
    readonly cancelled: string;
    /** Blocked convergence task in G-001 depending on blocked + ready. */
    readonly convergence: string;
    /** Finished task in G-001. */
    readonly done: string;
  };
  readonly sourceId: string;
  readonly gateName: string;
}

/**
 * Builds one project that exercises every viewer feature: two entry graphs, a
 * two-level subgraph hierarchy, full and partial dependencies, a PRD source,
 * claims, manual blockers and every visual task state.
 */
export function buildViewerFixture(workspace: TempWorkspace): ViewerFixture {
  const root = workspace.root;
  const now = (): Date => new Date(FIXTURE_AT);

  initializeProject(root, { name: '查看器项目', task: '交付登录能力' }); // G-001, T-0001
  registerSource(root, { id: 'PRD-001', file: 'docs/prd-login.md', confirmedAt: FIXTURE_AT });

  const childGraph = addGraph(root, { title: '登录子图', parentTask: 'T-0001' }).graph.id; // G-002
  const childComposite = addTask(root, {
    graph: childGraph,
    title: '完成登录接口',
    derivedFrom: ['PRD-001'],
    now,
  }).id; // T-0002
  const grandchildGraph = addGraph(root, {
    title: '接口联调',
    parentTask: childComposite,
  }).graph.id; // G-003
  const leaf = addTask(root, { graph: grandchildGraph, title: '联调接口', now }).id; // T-0003
  const secondEntry = addGraph(root, { title: '官网发布', entry: true }).graph.id; // G-004

  setCompletionRequires(root, { task: childComposite, requires: [leaf] });
  setCompletionRequires(root, { task: 'T-0001', requires: [childComposite] });
  exposeCompletionPoint(root, { task: 'T-0001', name: 'api-ready', requires: [childComposite] });

  const partialSuccessor = addTask(root, { graph: 'G-001', title: '接入前端', now }).id; // T-0004
  linkTask(root, { successor: partialSuccessor, predecessor: 'T-0001', gate: 'api-ready' });
  const blocked = addTask(root, { graph: 'G-001', title: '接入支付', now }).id; // T-0005
  addManualBlocker(root, { id: blocked, reason: '等待设计稿' });
  const ready = addTask(root, { graph: 'G-001', title: '编写发布说明', now }).id; // T-0006
  const cancelled = addTask(root, { graph: 'G-001', title: '废弃旧入口', now }).id; // T-0007
  const convergence = addTask(root, { graph: 'G-001', title: '上线评审', now }).id; // T-0008
  linkTask(root, { successor: convergence, predecessor: blocked });
  linkTask(root, { successor: convergence, predecessor: ready });
  const done = addTask(root, { graph: 'G-001', title: '搭建仓库', now }).id; // T-0009

  // Status variety: the leaf and the child composite finish, the successor runs,
  // one task is cancelled and one is finished.
  completeTask(root, { id: startTask(root, { id: leaf, now }).id, now });
  completeTask(root, { id: startTask(root, { id: childComposite, now }).id, now });
  startTask(root, { id: partialSuccessor, now });
  claimTask(root, {
    id: partialSuccessor,
    role: 'implementer',
    sessionId: 'thread-1',
    now,
  });
  cancelTask(root, { id: cancelled, now });
  completeTask(root, { id: startTask(root, { id: done, now }).id, now });

  buildProject(root);

  return {
    workspace,
    indexFile: path.join(root, '.task-graph', 'generated', 'index.html'),
    entryGraphs: ['G-001', secondEntry],
    childGraph,
    grandchildGraph,
    ids: {
      composite: 'T-0001',
      childComposite,
      leaf,
      partialSuccessor,
      blocked,
      ready,
      cancelled,
      convergence,
      done,
    },
    sourceId: 'PRD-001',
    gateName: 'api-ready',
  };
}
