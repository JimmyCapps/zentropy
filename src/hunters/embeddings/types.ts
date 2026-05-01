/**
 * Issue #129 Stage 3 — vector-index types shared across the embeddings
 * Hunter, the in-memory index module, and the corpus loader.
 */

export interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: string;
  readonly techniques: readonly string[];
  /**
   * 384-dim L2-normalised sentence embedding (per `EMBEDDING_DIM` in
   * `src/offscreen/embedding-engine.ts`). Stored as `number[]` rounded to
   * 6 dp in `data/injection-corpus.json` (schema v2). The vector index
   * copies these into a single backing `Float32Array` for batched dot
   * products.
   */
  readonly embedding: readonly number[];
}

export interface VectorIndexMatch {
  readonly id: string;
  readonly source: string;
  readonly lang: string;
  readonly techniques: readonly string[];
  /** Cosine similarity in [-1, 1]. Both ends are L2-normalised so this is the dot product. */
  readonly score: number;
}

export type ChunkEmbedFn = (text: string) => Promise<Float32Array | null>;
