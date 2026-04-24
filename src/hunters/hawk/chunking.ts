/**
 * Sliding-window chunking for Hawk v1.
 *
 * Real injection payloads are typically 30-100 words embedded in much
 * larger pages (benign article + hidden injection div). Page-level
 * density features dilute the signal to near-zero. By scoring each
 * chunk independently and taking the maximum, we preserve the needle's
 * signal even when it lives in a haystack.
 *
 * Window size (50 words) and stride (25 words, 50% overlap) are chosen
 * so a typical injection fits entirely within at least one window,
 * and so boundary-straddling attacks can't escape by sitting across
 * chunk edges.
 */

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
