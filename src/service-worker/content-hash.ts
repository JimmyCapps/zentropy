/**
 * Issue #112 (N1) — content-hash helper for ChunkAnalysis.contentHash.
 *
 * Hashes the first 512 chars of a chunk to a SHA-256 hex string. The 512-char
 * cap keeps the digest cost negligible (<1ms in a service-worker V8 context)
 * while still producing a stable identity for the chunk's leading content —
 * useful as a forward-compat hook for #N11 chunk-level result caching.
 *
 * Uses Web Crypto via crypto.subtle, which is available in the service-worker
 * runtime (no Node fallback path needed for extension code).
 */
export async function createContentHash(text: string): Promise<string> {
  const slice = text.slice(0, 512);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(slice));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
