import { describe, it, expect } from 'vitest';
import { extractReferenceEdges } from './edge-extract.js';
import type { GhNode } from './types.js';

function issue(number: number, body: string): GhNode {
  return {
    kind: 'issue', number, title: `#${number}`, body,
    state: 'open', labels: [], updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('extractReferenceEdges', () => {
  it('finds plain #N references', () => {
    const nodes: GhNode[] = [issue(10, 'See #20 and #30 for context.')];
    const edges = extractReferenceEdges(nodes);
    expect(edges).toEqual([
      { type: 'references', from: 10, to: 20 },
      { type: 'references', from: 10, to: 30 },
    ]);
  });

  it('ignores code blocks', () => {
    const body = 'Text\n```\nnot a ref: #99\n```\n';
    const edges = extractReferenceEdges([issue(1, body)]);
    expect(edges).toEqual([]);
  });

  it('ignores self-references', () => {
    const edges = extractReferenceEdges([issue(7, 'This is #7 itself.')]);
    expect(edges).toEqual([]);
  });

  it('dedupes references to the same issue', () => {
    const edges = extractReferenceEdges([issue(1, 'See #2. Also #2. And #2.')]);
    expect(edges).toEqual([{ type: 'references', from: 1, to: 2 }]);
  });

  it('ignores markdown headings (# Heading) but keeps real refs', () => {
    const body = '# Heading\n## Another\nReal ref: #5.';
    const edges = extractReferenceEdges([issue(1, body)]);
    expect(edges).toEqual([{ type: 'references', from: 1, to: 5 }]);
  });
});
