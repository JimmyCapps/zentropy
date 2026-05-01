import { describe, it, expect, vi } from 'vitest';
import { SCORE_INSTRUCTION_DETECTION } from '@/shared/constants.js';
import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import type { CorpusEntry } from './types.js';
import { createVectorIndex } from './vector-index.js';
import { createEmbeddingsHunter, embeddingsHunter } from './index.js';

function unitVector(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const x = Math.sin(seed * 7919 + i * 31);
    v[i] = x;
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = v[i]! / norm;
  return v;
}

function entry(id: string, embedding: Float32Array, lang = 'en'): CorpusEntry {
  return {
    id,
    source: 'test-fixture',
    text: `payload ${id}`,
    lang,
    techniques: ['ignore-instructions'],
    embedding: Array.from(embedding),
  };
}

describe('embeddingsHunter (no-op default)', () => {
  it('returns a clean result when neither embedFn nor index are wired', async () => {
    const result = await embeddingsHunter.scan('any text');
    expect(result).toEqual({
      hunterName: 'embeddings',
      matched: false,
      flags: [],
      score: 0,
      confidence: 0,
      features: [],
      errorMessage: null,
    });
  });

  it('is named "embeddings" so the hunt-runner / tier-router can attribute results', () => {
    expect(embeddingsHunter.name).toBe('embeddings');
  });
});

describe('createEmbeddingsHunter — degenerate dependencies', () => {
  it('returns clean when index is null', async () => {
    const hunter = createEmbeddingsHunter({ embedFn: async () => unitVector(1), index: null });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(false);
    expect(result.errorMessage).toBeNull();
  });

  it('returns clean when embedFn is null', async () => {
    const a = unitVector(1);
    const index = createVectorIndex([entry('a', a)]);
    const hunter = createEmbeddingsHunter({ embedFn: null, index });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(false);
  });

  it('returns clean when embedFn returns null (model load / inference failure)', async () => {
    const a = unitVector(1);
    const index = createVectorIndex([entry('a', a)]);
    const hunter = createEmbeddingsHunter({ embedFn: async () => null, index });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(false);
    expect(result.errorMessage).toBeNull();
  });
});

describe('createEmbeddingsHunter — match path', () => {
  it('flags a chunk whose embedding hits a corpus entry above threshold', async () => {
    const a = unitVector(1);
    const index = createVectorIndex([
      entry('honeypot/foo', a, 'en'),
      entry('honeypot/bar', unitVector(2), 'es'),
    ]);
    const hunter = createEmbeddingsHunter({ embedFn: async () => a, index });
    const result = await hunter.scan('ignore previous instructions');

    expect(result.matched).toBe(true);
    expect(result.score).toBe(SCORE_INSTRUCTION_DETECTION);
    expect(result.confidence).toBeGreaterThan(0.999);
    expect(result.flags).toContain('embeddings:honeypot/foo');
    expect(result.flags).toContain('lang:en');
    expect(result.errorMessage).toBeNull();
  });

  it('emits feature activations for top-k matches', async () => {
    const a = unitVector(1);
    const index = createVectorIndex([entry('honeypot/foo', a)]);
    const hunter = createEmbeddingsHunter({ embedFn: async () => a, index });
    const result = await hunter.scan('payload');
    expect(result.features.length).toBeGreaterThan(0);
    const feature = result.features[0]!;
    expect(feature.name).toBe('cosine_similarity');
    expect(feature.activations[0]).toMatch(/^honeypot\/foo@(?:0|1)\.\d+$/);
  });

  it('returns clean when no corpus entry crosses the threshold', async () => {
    const a = unitVector(1);
    const queryFar = unitVector(99);
    const index = createVectorIndex([entry('a', a)]);
    const hunter = createEmbeddingsHunter({ embedFn: async () => queryFar, index });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(false);
    expect(result.flags).toEqual([]);
  });

  it('honours a caller-supplied threshold override', async () => {
    const a = unitVector(1);
    const b = unitVector(2);
    const index = createVectorIndex([entry('a', a), entry('b', b)]);
    // Forcing threshold = 0.99 should reject the partial match between a and b.
    const hunter = createEmbeddingsHunter({
      embedFn: async () => a,
      index,
      threshold: 0.99,
    });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(true);
    expect(result.flags.filter((f) => f.startsWith('embeddings:'))).toEqual(['embeddings:a']);
  });
});

describe('createEmbeddingsHunter — error handling', () => {
  it('packages embedFn throws as errorMessage and never escapes', async () => {
    const a = unitVector(1);
    const index = createVectorIndex([entry('a', a)]);
    const failing = vi.fn(async () => {
      throw new Error('model crashed');
    });
    const hunter = createEmbeddingsHunter({ embedFn: failing, index });
    const result = await hunter.scan('chunk');
    expect(result.matched).toBe(false);
    expect(result.errorMessage).toBe('model crashed');
  });
});
