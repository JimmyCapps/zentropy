import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import type { CorpusEntry } from './types.js';
import { createVectorIndex, EMBEDDING_COSINE_THRESHOLD } from './vector-index.js';
import { createEmbeddingsHunter } from './index.js';

/**
 * Issue #232 — bricklink false-positive regression gate.
 *
 * Runs the actual embeddings hunter against a precomputed fixture of
 * BrickLink-shaped query embeddings (generated offline via
 * `npx tsx scripts/diagnose-bricklink-embeddings.ts`) over the live
 * `data/injection-corpus.json`. The fixture exists so we don't have to
 * load the 118 MB transformers.js model inside vitest; the embedding
 * vectors are produced by the SAME `Xenova/multilingual-e5-small` /
 * `passage:` prefix / mean-pool / L2-normalise pipeline that runs in
 * the offscreen engine at runtime, so the assertion this test makes
 * mirrors the hunter's production behaviour.
 *
 * Pre-fix: "Buy now! Click here! Limited offer!" hit
 * `dm4/en/train-injection-0065` at cosine 0.888 — flagging the page
 * COMPROMISED. Post-fix: the same phrase's top-1 match is the
 * negative-kind seed `benign/retail/short-imperatives` at cosine 0.997,
 * which the hunter's negative-anchor suppression gate (`if top.kind ===
 * 'negative' → cleanResult`) treats as benign.
 *
 * If this test fails, look at:
 *   - `data/injection-corpus.json` — were `benign/retail/*` entries
 *     dropped or did their `kind: 'negative'` field get lost?
 *   - `src/hunters/embeddings/index.ts` — was the negative-kind
 *     suppression branch removed?
 *   - `src/hunters/embeddings/__fixtures__/bricklink-query-embeddings.json`
 *     — has the embedding model id or the phrase text changed without
 *     a fixture regen?
 */

interface BricklinkFixturePhrase {
  readonly id: string;
  readonly text: string;
  readonly embedding: readonly number[];
}

interface BricklinkFixture {
  readonly schema_version: number;
  readonly embedding_model_id: string;
  readonly embedding_dim: number;
  readonly cosine_threshold: number;
  readonly phrases: readonly BricklinkFixturePhrase[];
}

interface CorpusFile {
  readonly entries: readonly CorpusEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

function loadFixture(): BricklinkFixture {
  const path = resolve(HERE, '__fixtures__', 'bricklink-query-embeddings.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as BricklinkFixture;
}

function loadCorpus(): readonly CorpusEntry[] {
  const path = resolve(HERE, '..', '..', '..', 'data', 'injection-corpus.json');
  const file = JSON.parse(readFileSync(path, 'utf-8')) as CorpusFile;
  return file.entries.filter(
    (e) => Array.isArray(e.embedding) && e.embedding.length === EMBEDDING_DIM,
  );
}

function toFloat32(values: readonly number[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] as number;
  return out;
}

describe('embeddings hunter — bricklink false-positive regression (#232)', () => {
  const fixture = loadFixture();
  const corpusEntries = loadCorpus();
  const index = createVectorIndex(corpusEntries);

  it('fixture model id and dim match the corpus embedding pipeline', () => {
    expect(fixture.embedding_model_id).toBe('Xenova/multilingual-e5-small');
    expect(fixture.embedding_dim).toBe(EMBEDDING_DIM);
    expect(fixture.cosine_threshold).toBe(EMBEDDING_COSINE_THRESHOLD);
  });

  it('corpus contains negative-kind anti-anchors (post-#232 fix)', () => {
    const negatives = corpusEntries.filter((e) => e.kind === 'negative');
    expect(negatives.length).toBeGreaterThan(0);
    expect(negatives.some((e) => e.id === 'benign/retail/short-imperatives')).toBe(true);
  });

  it('"Buy now! Click here! Limited offer!" — top-1 is a negative anti-anchor', () => {
    const phrase = fixture.phrases.find((p) => p.id === 'short-imperatives');
    expect(phrase).toBeDefined();
    const matches = index.topK(toFloat32(phrase!.embedding), 5, EMBEDDING_COSINE_THRESHOLD);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0]!;
    expect(top.kind).toBe('negative');
    expect(top.id).toMatch(/^benign\//);
    expect(top.score).toBeGreaterThan(EMBEDDING_COSINE_THRESHOLD);
  });

  it.each(['short-imperatives', 'homepage-snippet', 'promotional-list', 'navigation-cta'])(
    'phrase "%s" — embeddings hunter returns clean (no flag)',
    async (phraseId) => {
      const phrase = fixture.phrases.find((p) => p.id === phraseId);
      expect(phrase, `fixture missing phrase "${phraseId}"`).toBeDefined();
      const queryVec = toFloat32(phrase!.embedding);
      const hunter = createEmbeddingsHunter({
        embedFn: async () => queryVec,
        index,
      });
      const result = await hunter.scan(phrase!.text);
      expect(
        result.matched,
        `phrase "${phraseId}" was flagged: top match ${result.flags[0] ?? '(none)'}`,
      ).toBe(false);
      expect(result.flags).toEqual([]);
      expect(result.errorMessage).toBeNull();
    },
  );

  it('threshold constant remains pinned at 0.85 (changing it requires re-baselining pedagogical-FP corpus)', () => {
    expect(EMBEDDING_COSINE_THRESHOLD).toBe(0.85);
  });
});
