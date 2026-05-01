import type { ProbeResult, BehavioralFlags, SecurityVerdict, SecurityStatus, WebGPUAdapterMode } from '@/types/verdict.js';
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
  webgpuAdapterMode: WebGPUAdapterMode | null = null,
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
      webgpuAdapterMode,
      stamp: null,
      // Issue #112 — orchestrator overwrites with the populated record array
      // via spread; null here is the safe default for callers of evaluatePolicy
      // that don't run through the orchestrator (e.g. policy-engine tests).
      perChunkAnalysis: null,
      // Issue #122 — orchestrator overwrites via spread; null here matches
      // the perChunkAnalysis default for engine-only callers.
      entitySummary: null,
      // Issue #126 — engine-only callers never produce a response verdict;
      // the SW response-analyzer writes it via mergeWithStoredVerdict.
      responseVerdict: null,
      // Issue #131 — same; the SW thinking-analyzer writes the slot.
      thinkingVerdict: null,
      embeddingsFindings: null,
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
    webgpuAdapterMode,
    stamp: null,
    // Issue #112 — orchestrator overwrites via {...verdict0, perChunkAnalysis};
    // null here keeps the type complete for engine-only callers and tests.
    perChunkAnalysis: null,
    // Issue #122 — orchestrator overwrites via spread; null here keeps the
    // type complete for engine-only callers.
    entitySummary: null,
    // Issue #126 — engine-only callers never produce a response verdict.
    responseVerdict: null,
    // Issue #131 — same for the thinking verdict slot.
    thinkingVerdict: null,
    // Issue #129 Stage 5 — orchestrator overwrites via spread when chunks
    // produced findings; null here matches the perChunkAnalysis default for
    // engine-only callers.
    embeddingsFindings: null,
  };
}
