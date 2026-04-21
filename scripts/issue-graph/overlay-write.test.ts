import { describe, it, expect } from 'vitest';
import { upsertStatusBlock, removeStatusBlock, regenerateProseHeader } from './overlay-write.js';

const EMPTY = '# Issue graph overlay\n\n<!-- blocks below -->\n';

describe('upsertStatusBlock', () => {
  it('adds a new status block when none exists', () => {
    const out = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z', note: 'branch x',
    });
    expect(out).toContain('```issue-graph');
    expect(out).toContain('status: in-progress');
    expect(out).toContain('issue: 75');
  });

  it('replaces an existing status block for the same issue', () => {
    const withBlock = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    const updated = upsertStatusBlock(withBlock, {
      kind: 'status', status: 'touched', issue: 75,
      completed: '2026-04-20T05:00:00Z', note: 'done',
    });
    const occurrences = (updated.match(/issue: 75/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(updated).toContain('status: touched');
    expect(updated).not.toContain('status: in-progress');
  });

  it('leaves non-status blocks intact', () => {
    const withCluster = EMPTY + '\n```issue-graph\ncluster: hunters\nmembers: [3, 75]\n```\n';
    const out = upsertStatusBlock(withCluster, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    expect(out).toContain('cluster: hunters');
  });

  it('does not corrupt sibling status blocks for other issues', () => {
    const withFirst = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z', note: 'first',
    });
    const withTwo = upsertStatusBlock(withFirst, {
      kind: 'status', status: 'in-progress', issue: 80,
      started: '2026-04-20T01:00:00Z', note: 'second',
    });
    // Now update only #75 — #80 must remain.
    const updated = upsertStatusBlock(withTwo, {
      kind: 'status', status: 'touched', issue: 75,
      completed: '2026-04-20T02:00:00Z', note: 'first',
    });
    expect(updated).toContain('issue: 75');
    expect(updated).toContain('status: touched');
    expect(updated).toContain('issue: 80');
    expect(updated).toContain('first');
    expect(updated).toContain('second');
    // Replacing #75 must not duplicate #75
    const occurrences75 = (updated.match(/issue: 75/g) ?? []).length;
    expect(occurrences75).toBe(1);
  });

  it('renders the target field for unblocks status', () => {
    const out = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'unblocks', issue: 75,
      target: 52, completed: '2026-04-20T00:00:00Z',
    });
    expect(out).toContain('status: unblocks');
    expect(out).toContain('issue: 75');
    expect(out).toContain('target: 52');
  });
});

describe('removeStatusBlock', () => {
  it('removes the status block for a given issue', () => {
    const withBlock = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    const out = removeStatusBlock(withBlock, 75);
    expect(out).not.toContain('issue: 75');
  });

  it('is a no-op when the issue has no status block', () => {
    const out = removeStatusBlock(EMPTY, 999);
    expect(out).toBe(EMPTY);
  });
});

describe('regenerateProseHeader', () => {
  it('replaces the header with a generated snapshot', () => {
    const src = '# Old header\nOld prose.\n\n```issue-graph\ncluster: x\nmembers: [1]\n```\n';
    const out = regenerateProseHeader(src, {
      updatedAt: '2026-04-20T00:00:00Z',
      inProgress: [{ issue: 1, note: 'demo' }],
      clusters: ['x'],
    });
    expect(out).toContain('Last synced: 2026-04-20');
    expect(out).toContain('In progress');
    expect(out).toContain('#1');
    expect(out).toContain('cluster: x');
    expect(out).not.toContain('Old prose');
  });
});
