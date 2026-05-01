import type { HunterResult } from '../base-hunter.js';
import type { EmbeddingsFinding } from './types.js';

const FLAG_PREFIX_ID = 'embeddings:';
const FLAG_PREFIX_LANG = 'lang:';
const FLAG_PREFIX_TECHNIQUE = 'technique:';
const COSINE_FEATURE_NAME = 'cosine_similarity';

/**
 * Issue #129 Stage 5 — project a single chunk's embeddings-Hunter
 * `HunterResult` into the persisted `EmbeddingsFinding` shape consumed by
 * the popup explainability accordion. Returns `null` when the result
 * isn't an embeddings match (wrong hunter / unmatched / missing feature)
 * so the orchestrator can `.filter(Boolean)` without separate gating.
 */
export function buildEmbeddingsFinding(
  chunkIndex: number,
  result: HunterResult,
): EmbeddingsFinding | null {
  if (result.hunterName !== 'embeddings' || !result.matched) return null;

  const feature = result.features.find((f) => f.name === COSINE_FEATURE_NAME);
  if (feature === undefined) return null;

  let topId = '';
  let topLang = 'unknown';
  const topTechniques: string[] = [];
  for (const flag of result.flags) {
    if (flag.startsWith(FLAG_PREFIX_ID)) topId = flag.slice(FLAG_PREFIX_ID.length);
    else if (flag.startsWith(FLAG_PREFIX_LANG)) topLang = flag.slice(FLAG_PREFIX_LANG.length);
    else if (flag.startsWith(FLAG_PREFIX_TECHNIQUE)) {
      topTechniques.push(flag.slice(FLAG_PREFIX_TECHNIQUE.length));
    }
  }

  return {
    chunkIndex,
    topId,
    topScore: feature.weight,
    topLang,
    topTechniques,
    activations: feature.activations,
  };
}
