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

/**
 * Issue #129 Stage 5 — popup-render-friendly summary of one chunk's
 * embeddings-Hunter signal. Produced from a single `HunterResult` whose
 * `hunterName === 'embeddings'` and `matched === true`; flattens the top
 * match's flag breakdown plus the raw `<id>@<score>` activations array
 * for the explainability surface.
 *
 * The hunter already carries everything in `flags` + `features[0]` (see
 * `src/hunters/embeddings/index.ts:78-84`); this shape is the
 * persisted projection so the popup never has to re-parse flag prefixes.
 */
export interface EmbeddingsFinding {
  /** Index of the chunk in `chunks` (matches `ChunkAnalysis.index`). */
  readonly chunkIndex: number;
  /** Top-1 corpus entry id (e.g. `injection-0042`). */
  readonly topId: string;
  /** Top-1 cosine similarity in [threshold, 1]. */
  readonly topScore: number;
  /** Top-1 corpus entry language tag (e.g. `en`, `es`, `zh-CN`). */
  readonly topLang: string;
  /** Top-1 entry's techniques (e.g. `role-play`, `system-override`). */
  readonly topTechniques: readonly string[];
  /**
   * Verbatim `<id>@<score>` strings from `features[0].activations` —
   * top-K matches in score-descending order. Capped server-side by the
   * vector index's `EMBEDDING_TOP_K` (5).
   */
  readonly activations: readonly string[];
}
