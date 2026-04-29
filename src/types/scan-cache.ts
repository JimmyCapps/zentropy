import type { ProbeResult, TierRouting } from './verdict.js';
import type { EntitySummary } from '@/hunters/ner/types.js';

/**
 * Issue #127 (N11) — per-chunk record cached for page-scan replay.
 *
 * `contentHash` is the sha256-hex of the chunk text (stable across runs)
 * and is the cache key used to match new chunks against cached chunks
 * even when boundaries shift between visits. `tierRouting` and
 * `probeResults` are reused on a hit so neither hunters, NER, nor the
 * LLM probe stack need to re-run for that chunk. `notScanned` mirrors
 * `ChunkAnalysis.notScanned` for chunks that were padded out by the
 * #145 early-exit on the original run.
 */
export interface CachedChunk {
  readonly contentHash: string;
  readonly tierRouting: TierRouting;
  readonly probeResults: readonly ProbeResult[] | null;
  readonly notScanned?: true;
}

/**
 * Issue #127 (N11) — per-URL page-scan cache record. Stored in
 * IndexedDB keyed by `url`. The version triple
 * (`schemaVersion`/`hunterRulesVersion`/`llmModelId`) is checked on
 * every read; any mismatch fails the lookup as a miss so a rules or
 * model bump can never replay stale results.
 *
 * `fetchedAt` is the wall-clock millisecond timestamp of the most
 * recent write — used both for TTL eviction (per-entry) and for
 * fetchedAt-LRU eviction (cache-wide). `earlyExited` mirrors the
 * orchestrator's #145 early-exit flag so a full-cache-hit replay
 * preserves `EARLY_EXIT_ANALYSIS_ERROR` exactly as the original run
 * produced it. `entitySummary` lets the popup render the entity
 * accordion on a cache hit without rerunning extraction.
 *
 * `sizeBytes` is computed at write time as
 * `JSON.stringify(record).length` (UTF-16 chars; close enough to the
 * IndexedDB on-disk footprint for LRU purposes). Stored on the record
 * so the eviction loop can sum it without re-serializing.
 */
export interface CachedScan {
  readonly schemaVersion: number;
  readonly hunterRulesVersion: string;
  readonly llmModelId: string;
  readonly url: string;
  readonly fetchedAt: number;
  readonly chunks: readonly CachedChunk[];
  readonly earlyExited: boolean;
  readonly entitySummary: EntitySummary | null;
  readonly sizeBytes: number;
}

/**
 * Issue #127 (N11) — cache statistics surfaced to the popup. `hitRate`
 * is null until at least one lookup has happened in the current
 * telemetry window (so we don't render "0%" before any data exists).
 */
export interface CacheStats {
  readonly entries: number;
  readonly sizeBytes: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number | null;
}
