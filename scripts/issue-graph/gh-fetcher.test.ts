import { describe, it, expect } from 'vitest';
import { fetchGhNodes } from './gh-fetcher.js';

describe('fetchGhNodes', () => {
  it('calls gh issue list + pr list and combines results', async () => {
    const calls: string[] = [];
    const fakeRun = async (cmd: string, args: string[]): Promise<string> => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('issue')) {
        return JSON.stringify([{
          number: 75, title: 'dialect packs', body: 'See #52.',
          state: 'OPEN', labels: [{ name: 'project-honeyllm' }],
          updatedAt: '2026-04-20T00:00:00Z',
        }]);
      }
      return JSON.stringify([{
        number: 80, title: 'Spider PR', body: '', state: 'MERGED',
        labels: [], updatedAt: '2026-04-20T00:00:00Z',
      }]);
    };

    const nodes = await fetchGhNodes({ run: fakeRun });
    expect(nodes).toHaveLength(2);
    const issue = nodes.find((n) => n.number === 75);
    expect(issue?.kind).toBe('issue');
    expect(issue?.state).toBe('open');
    const pr = nodes.find((n) => n.number === 80);
    expect(pr?.kind).toBe('pr');
    expect(pr?.state).toBe('merged');
    expect(calls).toHaveLength(2);
  });

  it('throws a friendly error when gh is not found', async () => {
    const fakeRun = async (): Promise<string> => {
      throw Object.assign(new Error('gh ENOENT'), { code: 'ENOENT' });
    };
    await expect(fetchGhNodes({ run: fakeRun })).rejects.toThrow(/gh CLI/);
  });
});
