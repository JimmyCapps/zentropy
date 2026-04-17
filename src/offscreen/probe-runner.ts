import type { ProbeResult } from '@/types/verdict.js';
import { createLogger } from '@/shared/logger.js';
import { generateCompletion } from './engine.js';
import { summarizationProbe } from '@/probes/summarization.js';
import { instructionDetectionProbe } from '@/probes/instruction-detection.js';
import { adversarialComplianceProbe } from '@/probes/adversarial-compliance.js';
import type { Probe } from '@/probes/base-probe.js';

const log = createLogger('ProbeRunner');

const PROBES: readonly Probe[] = [
  summarizationProbe,
  instructionDetectionProbe,
  adversarialComplianceProbe,
];

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

export async function runProbes(chunk: string): Promise<readonly ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const probe of PROBES) {
    log.info(`Running probe: ${probe.name}`);

    try {
      const userMessage = probe.buildUserMessage(chunk);
      const rawOutput = await generateCompletion(probe.systemPrompt, userMessage);
      const analysis = probe.analyzeResponse(rawOutput, chunk);

      results.push({
        probeName: probe.name,
        passed: analysis.passed,
        flags: analysis.flags,
        rawOutput,
        score: analysis.score,
        errorMessage: null,
      });

      log.info(`Probe ${probe.name}: ${analysis.passed ? 'PASS' : 'FAIL'} (score: ${analysis.score})`);
    } catch (err) {
      // Phase 4 Stage 4A — propagate the engine error as a structured field
      // instead of stamping a `probe_error` flag with passed:true/score:0,
      // which the scoring engine used to evaluate as CLEAN+confidence=1.0.
      // Downstream (orchestrator/policy) aggregates errorMessage into the
      // verdict's analysisError and emits UNKNOWN when all probes errored.
      const errorMessage = errorToMessage(err);
      log.error(`Probe ${probe.name} failed: ${errorMessage}`);
      results.push({
        probeName: probe.name,
        passed: false,
        flags: [],
        rawOutput: '',
        score: 0,
        errorMessage,
      });
    }
  }

  return results;
}
