#!/usr/bin/env tsx
/**
 * Issue #232 — diagnostic: embed BrickLink-shaped phrases and dump
 * the cosine-similarity top-k against the live `data/injection-corpus.json`.
 *
 * Goal: determine whether the embeddings hunter is the source of the
 * false-positive (cosine ≥ EMBEDDING_COSINE_THRESHOLD = 0.85) and, if
 * so, which corpus rows are matching. Writes a fixture file at
 * `src/hunters/embeddings/__fixtures__/bricklink-query-embeddings.json`
 * that the regression test consumes (precomputed to avoid loading the
 * 118 MB model inside vitest).
 *
 * Usage: npx tsx scripts/diagnose-bricklink-embeddings.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const EMBEDDING_DIM = 384;
const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';
const COSINE_THRESHOLD = 0.85;
const TOP_K = 10;
const PRECISION = 6;

interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: string;
  readonly techniques: readonly string[];
  readonly embedding: readonly number[] | null;
}

interface Corpus {
  readonly entries: readonly CorpusEntry[];
}

const BRICKLINK_PHRASES: readonly { readonly id: string; readonly text: string }[] = [
  { id: 'short-imperatives', text: 'Buy now! Click here! Limited offer!' },
  {
    id: 'homepage-snippet',
    text: 'Welcome to the BrickLink Marketplace, the world\'s largest online LEGO marketplace. Featured Offers: Limited Time Offer Save 20%. Shop our latest arrivals and get exclusive discounts. Click here to browse now. Best Sellers: See what other collectors are buying. Click to view bestsellers.',
  },
  {
    id: 'promotional-list',
    text: 'Buy now and save on selected sets. Limited time offer Act fast! Free shipping on orders over $75. Click the Add to Cart button to purchase. Order today and receive exclusive benefits. Limited stock available Order now. Shop now for the best prices. Click here to see our new releases.',
  },
  {
    id: 'navigation-cta',
    text: 'Ready to Shop? Browse thousands of LEGO items from verified sellers worldwide. Start shopping now. Click here to view all products.',
  },
];

function passagePrefix(text: string): string {
  return `passage: ${text}`;
}

function l2Norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function dot(a: readonly number[], b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * b[i]!;
  return s;
}

function roundVector(vec: Float32Array, precision: number): number[] {
  const factor = 10 ** precision;
  const out: number[] = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = Math.round((vec[i] as number) * factor) / factor;
  return out;
}

async function embedTexts(texts: readonly string[]): Promise<readonly Float32Array[]> {
  const tf = await import('@huggingface/transformers');
  const pipe = await tf.pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: 'q8' });
  const tensor = await pipe(texts.map(passagePrefix), { pooling: 'mean', normalize: true });
  const flat = tensor.data as Float32Array;
  const dim = (tensor.dims as readonly number[])[1] ?? EMBEDDING_DIM;
  const rows = (tensor.dims as readonly number[])[0] ?? texts.length;
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) out.push(flat.slice(i * dim, (i + 1) * dim));
  return out;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
  const corpusPath = resolve(repoRoot, 'data/injection-corpus.json');
  const fixturePath = resolve(
    repoRoot,
    'src/hunters/embeddings/__fixtures__/bricklink-query-embeddings.json',
  );

  console.log(`[diagnose-bricklink] reading corpus ${corpusPath}`);
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8')) as Corpus;
  console.log(`[diagnose-bricklink] ${corpus.entries.length} corpus rows`);

  console.log(`[diagnose-bricklink] embedding ${BRICKLINK_PHRASES.length} bricklink phrases via ${EMBEDDING_MODEL_ID}`);
  const queries = await embedTexts(BRICKLINK_PHRASES.map((p) => p.text));
  for (const q of queries) {
    const n = l2Norm(q);
    if (Math.abs(n - 1) > 1e-3) console.warn(`[diagnose-bricklink] WARN query L2 norm=${n.toFixed(4)} (expected ≈1)`);
  }

  type Match = { readonly id: string; readonly score: number; readonly source: string; readonly lang: string };

  const allTopK: { readonly phraseId: string; readonly text: string; readonly topK: readonly Match[] }[] = [];
  let anyAboveThreshold = false;

  for (let qi = 0; qi < BRICKLINK_PHRASES.length; qi++) {
    const phrase = BRICKLINK_PHRASES[qi]!;
    const q = queries[qi]!;
    const scored: Match[] = [];
    for (const entry of corpus.entries) {
      if (!entry.embedding || entry.embedding.length !== EMBEDDING_DIM) continue;
      const score = dot(entry.embedding, q);
      scored.push({ id: entry.id, score, source: entry.source, lang: entry.lang });
    }
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, TOP_K);
    allTopK.push({ phraseId: phrase.id, text: phrase.text, topK });

    console.log(`\n[diagnose-bricklink] phrase "${phrase.id}":  ${phrase.text.slice(0, 80)}${phrase.text.length > 80 ? '...' : ''}`);
    for (const m of topK) {
      const flag = m.score >= COSINE_THRESHOLD ? ' >>> ABOVE THRESHOLD <<<' : '';
      console.log(`  ${m.score.toFixed(4)}  ${m.lang.padEnd(5)} ${m.id}${flag}`);
      if (m.score >= COSINE_THRESHOLD) anyAboveThreshold = true;
    }
  }

  console.log(`\n[diagnose-bricklink] writing fixture ${fixturePath}`);
  mkdirSync(dirname(fixturePath), { recursive: true });
  const fixture = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    embedding_model_id: EMBEDDING_MODEL_ID,
    embedding_dim: EMBEDDING_DIM,
    cosine_threshold: COSINE_THRESHOLD,
    notes: [
      'Issue #232 regression fixture: precomputed embeddings for BrickLink-shaped phrases.',
      'Used by src/hunters/embeddings/bricklink-regression.test.ts to assert top-k cosine < 0.85 against the live corpus, without loading the 118 MB model in vitest.',
      'Regenerate via: npx tsx scripts/diagnose-bricklink-embeddings.ts',
      'Embeddings are 384-dim, L2-normalised, with the e5-small "passage:" prefix matching how chunks are embedded by src/offscreen/embedding-engine.ts at runtime.',
    ],
    phrases: BRICKLINK_PHRASES.map((p, i) => ({
      id: p.id,
      text: p.text,
      embedding: roundVector(queries[i]!, PRECISION),
    })),
  };
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log('[diagnose-bricklink] done.');
  console.log(
    anyAboveThreshold
      ? '[diagnose-bricklink] EMBEDDINGS IS A SOURCE: at least one bricklink phrase scored ≥ 0.85 against the corpus.'
      : '[diagnose-bricklink] embeddings hunter NOT a source: all bricklink phrases scored < 0.85.',
  );
}

main().catch((err) => {
  console.error('[diagnose-bricklink] failed:', err);
  process.exit(1);
});
