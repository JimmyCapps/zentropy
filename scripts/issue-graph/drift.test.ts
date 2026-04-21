import { describe, it, expect } from 'vitest';
import { detectDrift } from './drift.js';
import type { GhNode, OverlayBlock } from './types.js';

function openIssue(n: number, labels: string[] = []): GhNode {
  return {
    kind: 'issue', number: n, title: `#${n}`, body: '', state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}
function closedIssue(n: number): GhNode {
  return { ...openIssue(n), state: 'closed' };
}

describe('detectDrift', () => {
  it('flags overlay references to closed issues', () => {
    const nodes = [closedIssue(99)];
    const blocks: OverlayBlock[] = [
      { kind: 'cluster', cluster: 'x', members: [99] },
    ];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => d.issue === 99 && /closed/i.test(d.message))).toBe(true);
  });

  it('flags overlay references to missing issues', () => {
    const nodes: GhNode[] = [];
    const blocks: OverlayBlock[] = [
      { kind: 'edge', edge: 'depends-on', from: 42, to: 43 },
    ];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => /42/.test(d.message))).toBe(true);
    expect(drift.some((d) => /43/.test(d.message))).toBe(true);
  });

  it('flags stale in-progress older than 72h', () => {
    const nodes = [openIssue(1)];
    const blocks: OverlayBlock[] = [{
      kind: 'status', status: 'in-progress', issue: 1,
      started: '2026-04-15T00:00:00Z',
    }];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => /stale/i.test(d.message) && d.issue === 1)).toBe(true);
  });

  it('does NOT flag fresh in-progress', () => {
    const nodes = [openIssue(1)];
    const blocks: OverlayBlock[] = [{
      kind: 'status', status: 'in-progress', issue: 1,
      started: '2026-04-20T00:00:00Z',
    }];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T01:00:00Z'));
    expect(drift.filter((d) => /stale/i.test(d.message))).toEqual([]);
  });

  it('flags open clustered issues missing from overlay', () => {
    const nodes = [openIssue(75, ['project-honeyllm', 'phase-6+'])];
    const drift = detectDrift(nodes, [], new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => d.issue === 75 && /overlay/i.test(d.message))).toBe(true);
  });
});
