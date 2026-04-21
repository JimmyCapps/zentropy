import type { GhNode, OverlayClusterBlock } from './types.js';

const KNOWN_LABEL_CLUSTERS: ReadonlySet<string> = new Set([
  'project-honeyllm',
  'project-determillm',
  'phase-3',
  'phase-4',
  'phase-5',
  'phase-6+',
  'phase-8-candidate',
  'upstream',
  'future-feature',
]);

export interface ClusterAssignment {
  readonly perNode: ReadonlyMap<number, ReadonlyArray<string>>;
  readonly all: ReadonlyArray<string>;
}

export function assignClusters(
  nodes: ReadonlyArray<GhNode>,
  overlayClusters: ReadonlyArray<OverlayClusterBlock>,
): ClusterAssignment {
  const perNode = new Map<number, string[]>();
  const all = new Set<string>();

  for (const node of nodes) {
    const list: string[] = [];
    for (const label of node.labels) {
      if (KNOWN_LABEL_CLUSTERS.has(label.name)) {
        list.push(label.name);
        all.add(label.name);
      }
    }
    perNode.set(node.number, list);
  }

  for (const block of overlayClusters) {
    all.add(block.cluster);
    for (const member of block.members) {
      const list = perNode.get(member) ?? [];
      if (!list.includes(block.cluster)) {
        list.push(block.cluster);
      }
      perNode.set(member, list);
    }
  }

  return { perNode, all: [...all].sort() };
}
