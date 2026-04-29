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

import { MAX_CHUNK_CHARS } from '@/shared/constants.js';
import { sha256Hex } from '@/shared/hash.js';
import type { Chunk } from '@/types/chunk.js';

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
}

const SENTENCE_DELIMITERS = ['. ', '! ', '? ', '.\n'] as const;

/**
 * Pick the split point for the next chunk in `remaining`.
 *
 * Boundary chain (each step searches within `[0, maxChars]`; first hit at
 * or past the 50% mark wins, otherwise we fall through):
 *   1. Paragraph break  — `\n\n`
 *   2. Sentence boundary — latest of `. ` / `! ` / `? ` / `.\n`
 *   3. Word break        — last single space
 *   4. Hard cut          — exactly `maxChars`
 *
 * The 50% guard mirrors the prior orchestrator chunker: if the best
 * boundary lands in the first half of the window, we'd be wasting too
 * much of the budget, so we fall through to the next strategy.
 *
 * Returned offset points to the *first character of the next chunk* —
 * the boundary token itself stays with the prior chunk. Reconstruction
 * `prior + next === remaining` is preserved.
 */
function findSplit(remaining: string, maxChars: number): number {
  const halfMark = maxChars * 0.5;

  const paragraphAt = remaining.lastIndexOf('\n\n', maxChars);
  if (paragraphAt !== -1 && paragraphAt >= halfMark) {
    return paragraphAt + 1;
  }

  let bestSentence = -1;
  for (const delim of SENTENCE_DELIMITERS) {
    const idx = remaining.lastIndexOf(delim, maxChars);
    if (idx > bestSentence) bestSentence = idx;
  }
  if (bestSentence !== -1 && bestSentence >= halfMark) {
    return bestSentence + 1;
  }

  const wordAt = remaining.lastIndexOf(' ', maxChars);
  if (wordAt !== -1) {
    return wordAt + 1;
  }

  return maxChars;
}

/**
 * Canonical boundary-aware text chunker. See file-level comment for design.
 *
 * Async because each chunk's `contentHash` is computed via `crypto.subtle`,
 * matching the sha256-hex pattern used in `src/content/ingestion/script-
 * summary.ts`.
 */
export async function chunkText(
  text: string,
  opts: ChunkTextOptions = {},
): Promise<readonly Chunk[]> {
  const maxChars = opts.maxChars ?? MAX_CHUNK_CHARS;

  if (text.length <= maxChars) {
    return [
      {
        text,
        start: 0,
        end: text.length,
        contentHash: await sha256Hex(text),
      },
    ];
  }

  const chunks: Chunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.length <= maxChars) {
      chunks.push({
        text: remaining,
        start: cursor,
        end: cursor + remaining.length,
        contentHash: await sha256Hex(remaining),
      });
      break;
    }

    const splitAt = findSplit(remaining, maxChars);
    const chunkSlice = remaining.slice(0, splitAt);
    chunks.push({
      text: chunkSlice,
      start: cursor,
      end: cursor + splitAt,
      contentHash: await sha256Hex(chunkSlice),
    });
    cursor += splitAt;
  }

  return chunks;
}
