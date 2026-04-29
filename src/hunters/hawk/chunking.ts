/**
 * Chunking primitives shared by Hunters and the canary-probe orchestrator.
 *
 * Two functions live here:
 *
 * - `chunkText` (canonical) — boundary-aware text splitter used by the
 *   service-worker orchestrator to dispatch RUN_PROBES messages, and (after
 *   N1) by the Hunter pipeline for tier routing. Returns structured `Chunk`
 *   objects with byte-offsets and a sha256 contentHash so downstream cache
 *   layers (N11) can key results per-chunk.
 *
 * - `chunkByWords` (Hawk-internal) — sliding 50-word window over an already-
 *   chunked string, used inside Hawk's per-window ML scoring. Real injection
 *   payloads are typically 30-100 words embedded in much larger pages, so
 *   page-level density features dilute the signal; scoring each window
 *   independently and taking the max preserves the needle's signal even
 *   when it lives in a haystack.
 */

import { MAX_CHUNK_TOKENS } from '@/shared/constants.js';
import { sha256Hex } from '@/shared/hash.js';
import type { Chunk } from '@/types/chunk.js';
import { applyDialectBoundaries, getRuleSet } from './dialect-boundaries.js';
import { detectLanguage, type LanguageRouterDeps } from './language-router.js';

const DEFAULT_WINDOW = 50;
const DEFAULT_STRIDE = 25;

export function chunkByWords(
  text: string,
  windowSize: number = DEFAULT_WINDOW,
  stride: number = DEFAULT_STRIDE,
): readonly string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  // Join on single spaces so the short-path output matches the chunked
  // branch's canonical whitespace, keeping downstream text-length-
  // normalized features (e.g. markerDensity) stable across the boundary.
  if (words.length <= windowSize) return [words.join(' ')];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += stride) {
    const chunk = words.slice(i, i + windowSize).join(' ');
    chunks.push(chunk);
    if (i + windowSize >= words.length) break;
  }
  return chunks;
}

interface ChunkTextOptions {
  readonly maxChars?: number;
  readonly detectDeps?: LanguageRouterDeps;
}

/**
 * Canonical boundary-aware text chunker. See file-level comment for design.
 *
 * Boundary detection and per-chunk char budget are dispatched per detected
 * language (see `dialect-boundaries.ts`). When `detectLanguage` returns
 * `und` (offscreen unavailable, short input, or any error path) the chunker
 * routes to the EN rule set — the contract to callers is that we always
 * return a non-empty `Chunk[]`, never throw on detection failure.
 */
export async function chunkText(
  text: string,
  opts: ChunkTextOptions = {},
): Promise<readonly Chunk[]> {
  const langResult = await detectLanguage(text, opts.detectDeps).catch(() => ({
    lang: 'und',
    confidence: 0,
    source: 'chrome-api' as const,
  }));
  const ruleSet = getRuleSet(langResult.lang);
  const maxChars =
    opts.maxChars ?? Math.floor(MAX_CHUNK_TOKENS * ruleSet.charsPerToken);

  const segments = applyDialectBoundaries(text, ruleSet, maxChars);

  const chunks: Chunk[] = [];
  let cursor = 0;
  for (const seg of segments) {
    chunks.push({
      text: seg,
      start: cursor,
      end: cursor + seg.length,
      contentHash: await sha256Hex(seg),
    });
    cursor += seg.length;
  }
  return chunks;
}
