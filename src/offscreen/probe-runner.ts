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
      });

      log.info(`Probe ${probe.name}: ${analysis.passed ? 'PASS' : 'FAIL'} (score: ${analysis.score})`);
    } catch (err) {
      log.error(`Probe ${probe.name} failed`, err);
      results.push({
        probeName: probe.name,
        passed: true,
        flags: ['probe_error'],
        rawOutput: '',
        score: 0,
      });
    }
  }

  return results;
}
