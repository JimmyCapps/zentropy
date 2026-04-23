import type { Hunter, HunterResult } from './base-hunter.js';
import { errorResult } from './base-hunter.js';
import { P_COMPROMISED } from './hawk/classifier.js';

/**
 * Confidence threshold at which downstream LLM probes become redundant.
 * Mirrors the classifier's COMPROMISED breakpoint so a hunter already
 * confident enough to map to THRESHOLD_COMPROMISED is also confident
 * enough to short-circuit the probe pipeline.
 */
export const SHORT_CIRCUIT_CONFIDENCE = P_COMPROMISED;

export interface HuntReport {
  /** Per-hunter results in the order the hunters were supplied. */
  readonly results: readonly HunterResult[];
  /** Sum of scores across hunters. Feeds into policy engine aggregation. */
  readonly totalScore: number;
  /** Highest confidence emitted by any hunter. Used for short-circuit decisions. */
  readonly maxConfidence: number;
  /**
   * True iff at least one hunter emitted confidence >= SHORT_CIRCUIT_CONFIDENCE.
   * The orchestrator can use this to skip the LLM probe pipeline, saving
   * inference cost. Advisory — policy engine still owns the final verdict.
   */
  readonly shouldSkipProbes: boolean;
  /** Union of flags across all hunter results. Order preserved per-hunter. */
  readonly flags: readonly string[];
  /**
   * Aggregate error signal. Null when at least one hunter produced a
   * successful result. Non-null when every hunter errored; follows the
   * Phase 4 Stage 4A pattern used in the probe pipeline.
   */
  readonly aggregateError: string | null;
}

/**
 * Run hunters in parallel against a chunk. Each hunter's scan() must be
 * crash-safe (returns HunterResult with errorMessage rather than throwing);
 * we defensively catch here as a last resort.
 *
 * Deliberately NOT wired into src/service-worker/orchestrator.ts — the
 * integration shape is James's design call per issue #3 Stage 5C. This
 * runner is a standalone library ready to plug in wherever hunters fit
 * in the pipeline.
 */
export async function runHunters(
  hunters: readonly Hunter[],
  chunk: string,
): Promise<HuntReport> {
  const settled = await Promise.all(
    hunters.map((hunter) =>
      hunter.scan(chunk).catch((err): HunterResult => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(hunter.name, message);
      }),
    ),
  );

  const totalScore = settled.reduce((sum, r) => sum + r.score, 0);
  const maxConfidence = settled.reduce((max, r) => (r.confidence > max ? r.confidence : max), 0);
  const flags = settled.flatMap((r) => r.flags);
  const allErrored = settled.length > 0 && settled.every((r) => r.errorMessage !== null);

  const aggregateError = allErrored ? (settled[0]!.errorMessage ?? 'all hunters errored') : null;

  return {
    results: settled,
    totalScore,
    maxConfidence,
    shouldSkipProbes: maxConfidence >= SHORT_CIRCUIT_CONFIDENCE,
    flags,
    aggregateError,
  };
}
