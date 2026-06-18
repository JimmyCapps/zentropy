import type { Hunter, HunterResult } from '../base-hunter.js';
import { cleanResult, errorResult } from '../base-hunter.js';
import { SCORE_INSTRUCTION_DETECTION } from '@/shared/constants.js';
import type { ChunkEmbedFn, VectorIndexMatch } from './types.js';
import {
  EMBEDDING_COSINE_THRESHOLD,
  type VectorIndex,
} from './vector-index.js';

export interface EmbeddingsHunterDeps {
  /**
   * Producer of a 384-dim L2-normalised query embedding for a chunk. Stage 3
   * accepts `null` because the SW-side bridge to the offscreen
   * `embedding-engine` lands in Stage 4. With `null` the hunter emits a
   * clean (no-op) result so the Phase 2 byte-locked baseline (162 rows in
   * `inbrowser-results.json`) sees zero changed verdicts when the hunter
   * is registered in `runHunters` alongside Spider/Hawk.
   */
  readonly embedFn: ChunkEmbedFn | null;
  /**
   * In-memory cosine-similarity index. `null` until Stage 4 plumbs the
   * corpus loader through SW startup; a `null` index also forces a clean
   * no-op result to preserve the baseline gate.
   */
  readonly index: VectorIndex | null;
  /** Override the default cosine threshold (`EMBEDDING_COSINE_THRESHOLD`). */
  readonly threshold?: number;
}

/**
 * Issue #129 Stage 3 — vector-similarity Hunter sibling to Spider / Hawk.
 *
 * Runs in the SW context, but the actual embedding inference happens in the
 * offscreen document via `src/offscreen/embedding-engine.ts`. Stage 3 ships
 * the Hunter contract + index module + tests; Stage 4 wires the SW↔offscreen
 * `EMBED_TEXT` message bridge that fulfils `embedFn`.
 *
 * Design choices:
 * - Threshold defaults to `EMBEDDING_COSINE_THRESHOLD = 0.85` per the issue
 *   body. Tunable from telemetry without code change.
 * - Score on match = `SCORE_INSTRUCTION_DETECTION` (40), matching Spider's
 *   load-bearing weight. A high-cosine match against the curated corpus is
 *   as load-bearing as a regex hit; pedagogical-FP discipline gates this
 *   choice (per `project_pedagogical_fpr_baseline.md`).
 * - Confidence on match = top match's cosine similarity, in [-1, 1].
 *   Effectively in [threshold, 1] given the threshold filter.
 */
export function createEmbeddingsHunter(deps: EmbeddingsHunterDeps): Hunter {
  return {
    name: 'embeddings',
    async scan(chunk: string): Promise<HunterResult> {
      if (deps.embedFn === null || deps.index === null) return cleanResult('embeddings');

      let query: Float32Array | null;
      try {
        query = await deps.embedFn(chunk);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('embeddings', message);
      }

      if (query === null) return cleanResult('embeddings');

      const matches = deps.index.topK(
        query,
        undefined,
        deps.threshold ?? EMBEDDING_COSINE_THRESHOLD,
      );
      if (matches.length === 0) return cleanResult('embeddings');

      // Issue #232 — if the chunk's top-1 cosine match is a negative anti-anchor
      // (e.g. retail/promotional copy added to suppress imperative-verb FPs),
      // treat the chunk as benign. This is the negative-kind suppression gate.
      const top = matches[0]!;
      if (top.kind === 'negative') return cleanResult('embeddings');

      // Drop negative matches from downstream flag/feature output so the
      // popup explains the verdict in terms of what actually triggered it.
      const positiveMatches = matches.filter((m) => m.kind === 'positive');
      if (positiveMatches.length === 0) return cleanResult('embeddings');

      const topPositive = positiveMatches[0]!;
      return {
        hunterName: 'embeddings',
        matched: true,
        flags: buildFlags(positiveMatches),
        score: SCORE_INSTRUCTION_DETECTION,
        confidence: topPositive.score,
        features: [
          {
            name: 'cosine_similarity',
            weight: topPositive.score,
            activations: positiveMatches.map((m) => `${m.id}@${m.score.toFixed(3)}`),
          },
        ],
        errorMessage: null,
      };
    },
  };
}

function buildFlags(matches: readonly VectorIndexMatch[]): readonly string[] {
  const top = matches[0]!;
  const flags = [`embeddings:${top.id}`, `lang:${top.lang}`];
  for (const technique of top.techniques) flags.push(`technique:${technique}`);
  return flags;
}

/**
 * No-op default singleton registered by the orchestrator at Stage 3. Stage 4
 * replaces it with a hunter built around real `embedFn` / `index` deps after
 * the corpus loader and offscreen bridge have run.
 */
export const embeddingsHunter: Hunter = createEmbeddingsHunter({
  embedFn: null,
  index: null,
});
