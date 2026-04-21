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

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('sync.run end-to-end', () => {
  it('writes data.json and updates the overlay prose', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'graph-'));
    const dataPath = join(dir, 'data.json');
    const overlayPath = join(dir, 'overlay.md');
    await fs.writeFile(overlayPath,
      '# Issue graph overlay\n\n<!-- blocks below -->\n\n' +
      '```issue-graph\ncluster: hunters\nmembers: [75]\n```\n');

    const fakeRun = async (_cmd: string, args: string[]): Promise<string> => {
      if (args.includes('issue')) return JSON.stringify([{
        number: 75, title: 'dialect', body: '', state: 'OPEN',
        labels: [{ name: 'project-honeyllm' }],
        updatedAt: '2026-04-20T00:00:00Z',
      }]);
      return JSON.stringify([]);
    };

    const mod = await import('./sync.js');
    const data = await mod.run({
      overlayPath,
      dataPath,
      run: fakeRun,
      now: () => new Date('2026-04-20T01:00:00Z'),
    });

    expect(data.syncedAt).toBe('2026-04-20T01:00:00Z');
    const written = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    expect(written.nodes).toHaveLength(1);
    const overlay = await fs.readFile(overlayPath, 'utf8');
    expect(overlay).toContain('Last synced: 2026-04-20');
    expect(overlay).toContain('cluster: hunters');
  });
});
