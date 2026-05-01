#!/usr/bin/env tsx
/**
 * Stage 2 of the #129 embeddings + multilingual injection vector index track.
 *
 * Reads `data/injection-corpus.json` (Stage 1 output), embeds each entry's
 * `text` via transformers.js + `intfloat/multilingual-e5-small` (q8, 384-dim),
 * and writes the populated corpus back to disk.
 *
 * The embedding vector is the same one the offscreen-doc engine produces at
 * runtime (`src/offscreen/embedding-engine.ts`): `passage:` prefix +
 * mean-pooled + L2-normalised. Stage 3 (vector index) and Stage 4 (SW
 * orchestrator integration) can therefore compare a chunk's embedding to a
 * corpus embedding via plain dot product == cosine similarity.
 *
 * Usage:
 *   npx tsx scripts/embed-injection-corpus.ts
 *
 * Notes:
 *   - The model (~118 MB quantized) lazy-downloads to `~/.cache/huggingface/`
 *     on first run. Subsequent runs hit the cache.
 *   - Output is rounded to 6 decimal places per element. Sufficient for
 *     cosine-similarity scoring (≪ inter-pattern distance) and keeps the
 *     committed JSON byte-stable across machines / Hub model revisions.
 *   - This script is a one-shot maintainer tool. CI does not run it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const EMBEDDING_DIM = 384;
const PRECISION = 6;
const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';

export interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: 'en' | 'es' | 'zh-CN';
  readonly techniques: readonly string[];
  readonly embedding: null | readonly number[];
}

export interface Corpus {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly schema?: unknown;
  readonly notes?: readonly string[];
  readonly count: number;
  readonly entries: readonly CorpusEntry[];
}

export type EmbedFn = (texts: readonly string[]) => Promise<readonly Float32Array[]>;

export function roundVector(vec: Float32Array | readonly number[], precision: number): number[] {
  const factor = 10 ** precision;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.round((vec[i] as number) * factor) / factor;
  }
  return out;
}

function passagePrefix(text: string): string {
  return `passage: ${text}`;
}

export interface EmbedCorpusOptions {
  readonly batchSize?: number;
  readonly precision?: number;
  readonly dim?: number;
}

/**
 * Pure function: embeds every entry in `corpus.entries` via `embedFn` and
 * returns a new corpus with `embedding[]` populated. Rejects if `embedFn`
 * returns vectors of unexpected length, so downstream consumers can rely on
 * a fixed-dim invariant.
 */
export async function embedCorpus(
  corpus: Corpus,
  embedFn: EmbedFn,
  options: EmbedCorpusOptions = {},
): Promise<Corpus> {
  const batchSize = options.batchSize ?? 8;
  const precision = options.precision ?? PRECISION;
  const dim = options.dim ?? EMBEDDING_DIM;

  const inputs = corpus.entries.map((e) => passagePrefix(e.text));
  const vectors: Float32Array[] = [];

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const out = await embedFn(batch);
    if (out.length !== batch.length) {
      throw new Error(
        `embedFn returned ${out.length} vectors for batch of ${batch.length} (i=${i})`,
      );
    }
    for (const v of out) {
      if (v.length !== dim) {
        throw new Error(`embedFn returned vector of length ${v.length}; expected ${dim}`);
      }
      vectors.push(v);
    }
  }

  const newEntries: CorpusEntry[] = corpus.entries.map((entry, idx) => ({
    ...entry,
    embedding: roundVector(vectors[idx]!, precision),
  }));

  return {
    ...corpus,
    schema_version: 2,
    generated_at: corpus.generated_at,
    count: newEntries.length,
    entries: newEntries,
  };
}

export function loadCorpus(path: string): Corpus {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Corpus;
}

export function writeCorpus(path: string, corpus: Corpus): void {
  writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
}

async function defaultEmbedFn(texts: readonly string[]): Promise<readonly Float32Array[]> {
  const tf = await import('@huggingface/transformers');
  const pipe = await tf.pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
    dtype: 'q8',
  });
  const tensor = await pipe(texts as string[], { pooling: 'mean', normalize: true });
  const flat = tensor.data as Float32Array;
  const dim = (tensor.dims as readonly number[])[1] ?? EMBEDDING_DIM;
  const rows = (tensor.dims as readonly number[])[0] ?? texts.length;
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(flat.slice(i * dim, (i + 1) * dim));
  }
  return out;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
  const path = resolve(repoRoot, 'data/injection-corpus.json');
  console.log(`[embed-injection-corpus] reading ${path}`);
  const corpus = loadCorpus(path);
  console.log(
    `[embed-injection-corpus] embedding ${corpus.entries.length} entries with ${EMBEDDING_MODEL_ID} ...`,
  );
  const next = await embedCorpus(corpus, defaultEmbedFn, { batchSize: 8 });
  next.entries.forEach((e, i) => {
    if (i < 3) console.log(`  [${i}] ${e.id}  embedding[0..3]=${(e.embedding as number[]).slice(0, 3).join(',')}`);
  });
  writeCorpus(path, next);
  console.log(`[embed-injection-corpus] wrote ${path}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('[embed-injection-corpus] failed:', err);
    process.exit(1);
  });
}
