import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import type { CorpusEntry, VectorIndexMatch } from './types.js';

/**
 * Issue #129 Stage 3 — initial cosine threshold per the issue body and
 * `README.md`. Tunable from telemetry once the index is wired into the
 * orchestrator (Stage 4) and pedagogical-FP discipline (≥ 0/50 compromised
 * on the pedagogical baseline corpus per `project_pedagogical_fpr_baseline.md`)
 * has been confirmed at the new threshold.
 */
export const EMBEDDING_COSINE_THRESHOLD = 0.85;

/** Default cap on returned matches per chunk. */
export const EMBEDDING_TOP_K = 5;

export interface VectorIndex {
  /** Number of corpus rows actually indexed (post-validation). */
  readonly size: number;
  /**
   * Returns the top-`k` matches whose cosine similarity with `query` is
   * ≥ `threshold`, sorted by score descending. `query` MUST be 384-dim and
   * already L2-normalised — the index also stores L2-normalised vectors so
   * the dot product equals cosine similarity (both ends are unit-norm by
   * construction; see `embedding-engine.ts` `normalize: true`).
   */
  topK(
    query: Float32Array,
    k?: number,
    threshold?: number,
  ): readonly VectorIndexMatch[];
}

interface IndexedRow {
  readonly id: string;
  readonly source: string;
  readonly lang: string;
  readonly techniques: readonly string[];
}

function isValidEmbedding(embedding: readonly number[]): boolean {
  if (embedding.length !== EMBEDDING_DIM) return false;
  for (const x of embedding) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false;
  }
  return true;
}

/**
 * Stack the corpus into a single backing `Float32Array` of length
 * `N * EMBEDDING_DIM` so per-chunk lookups are one tight loop over a flat
 * buffer instead of N separate array accesses. With 60 corpus rows × 384
 * dims this is ≈90 KB resident per index — small enough to keep in SW
 * memory for the lifetime of the worker.
 */
export function createVectorIndex(entries: readonly CorpusEntry[]): VectorIndex {
  const rows: IndexedRow[] = [];
  const buffers: number[][] = [];

  for (const entry of entries) {
    if (!isValidEmbedding(entry.embedding)) continue;
    rows.push({
      id: entry.id,
      source: entry.source,
      lang: entry.lang,
      techniques: entry.techniques,
    });
    buffers.push(entry.embedding as number[]);
  }

  const matrix = new Float32Array(rows.length * EMBEDDING_DIM);
  for (let i = 0; i < rows.length; i++) {
    const offset = i * EMBEDDING_DIM;
    const buf = buffers[i]!;
    for (let j = 0; j < EMBEDDING_DIM; j++) matrix[offset + j] = buf[j]!;
  }

  return {
    size: rows.length,
    topK(query, k = EMBEDDING_TOP_K, threshold = EMBEDDING_COSINE_THRESHOLD): readonly VectorIndexMatch[] {
      if (query.length !== EMBEDDING_DIM) return [];
      if (rows.length === 0) return [];

      const scored: { row: IndexedRow; score: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const offset = i * EMBEDDING_DIM;
        let dot = 0;
        for (let j = 0; j < EMBEDDING_DIM; j++) {
          dot += matrix[offset + j]! * query[j]!;
        }
        if (dot >= threshold) {
          scored.push({ row: rows[i]!, score: dot });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k).map(({ row, score }) => ({
        id: row.id,
        source: row.source,
        lang: row.lang,
        techniques: row.techniques,
        score,
      }));
    },
  };
}
