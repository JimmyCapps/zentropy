import { instructionDetectionProbe } from '../../../src/probes/instruction-detection.js';
import { SCORE_INSTRUCTION_DETECTION } from '../../../src/shared/constants.js';
import type { LlmEndpoint } from './llm-endpoint.js';

export interface ProbeRunResult {
  readonly probeName: string;
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly score: number;
  readonly confidence: number;
  readonly errorMessage: string | null;
}

export async function runInstructionDetectionCanary(
  text: string,
  endpoint: LlmEndpoint,
): Promise<ProbeRunResult> {
  try {
    const userMessage = instructionDetectionProbe.buildUserMessage(text);
    const result = await endpoint.call({
      systemPrompt: instructionDetectionProbe.systemPrompt,
      userMessage,
    });
    const analysis = instructionDetectionProbe.analyzeResponse(result.content, text);
    const confidence = analysis.passed
      ? 0
      : Math.max(0, Math.min(1, analysis.score / SCORE_INSTRUCTION_DETECTION));
    return {
      probeName: instructionDetectionProbe.name,
      passed: analysis.passed,
      flags: analysis.flags,
      score: analysis.score,
      confidence,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      probeName: instructionDetectionProbe.name,
      passed: false,
      flags: [],
      score: 0,
      confidence: 0,
      errorMessage: message,
    };
  }
}
