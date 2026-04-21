import { describe, it, expect } from 'vitest';
import { assignClusters } from './cluster-assign.js';
import type { GhNode, OverlayClusterBlock } from './types.js';

function issue(number: number, labels: string[]): GhNode {
  return {
    kind: 'issue', number, title: `#${number}`, body: '',
    state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('assignClusters', () => {
  it('assigns clusters from known labels', () => {
    const nodes = [issue(75, ['project-honeyllm', 'phase-6+'])];
    const { perNode, all } = assignClusters(nodes, []);
    expect(perNode.get(75)).toEqual(['project-honeyllm', 'phase-6+']);
    expect(all).toContain('project-honeyllm');
    expect(all).toContain('phase-6+');
  });

  it('ignores unknown labels', () => {
    const nodes = [issue(1, ['bug', 'project-honeyllm'])];
    const { perNode } = assignClusters(nodes, []);
    expect(perNode.get(1)).toEqual(['project-honeyllm']);
  });

  it('adds overlay clusters to their members', () => {
    const nodes = [issue(3, []), issue(75, []), issue(80, [])];
    const overlay: OverlayClusterBlock[] = [{
      kind: 'cluster',
      cluster: 'hunters',
      members: [3, 75, 80],
    }];
    const { perNode, all } = assignClusters(nodes, overlay);
    expect(perNode.get(3)).toContain('hunters');
    expect(perNode.get(75)).toContain('hunters');
    expect(perNode.get(80)).toContain('hunters');
    expect(all).toContain('hunters');
  });

  it('dedupes when a node appears in overlay and label', () => {
    const nodes = [issue(75, ['project-honeyllm'])];
    const overlay: OverlayClusterBlock[] = [{
      kind: 'cluster', cluster: 'project-honeyllm', members: [75],
    }];
    const { perNode } = assignClusters(nodes, overlay);
    expect(perNode.get(75)).toEqual(['project-honeyllm']);
  });
});
