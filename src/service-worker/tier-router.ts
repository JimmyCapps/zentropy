import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { TierDecision, TierRouting } from '@/types/verdict.js';

/**
 * Issue #112 (N1) — k=2 tier-router.
 *
 * Maps a per-chunk HuntReport to a routing decision that gates whether the
 * LLM probe tier runs for the chunk. Pure function: no I/O, no side effects.
 *
 * Routing semantics (Gate C):
 *   primitiveCount === 0  → BENIGN     (skip probes; fast-path)
 *   primitiveCount === 1  → UNCERTAIN  (run probes for confirmation)
 *   primitiveCount >= 2   → FLAGGED    (run probes for confirmation)
 *
 * primitiveCount is the count of hunters whose `matched` flag is true.
 * With Spider + Hawk this maps cleanly onto 0/1/2 without flag-count drift.
 *
 * Fail-open: if the HuntReport carries an aggregateError (every hunter
 * crashed), route as UNCERTAIN so the LLM tier still runs — a hunter
 * outage must not silently suppress detection.
 */
export function routeChunk(report: HuntReport): TierRouting {
  if (report.aggregateError !== null) {
    return { decision: 'UNCERTAIN', primitiveCount: 0, contributingHunters: [] };
  }

  const matched = report.results.filter((r) => r.matched);
  const primitiveCount = matched.length;
  const contributingHunters = matched.map((r) => r.hunterName);

  const decision: TierDecision =
    primitiveCount === 0 ? 'BENIGN' : primitiveCount === 1 ? 'UNCERTAIN' : 'FLAGGED';

  return { decision, primitiveCount, contributingHunters };
}
