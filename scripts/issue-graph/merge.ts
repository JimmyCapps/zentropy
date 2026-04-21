import type {
  GhNode, OverlayBlock, GraphData, Node, Edge,
  OverlayClusterBlock, OverlayEdgeBlock, OverlayStatusBlock,
} from './types.js';
import { extractReferenceEdges } from './edge-extract.js';
import { assignClusters } from './cluster-assign.js';
import { detectDrift } from './drift.js';

export interface MergeInput {
  readonly ghNodes: ReadonlyArray<GhNode>;
  readonly overlayBlocks: ReadonlyArray<OverlayBlock>;
  readonly syncedAt: string;
  readonly now: Date;
}

export function mergeGraph(input: MergeInput): GraphData {
  const clusterBlocks = input.overlayBlocks.filter(
    (b): b is OverlayClusterBlock => b.kind === 'cluster',
  );
  const edgeBlocks = input.overlayBlocks.filter(
    (b): b is OverlayEdgeBlock => b.kind === 'edge',
  );
  const statusBlocks = input.overlayBlocks.filter(
    (b): b is OverlayStatusBlock => b.kind === 'status',
  );

  const { perNode, all: allClusters } = assignClusters(input.ghNodes, clusterBlocks);
  const statusByIssue = new Map<number, OverlayStatusBlock>();
  for (const s of statusBlocks) statusByIssue.set(s.issue, s);

  const nodes: Node[] = input.ghNodes.map((gh) => ({
    number: gh.number,
    kind: gh.kind,
    title: gh.title,
    state: gh.state,
    labels: gh.labels.map((l) => l.name),
    clusters: perNode.get(gh.number) ?? [],
    overlayStatus: statusByIssue.get(gh.number),
  }));

  const referenceEdges = extractReferenceEdges(input.ghNodes);
  const overlayEdges: Edge[] = edgeBlocks.map((b) => ({
    type: b.edge, from: b.from, to: b.to, note: b.note,
  }));

  const drift = detectDrift(input.ghNodes, input.overlayBlocks, input.now);

  return {
    syncedAt: input.syncedAt,
    nodes,
    edges: [...overlayEdges, ...referenceEdges],
    clusters: allClusters,
    drift,
  };
}
