import { describe, it, expect } from 'vitest';
import type { GraphData } from './types.js';

describe('sync pipeline (smoke)', () => {
  it('exports a run() function that returns GraphData', async () => {
    const mod = await import('./sync.js');
    expect(typeof mod.run).toBe('function');
    const data: GraphData = await mod.run({
      ghNodes: [],
      overlayText: '',
      now: () => '2026-04-20T00:00:00Z',
    });
    expect(data.syncedAt).toBe('2026-04-20T00:00:00Z');
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });
});
