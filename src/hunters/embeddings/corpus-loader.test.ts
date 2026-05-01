import { describe, it, expect, vi } from 'vitest';
import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import { loadInjectionCorpus } from './corpus-loader.js';

function makeEmbedding(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < EMBEDDING_DIM; i++) out.push(seed * 0.001 + i * 0.0001);
  return out;
}

function makeBundle(entries: unknown[]): string {
  return JSON.stringify({
    schema_version: 2,
    generated_at: '2026-04-30T11:46:28.797Z',
    count: entries.length,
    entries,
  });
}

function makeFetch(body: string, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response) as unknown as typeof fetch;
}

describe('loadInjectionCorpus', () => {
  it('parses well-formed corpus entries with embeddings', async () => {
    const body = makeBundle([
      {
        id: 'honeypot/a',
        source: 'src',
        text: 't',
        lang: 'en',
        techniques: ['ignore-instructions'],
        embedding: makeEmbedding(1),
      },
      {
        id: 'honeypot/b',
        source: 'src',
        text: 't',
        lang: 'es',
        techniques: [],
        embedding: makeEmbedding(2),
      },
    ]);
    const entries = await loadInjectionCorpus({
      fetcher: makeFetch(body),
      url: 'data/injection-corpus.json',
    });
    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe('honeypot/a');
    expect(entries[0]!.embedding.length).toBe(EMBEDDING_DIM);
  });

  it('drops entries with null embedding', async () => {
    const body = makeBundle([
      {
        id: 'a',
        source: 'src',
        text: 't',
        lang: 'en',
        techniques: [],
        embedding: makeEmbedding(1),
      },
      { id: 'b', source: 'src', text: 't', lang: 'en', techniques: [], embedding: null },
    ]);
    const entries = await loadInjectionCorpus({
      fetcher: makeFetch(body),
      url: 'data/injection-corpus.json',
    });
    expect(entries.map((e) => e.id)).toEqual(['a']);
  });

  it('drops entries missing required fields', async () => {
    const body = makeBundle([
      { id: 'a', embedding: makeEmbedding(1) },
      {
        id: 'b',
        source: 'src',
        text: 't',
        lang: 'en',
        techniques: [],
        embedding: makeEmbedding(2),
      },
    ]);
    const entries = await loadInjectionCorpus({
      fetcher: makeFetch(body),
      url: 'data/injection-corpus.json',
    });
    expect(entries.map((e) => e.id)).toEqual(['b']);
  });

  it('returns [] when the fetch resolves with non-ok status', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as unknown as Response) as unknown as typeof fetch;
    const entries = await loadInjectionCorpus({
      fetcher,
      url: 'data/injection-corpus.json',
    });
    expect(entries).toEqual([]);
  });

  it('returns [] when JSON parsing fails', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response) as unknown as typeof fetch;
    const entries = await loadInjectionCorpus({
      fetcher,
      url: 'data/injection-corpus.json',
    });
    expect(entries).toEqual([]);
  });

  it('returns [] when the fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const entries = await loadInjectionCorpus({
      fetcher,
      url: 'data/injection-corpus.json',
    });
    expect(entries).toEqual([]);
  });

  it('returns [] when the bundle is shaped wrong (no entries array)', async () => {
    const body = JSON.stringify({ schema_version: 2 });
    const entries = await loadInjectionCorpus({
      fetcher: makeFetch(body),
      url: 'data/injection-corpus.json',
    });
    expect(entries).toEqual([]);
  });
});
