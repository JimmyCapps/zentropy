export type IssueState = 'open' | 'closed';
export type PrState = 'open' | 'closed' | 'merged' | 'draft';

export interface GhLabel {
  name: string;
  description?: string;
  color?: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: ReadonlyArray<GhLabel>;
  updatedAt: string;
  kind: 'issue';
}

export interface GhPr {
  number: number;
  title: string;
  body: string;
  state: PrState;
  labels: ReadonlyArray<GhLabel>;
  updatedAt: string;
  kind: 'pr';
}

export type GhNode = GhIssue | GhPr;

export type EdgeType =
  | 'references'
  | 'blocks'
  | 'depends-on'
  | 'competes-with'
  | 'same-signal'
  | 'supersedes';

export interface Edge {
  readonly type: EdgeType;
  readonly from: number;
  readonly to: number;
  readonly note?: string;
}

export type OverlayStatus =
  | 'in-progress'
  | 'touched'
  | 'unblocks'
  | 'superseded-by';

export interface OverlayStatusBlock {
  readonly kind: 'status';
  readonly status: OverlayStatus;
  readonly issue: number;
  readonly started?: string;
  readonly completed?: string;
  readonly target?: number;
  readonly note?: string;
}

export interface OverlayClusterBlock {
  readonly kind: 'cluster';
  readonly cluster: string;
  readonly members: ReadonlyArray<number>;
  readonly note?: string;
}

export interface OverlayEdgeBlock {
  readonly kind: 'edge';
  readonly edge: EdgeType;
  readonly from: number;
  readonly to: number;
  readonly note?: string;
}

export type OverlayBlock =
  | OverlayStatusBlock
  | OverlayClusterBlock
  | OverlayEdgeBlock;

export interface Overlay {
  readonly blocks: ReadonlyArray<OverlayBlock>;
  readonly proseHeader: string;
}

export interface Node {
  readonly number: number;
  readonly kind: 'issue' | 'pr';
  readonly title: string;
  readonly state: IssueState | PrState;
  readonly clusters: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<string>;
  readonly overlayStatus?: OverlayStatusBlock;
}

export interface DriftEntry {
  readonly severity: 'warn' | 'error';
  readonly message: string;
  readonly issue?: number;
  readonly cluster?: string;
}

export interface GraphData {
  readonly syncedAt: string;
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly clusters: ReadonlyArray<string>;
  readonly drift: ReadonlyArray<DriftEntry>;
}
