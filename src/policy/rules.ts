import type { ProbeResult, BehavioralFlags } from '@/types/verdict.js';
import {
  SCORE_SUMMARIZATION_ANOMALY,
  SCORE_INSTRUCTION_DETECTION,
  SCORE_ADVERSARIAL_DIVERGENCE,
  SCORE_ROLE_DRIFT,
  SCORE_EXFILTRATION_INTENT,
  SCORE_HIDDEN_CONTENT_INSTRUCTIONS,
} from '@/shared/constants.js';

interface ScoringResult {
  readonly totalScore: number;
  readonly contributions: readonly { readonly rule: string; readonly score: number }[];
}

export function computeScore(
  probeResults: readonly ProbeResult[],
  behavioralFlags: BehavioralFlags,
): ScoringResult {
  const contributions: { rule: string; score: number }[] = [];

  const summarization = probeResults.find((r) => r.probeName === 'summarization');
  if (summarization && !summarization.passed) {
    contributions.push({
      rule: 'summarization_anomaly',
      score: Math.min(summarization.score, SCORE_SUMMARIZATION_ANOMALY),
    });
  }

  const detection = probeResults.find((r) => r.probeName === 'instruction_detection');
  if (detection && !detection.passed) {
    contributions.push({
      rule: 'instruction_detection',
      score: Math.min(detection.score, SCORE_INSTRUCTION_DETECTION),
    });
  }

  const adversarial = probeResults.find((r) => r.probeName === 'adversarial_compliance');
  if (adversarial && !adversarial.passed) {
    contributions.push({
      rule: 'adversarial_divergence',
      score: Math.min(adversarial.score, SCORE_ADVERSARIAL_DIVERGENCE),
    });
  }

  if (behavioralFlags.roleDrift) {
    contributions.push({ rule: 'role_drift', score: SCORE_ROLE_DRIFT });
  }

  if (behavioralFlags.exfiltrationIntent) {
    contributions.push({ rule: 'exfiltration_intent', score: SCORE_EXFILTRATION_INTENT });
  }

  if (behavioralFlags.hiddenContentAwareness) {
    contributions.push({
      rule: 'hidden_content_instructions',
      score: SCORE_HIDDEN_CONTENT_INSTRUCTIONS,
    });
  }

  const totalScore = contributions.reduce((sum, c) => sum + c.score, 0);

  return { totalScore, contributions };
}
