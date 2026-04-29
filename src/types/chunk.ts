/**
 * Canonical chunk shape produced by `chunkText` (src/hunters/hawk/chunking.ts).
 *
 * Both the orchestrator's probe-dispatch path and (in N1) the Hunter pipeline
 * consume chunks of this shape. `start`/`end` are byte-offsets into the
 * source text so downstream consumers can map findings back to DOM ranges.
 * `contentHash` is the sha256-hex of `text` and is stable across calls so
 * the N11 cache can key per-chunk results.
 */
export interface Chunk {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly contentHash: string;
}
