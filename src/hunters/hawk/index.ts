import type { Hunter, HunterResult } from '../base-hunter.js';
import { cleanResult, errorResult } from '../base-hunter.js';
import { extractAllFeatures } from './features.js';
import { classify, type ClassifierResult } from './classifier.js';
import { chunkByWords } from './chunking.js';

/**
 * Hawk v1 — feature-based prompt-injection classifier with chunk-level
 * scoring.
 *
 * Scores raw content directly (no LLM, no round-trip to canary). Unlike
 * Spider's exact-pattern matching, Hawk combines density / ratio / Unicode
 * / imperative / boundary signals into a calibrated probability.
 *
 * Chunk-level scoring: the scanned text is split into sliding windows
 * (see chunking.ts) and each window is scored independently; the final
 * score is the MAX across chunks. This preserves the signal when a
 * small injection payload is embedded in a much larger benign page —
 * which is what real-world attacks look like.
 */
export const hawkHunter: Hunter = {
  name: 'hawk',

  async scan(chunk: string): Promise<HunterResult> {
    try {
      const windows = chunkByWords(chunk);
      let best: ClassifierResult = { probability: 0, score: 0, contributingFeatures: [] };

      for (const window of windows) {
        const features = extractAllFeatures(window);
        const result = classify(features);
        if (result.score > best.score) best = result;
      }

      if (best.score === 0) return cleanResult('hawk');

      const hunterFeatures = best.contributingFeatures.map((f) => ({
        name: f.name,
        weight: f.activation * f.weight,
        activations: f.excerpts,
      }));

      const flags = [
        'hawk:injection_likely',
        ...best.contributingFeatures.map((f) => `hawk:${f.name}`),
      ];

      return {
        hunterName: 'hawk',
        matched: true,
        flags,
        score: best.score,
        confidence: best.probability,
        features: hunterFeatures,
        errorMessage: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult('hawk', message);
    }
  },
};
