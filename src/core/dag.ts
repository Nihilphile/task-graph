/**
 * Pure DAG helpers.
 *
 * This module deliberately has no internal imports so the validator, the link
 * command and tests can all share one cycle implementation without creating an
 * import cycle.
 */

export interface DependencyEdgeSource {
  readonly id: string;
  readonly dependsOn: readonly { readonly task: string }[];
}

/** Numeric-aware task ID order (`T-0002` before `T-0010`). */
function compareTaskIds(a: string, b: string): number {
  const left = /^T-(\d+)$/.exec(a);
  const right = /^T-(\d+)$/.exec(b);
  if (left && right) return Number(left[1]) - Number(right[1]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rotates a cycle so its smallest ID comes first, giving a stable identity. */
export function canonicalCycleKey(cycle: readonly string[]): string {
  const body = cycle.slice(0, -1);
  if (body.length === 0) return '';
  let startIndex = 0;
  for (let index = 1; index < body.length; index += 1) {
    if (compareTaskIds(body[index]!, body[startIndex]!) < 0) startIndex = index;
  }
  return [...body.slice(startIndex), ...body.slice(0, startIndex)].join(' -> ');
}

/**
 * Finds every dependency cycle once.
 *
 * Each result repeats the first ID at the end, so `T-0001 -> T-0002 -> T-0001`
 * reads as a complete cycle path. Results are ordered deterministically by the
 * ID walk order, and dependencies pointing at unknown tasks are ignored (the
 * validator reports those separately).
 */
export function findDependencyCycles(
  nodes: readonly DependencyEdgeSource[],
): string[][] {
  const byId = new Map<string, DependencyEdgeSource>();
  for (const node of nodes) byId.set(node.id, node);

  const sorted = [...nodes].sort((a, b) => compareTaskIds(a.id, b.id));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    const dependencies = [...(byId.get(id)?.dependsOn ?? [])]
      .map((dependency) => dependency.task)
      .filter((task) => byId.has(task))
      .sort(compareTaskIds);
    for (const dependency of dependencies) {
      const dependencyState = state.get(dependency) ?? 0;
      if (dependencyState === 1) {
        const startIndex = stack.indexOf(dependency);
        const cycle = [...stack.slice(startIndex), dependency];
        const key = canonicalCycleKey(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (dependencyState === 0) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const node of sorted) {
    if ((state.get(node.id) ?? 0) === 0) visit(node.id);
  }
  return cycles;
}

/** First dependency cycle in deterministic order, or `undefined`. */
export function findDependencyCycle(
  nodes: readonly DependencyEdgeSource[],
): string[] | undefined {
  return findDependencyCycles(nodes)[0];
}

/** `T-0001 -> T-0002 -> T-0001` rendering used in error messages and history. */
export function formatCyclePath(cycle: readonly string[]): string {
  return cycle.join(' -> ');
}
