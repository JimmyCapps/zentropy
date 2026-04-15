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

export function evaluatePolicy(
  probeResults: readonly ProbeResult[],
  behavioralFlags: BehavioralFlags,
  url: string,
): SecurityVerdict {
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
  };
}
