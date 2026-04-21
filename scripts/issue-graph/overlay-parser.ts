import type {
  Overlay,
  OverlayBlock,
  OverlayClusterBlock,
  OverlayEdgeBlock,
  OverlayStatusBlock,
  EdgeType,
  OverlayStatus,
} from './types.js';

const FENCE_RE = /```issue-graph\n([\s\S]*?)```/g;

const EDGE_TYPES: ReadonlyArray<EdgeType> = [
  'references', 'blocks', 'depends-on', 'competes-with', 'same-signal', 'supersedes',
];
const STATUS_TYPES: ReadonlyArray<OverlayStatus> = [
  'in-progress', 'touched', 'unblocks', 'superseded-by',
];

function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) throw new Error(`overlay: expected "key: value", got "${trimmed}"`);
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseMembers(raw: string): ReadonlyArray<number> {
  const match = raw.match(/^\[(.*)\]$/);
  if (!match) throw new Error(`overlay: members must be [a, b, c], got "${raw}"`);
  if (!match[1].trim()) return [];
  const parts = match[1].split(',').map((s) => s.trim());
  const nums = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n)) throw new Error(`overlay: members contained non-integer "${p}"`);
    return n;
  });
  return nums;
}

function parseBlock(body: string): OverlayBlock {
  const kv = parseKv(body);
  if ('cluster' in kv) {
    const block: OverlayClusterBlock = {
      kind: 'cluster',
      cluster: kv.cluster,
      members: parseMembers(kv.members ?? '[]'),
      note: kv.note,
    };
    return block;
  }
  if ('edge' in kv) {
    if (!EDGE_TYPES.includes(kv.edge as EdgeType)) {
      throw new Error(`overlay: unknown edge type "${kv.edge}"`);
    }
    const block: OverlayEdgeBlock = {
      kind: 'edge',
      edge: kv.edge as EdgeType,
      from: Number(kv.from),
      to: Number(kv.to),
      note: kv.note,
    };
    return block;
  }
  if ('status' in kv) {
    if (!STATUS_TYPES.includes(kv.status as OverlayStatus)) {
      throw new Error(`overlay: unknown status "${kv.status}"`);
    }
    const block: OverlayStatusBlock = {
      kind: 'status',
      status: kv.status as OverlayStatus,
      issue: Number(kv.issue),
      started: kv.started,
      completed: kv.completed,
      target: kv.target ? Number(kv.target) : undefined,
      note: kv.note,
    };
    return block;
  }
  throw new Error(`overlay: block has none of cluster/edge/status keys — body:\n${body}`);
}

export function parseOverlay(text: string): Overlay {
  const blocks: OverlayBlock[] = [];
  let firstFenceAt = text.length;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index < firstFenceAt) firstFenceAt = match.index;
    blocks.push(parseBlock(match[1]));
  }
  const proseHeader = text.slice(0, firstFenceAt).trim();
  return { blocks, proseHeader };
}
