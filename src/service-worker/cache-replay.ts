import type { Chunk } from '@/types/chunk.js';
import type { CachedScan, CachedChunk } from '@/types/scan-cache.js';
import type { ChunkAnalysis, ProbeResult } from '@/types/verdict.js';

/**
 * Issue #127 (N11) — pure helpers for replaying a CachedScan against
 * the freshly-extracted chunk list. Pulled out of the orchestrator into
 * its own module so the integration logic is unit-testable without
 * dragging the full analyzeSnapshot pipeline into the test.
 */

/**
 * True iff every hash in `currentHashes` is present in the cached scan.
 * Allows the caller to short-circuit to the all-hits aggregate path
 * without computing per-chunk replay state.
 *
 * Subset is fine — a cached scan can carry MORE chunks than the current
 * extraction (e.g. the page shrank); what matters is that every CURRENT
 * chunk has a cached counterpart.
 */
export function hashesAllCovered(
  currentHashes: readonly string[],
  cached: CachedScan,
): boolean {
  const cachedSet = new Set(cached.chunks.map((c) => c.contentHash));
  for (const h of currentHashes) {
    if (!cachedSet.has(h)) return false;
  }
  return true;
}

export interface CacheReplayPlan {
  /** Indices into the current chunks array that hit the cache. */
  readonly hitIndices: readonly number[];
  /** Indices into the current chunks array that missed and need fresh probes. */
  readonly missIndices: readonly number[];
  /**
   * Sparse-array of replayed per-chunk probe results. `replayedChunkResults[i]`
   * is populated for hit indices and absent for miss indices; the caller
   * fills in misses after running runChunkProbes.
   */
  readonly replayedChunkResults: ReadonlyArray<readonly ProbeResult[] | undefined>;
  /**
   * Sparse-array of replayed ChunkAnalysis records. Same indexing
   * convention as `replayedChunkResults`.
   */
  readonly replayedPerChunkAnalysis: ReadonlyArray<ChunkAnalysis | undefined>;
  /**
   * True iff the cached scan recorded an early-exit AND every current
   * chunk hit the cache. A partial-hit replay cannot honour cached
   * earlyExit because the miss chunks need fresh evaluation, so we
   * conservatively drop the flag in that case.
   */
  readonly earlyExitedReplay: boolean;
}

/**
 * Build a replay plan: for each current chunk, look up its hash in the
 * cached chunks and stage either a hit (with cached probe results +
 * tier routing) or a miss (caller runs the pipeline fresh).
 *
 * The cached chunk's `notScanned` flag is preserved on hits — a chunk
 * that was padded out by #145 early-exit on the original run replays as
 * a `notScanned: true` ChunkAnalysis entry, keeping the existing
 * `perChunkAnalysis.length === chunks.length` invariant.
 */
export function prepareCachedReplay(
  chunks: readonly Chunk[],
  cached: CachedScan,
): CacheReplayPlan {
  const cachedByHash = new Map<string, CachedChunk>();
  for (const c of cached.chunks) {
    cachedByHash.set(c.contentHash, c);
  }

  const hitIndices: number[] = [];
  const missIndices: number[] = [];
  const replayedChunkResults: Array<readonly ProbeResult[] | undefined> = new Array(chunks.length);
  const replayedPerChunkAnalysis: Array<ChunkAnalysis | undefined> = new Array(chunks.length);

  for (let i = 0; i < chunks.length; i += 1) {
    const hash = chunks[i]!.contentHash;
    const hit = cachedByHash.get(hash);
    if (hit === undefined) {
      missIndices.push(i);
      continue;
    }
    hitIndices.push(i);
    // Empty array contributes nothing in mergeProbeResults — same
    // semantics as the BENIGN early-exit path in orchestrator.ts:267.
    replayedChunkResults[i] = hit.probeResults ?? [];
    const analysis: ChunkAnalysis = hit.notScanned
      ? {
          index: i,
          contentHash: hash,
          tierRouting: hit.tierRouting,
          probeResults: hit.probeResults,
          notScanned: true,
        }
      : {
          index: i,
          contentHash: hash,
          tierRouting: hit.tierRouting,
          probeResults: hit.probeResults,
        };
    replayedPerChunkAnalysis[i] = analysis;
  }

  const fullHit = missIndices.length === 0 && hitIndices.length === chunks.length;
  const earlyExitedReplay = fullHit && cached.earlyExited;

  return {
    hitIndices,
    missIndices,
    replayedChunkResults,
    replayedPerChunkAnalysis,
    earlyExitedReplay,
  };
}
