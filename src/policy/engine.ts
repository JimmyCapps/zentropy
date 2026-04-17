import type { ProbeResult, BehavioralFlags, SecurityVerdict, SecurityStatus } from '@/types/verdict.js';
import { THRESHOLD_SUSPICIOUS, THRESHOLD_COMPROMISED } from '@/shared/constants.js';
import { computeScore } from './rules.js';

function statusFromScore(score: number): SecurityStatus {
  if (score >= THRESHOLD_COMPROMISED) return 'COMPROMISED';
  if (score >= THRESHOLD_SUSPICIOUS) return 'SUSPICIOUS';
  return 'CLEAN';
}

function confidenceFromScore(score: number): number {
  const maxPossible = 150;
  const normalized = Math.min(score / maxPossible, 1);

  if (score < THRESHOLD_SUSPICIOUS) {
    return 1 - normalized;
  }

  return Math.min(0.5 + normalized * 0.5, 0.99);
}

function allProbesErrored(probeResults: readonly ProbeResult[]): boolean {
  if (probeResults.length === 0) return false;
  return probeResults.every((r) => r.errorMessage !== null);
}

export function evaluatePolicy(
  probeResults: readonly ProbeResult[],
  behavioralFlags: BehavioralFlags,
  url: string,
  analysisError: string | null = null,
  canaryId: string | null = null,
): SecurityVerdict {
  // Phase 4 Stage 4A — error-aware branching.
  //
  // If every probe errored, the page could not be analysed; emit UNKNOWN with
  // confidence=0 so downstream consumers don't conflate "failed to analyse"
  // with "analysed and found clean" (which previously scored CLEAN+conf=1.0
  // on score=0, masking silent engine failures).
  //
  // In the mixed case (some probes errored, others produced real output) we
  // keep the score-derived status but surface analysisError so operators see
  // the failure signal alongside the verdict.
  const aggregateError =
    analysisError ??
    (allProbesErrored(probeResults)
      ? (probeResults[0]?.errorMessage ?? 'all probes errored')
      : null);

  if (allProbesErrored(probeResults)) {
    return {
      status: 'UNKNOWN',
      confidence: 0,
      totalScore: 0,
      probeResults,
      behavioralFlags,
      mitigationsApplied: [],
      timestamp: Date.now(),
      url,
      analysisError: aggregateError,
      canaryId,
    };
  }

  const { totalScore } = computeScore(probeResults, behavioralFlags);
  const status = statusFromScore(totalScore);
  const confidence = confidenceFromScore(totalScore);

  return {
    status,
    confidence: Math.round(confidence * 100) / 100,
    totalScore,
    probeResults,
    behavioralFlags,
    mitigationsApplied: [],
    timestamp: Date.now(),
    url,
    analysisError: aggregateError,
    canaryId,
  };
}
