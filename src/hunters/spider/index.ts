import type { Hunter, HunterResult } from '../base-hunter.js';
import { cleanResult } from '../base-hunter.js';
import { SCORE_INSTRUCTION_DETECTION } from '@/shared/constants.js';
import { scanText } from './patterns.js';

/**
 * Spider — deterministic pattern hunter. See patterns.ts for the rule
 * catalog. When a pattern matches, Spider is confident (confidence=1.0)
 * because the regex rules are intentionally tuned for near-zero false
 * positives on real-world content.
 *
 * Spider scores at SCORE_INSTRUCTION_DETECTION (40) on match, matching
 * the weight given to the LLM-based instructionDetectionProbe. A Spider
 * match is therefore as load-bearing as a Canary match, which is
 * justified only because Spider's false-positive rate is near-zero by
 * construction.
 */
export const spiderHunter: Hunter = {
  name: 'spider',

  async scan(chunk: string): Promise<HunterResult> {
    const match = scanText(chunk);

    if (!match.matched) {
      return cleanResult('spider');
    }

    return {
      hunterName: 'spider',
      matched: true,
      flags: [`spider:${match.category}`, `pattern:${match.pattern}`],
      score: SCORE_INSTRUCTION_DETECTION,
      confidence: 1.0,
      features: [
        {
          name: match.category,
          weight: 1.0,
          activations: [match.pattern],
        },
      ],
      errorMessage: null,
    };
  },
};
