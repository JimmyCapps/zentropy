import type { FeatureRun } from './features.js';
import { THRESHOLD_SUSPICIOUS, THRESHOLD_COMPROMISED } from '@/shared/constants.js';

/**
 * Hawk v1 classifier — weighted-feature scoring with sigmoid calibration.
 *
 * Hawk v1 is intentionally *not* an ONNX model. ai-page-guard's production
 * extension uses Prompt Guard 22M (ONNX, 69MB bundled) but adopting that
 * here requires adding @huggingface/transformers as a runtime dependency
 * (James's call). Hawk v2 swaps the scoring function for an ONNX call
 * without changing the hunter interface.
 */

/**
 * Logistic-regression bias. Tuned so zero features produce p ≈ 0.30
 * (below P_MATCH), one strong feature yields p ≈ 0.51 (weak match only),
 * and three-plus features combining push into the COMPROMISED band.
 */
const LOGISTIC_BIAS = -0.85;

/**
 * Probability → score mapping breakpoints. Chosen so Hawk's output
 * composes with THRESHOLD_SUSPICIOUS (30) and THRESHOLD_COMPROMISED (65)
 * from src/shared/constants.ts.
 *
 * P_COMPROMISED is re-used by hunt-runner.ts as the short-circuit
 * confidence threshold; P_MATCH and P_SUSPICIOUS are internal to the
 * score mapping but exported for visibility and tests.
 */
export const P_MATCH = 0.4;
export const P_SUSPICIOUS = 0.55;
export const P_COMPROMISED = 0.75;

export interface ClassifierResult {
  readonly probability: number;
  readonly score: number;
  readonly contributingFeatures: readonly FeatureRun[];
}

function logisticAggregate(features: readonly FeatureRun[]): number {
  const logit = features.reduce((sum, f) => sum + f.activation * f.weight, LOGISTIC_BIAS);
  return 1 / (1 + Math.exp(-logit));
}

function probabilityToScore(p: number): number {
  if (p < P_MATCH) return 0;
  if (p < P_SUSPICIOUS) return 15;
  if (p < P_COMPROMISED) return THRESHOLD_SUSPICIOUS + 5;
  return THRESHOLD_COMPROMISED;
}

export function classify(features: readonly FeatureRun[]): ClassifierResult {
  if (features.length === 0) {
    return { probability: 0, score: 0, contributingFeatures: [] };
  }

  const probability = logisticAggregate(features);
  const score = probabilityToScore(probability);

  return { probability, score, contributingFeatures: features };
}
