import { describe, it, expect } from 'vitest';
import {
  embedCorpus,
  roundVector,
  EMBEDDING_DIM,
  type Corpus,
  type EmbedFn,
} from '../embed-injection-corpus.js';

function makeCorpus(entries: number, seed = 0): Corpus {
  return {
    schema_version: 1,
    generated_at: '2026-04-30T11:46:28.797Z',
    count: entries,
    entries: Array.from({ length: entries }, (_, i) => ({
      id: `test/entry-${i + seed}`,
      source: 'test',
      text: `payload ${i + seed}`,
      lang: (['en', 'es', 'zh-CN'] as const)[i % 3]!,
      techniques: ['t'],
      embedding: null,
    })),
  };
}

function unitVector(dim: number, seed: number): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = Math.sin((seed + 1) * (i + 1));
  let sumSq = 0;
  for (const v of arr) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / norm;
  return arr;
}

function makeEmbedFn(): EmbedFn {
  return async (texts) => texts.map((_, i) => unitVector(EMBEDDING_DIM, i));
}

describe('embed-injection-corpus', () => {
  it('roundVector clips to N decimal places', () => {
    const arr = new Float32Array([0.123456789, 0.987654321]);
    const out = roundVector(arr, 6);
    expect(out).toEqual([0.123457, 0.987654]);
  });

  it('roundVector zero precision rounds to integers', () => {
    expect(roundVector([1.7, 2.4, -3.6], 0)).toEqual([2, 2, -4]);
  });

  it('embedCorpus populates every entry with a vector of length EMBEDDING_DIM', async () => {
    const corpus = makeCorpus(5);
    const next = await embedCorpus(corpus, makeEmbedFn());
    expect(next.entries).toHaveLength(5);
    for (const e of next.entries) {
      expect(Array.isArray(e.embedding)).toBe(true);
      expect((e.embedding as number[]).length).toBe(EMBEDDING_DIM);
    }
  });

  it('embedCorpus preserves entry order, ids, and metadata', async () => {
    const corpus = makeCorpus(4);
    const next = await embedCorpus(corpus, makeEmbedFn());
    expect(next.entries.map((e) => e.id)).toEqual([
      'test/entry-0',
      'test/entry-1',
      'test/entry-2',
      'test/entry-3',
    ]);
    expect(next.entries.map((e) => e.text)).toEqual([
      'payload 0',
      'payload 1',
      'payload 2',
      'payload 3',
    ]);
    expect(next.entries.map((e) => e.lang)).toEqual(['en', 'es', 'zh-CN', 'en']);
  });

  it('embedCorpus bumps schema_version 1 → 2', async () => {
    const corpus = makeCorpus(2);
    const next = await embedCorpus(corpus, makeEmbedFn());
    expect(corpus.schema_version).toBe(1);
    expect(next.schema_version).toBe(2);
  });

  it('embedCorpus preserves generated_at (corpus identity stays Stage 1)', async () => {
    const corpus = makeCorpus(2);
    const next = await embedCorpus(corpus, makeEmbedFn());
    expect(next.generated_at).toBe(corpus.generated_at);
  });

  it('embedCorpus chunks input into batches of batchSize', async () => {
    let calls = 0;
    let observedBatches: number[] = [];
    const embedFn: EmbedFn = async (texts) => {
      calls++;
      observedBatches.push(texts.length);
      return texts.map((_, i) => unitVector(EMBEDDING_DIM, i));
    };
    const corpus = makeCorpus(20);
    await embedCorpus(corpus, embedFn, { batchSize: 8 });
    expect(calls).toBe(3);
    expect(observedBatches).toEqual([8, 8, 4]);
  });

  it('embedCorpus passes `passage:` prefix to embedFn', async () => {
    let receivedTexts: string[] = [];
    const embedFn: EmbedFn = async (texts) => {
      receivedTexts.push(...texts);
      return texts.map((_, i) => unitVector(EMBEDDING_DIM, i));
    };
    const corpus = makeCorpus(3);
    await embedCorpus(corpus, embedFn);
    expect(receivedTexts).toEqual(['passage: payload 0', 'passage: payload 1', 'passage: payload 2']);
  });

  it('embedCorpus rejects when embedFn returns wrong-dim vectors', async () => {
    const badFn: EmbedFn = async (texts) => texts.map(() => new Float32Array(10));
    const corpus = makeCorpus(2);
    await expect(embedCorpus(corpus, badFn)).rejects.toThrow(/length 10.*expected 384/);
  });

  it('embedCorpus rejects when embedFn returns mismatched batch size', async () => {
    const badFn: EmbedFn = async () => [unitVector(EMBEDDING_DIM, 0)]; // returns 1 regardless
    const corpus = makeCorpus(3);
    await expect(embedCorpus(corpus, badFn, { batchSize: 3 })).rejects.toThrow(/returned 1.*batch of 3/);
  });

  it('embedCorpus on empty corpus returns empty entries with bumped schema', async () => {
    const corpus: Corpus = {
      schema_version: 1,
      generated_at: '2026-04-30T11:46:28.797Z',
      count: 0,
      entries: [],
    };
    let calls = 0;
    const embedFn: EmbedFn = async (texts) => {
      calls++;
      return texts.map((_, i) => unitVector(EMBEDDING_DIM, i));
    };
    const next = await embedCorpus(corpus, embedFn);
    expect(next.entries).toEqual([]);
    expect(next.count).toBe(0);
    expect(next.schema_version).toBe(2);
    expect(calls).toBe(0);
  });

  it('embedCorpus respects custom precision', async () => {
    const fn: EmbedFn = async (texts) => texts.map(() => new Float32Array([0.123456789]).slice());
    // Use a 1-dim corpus + 1-dim embedFn override via the `dim` option.
    const corpus = makeCorpus(1);
    const next = await embedCorpus(corpus, fn, { dim: 1, precision: 3 });
    expect((next.entries[0]!.embedding as number[])[0]).toBe(0.123);
  });

  it('embedCorpus preserves L2-normalised property within rounding tolerance', async () => {
    const corpus = makeCorpus(1);
    const next = await embedCorpus(corpus, makeEmbedFn(), { precision: 6 });
    const v = next.entries[0]!.embedding as number[];
    let sumSq = 0;
    for (const x of v) sumSq += x * x;
    expect(Math.sqrt(sumSq)).toBeGreaterThan(0.999);
    expect(Math.sqrt(sumSq)).toBeLessThan(1.001);
  });
});
