import { describe, it, expect } from 'vitest';
import { mergeGraph } from './merge.js';
import type { GhNode, OverlayBlock } from './types.js';

function openIssue(n: number, labels: string[], body = ''): GhNode {
  return {
    kind: 'issue', number: n, title: `#${n}`, body, state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('mergeGraph', () => {
  it('produces nodes with clusters, labels, and overlay status', () => {
    const nodes: GhNode[] = [
      openIssue(75, ['project-honeyllm'], 'Blocked by #52.'),
      openIssue(52, ['project-honeyllm'], ''),
    ];
    const blocks: OverlayBlock[] = [
      { kind: 'cluster', cluster: 'hunters', members: [75, 52] },
      { kind: 'edge', edge: 'depends-on', from: 75, to: 52 },
      { kind: 'status', status: 'in-progress', issue: 75, started: '2026-04-20T00:00:00Z' },
    ];
    const data = mergeGraph({
      ghNodes: nodes,
      overlayBlocks: blocks,
      syncedAt: '2026-04-20T01:00:00Z',
      now: new Date('2026-04-20T01:00:00Z'),
    });

    expect(data.syncedAt).toBe('2026-04-20T01:00:00Z');
    expect(data.nodes.find((n) => n.number === 75)?.clusters).toContain('hunters');
    expect(data.nodes.find((n) => n.number === 75)?.overlayStatus?.status).toBe('in-progress');

    const edgeTypes = data.edges.map((e) => e.type).sort();
    expect(edgeTypes).toEqual(['depends-on', 'references'].sort());
  });

  it('includes drift entries', () => {
    const data = mergeGraph({
      ghNodes: [],
      overlayBlocks: [{ kind: 'cluster', cluster: 'x', members: [999] }],
      syncedAt: '2026-04-20T00:00:00Z',
      now: new Date('2026-04-20T00:00:00Z'),
    });
    expect(data.drift.some((d) => d.issue === 999)).toBe(true);
  });
});
