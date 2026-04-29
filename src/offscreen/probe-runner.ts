import type { ProbeResult } from '@/types/verdict.js';
import { createLogger } from '@/shared/logger.js';
import { generateCompletion } from './engine.js';
import { summarizationProbe } from '@/probes/summarization.js';
import { instructionDetectionProbe } from '@/probes/instruction-detection.js';
import { adversarialComplianceProbe } from '@/probes/adversarial-compliance.js';
import { evidenceReviewProbe } from '@/probes/evidence-review.js';
import type { EvidencePacket, Probe } from '@/probes/base-probe.js';

const log = createLogger('ProbeRunner');

const FULL_STACK_PROBES: readonly Probe[] = [
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

async function runOneProbe(
  probe: Probe,
  systemPrompt: string,
  userMessage: string,
  originalChunk: string,
): Promise<ProbeResult> {
  log.info(`Running probe: ${probe.name}`);
  try {
    const rawOutput = await generateCompletion(systemPrompt, userMessage, {
      responseConstraint: probe.responseConstraintSchema,
    });
    const analysis = probe.analyzeResponse(rawOutput, originalChunk);
    log.info(`Probe ${probe.name}: ${analysis.passed ? 'PASS' : 'FAIL'} (score: ${analysis.score})`);
    return {
      probeName: probe.name,
      passed: analysis.passed,
      flags: analysis.flags,
      rawOutput,
      score: analysis.score,
      errorMessage: null,
    };
  } catch (err) {
    // Phase 4 Stage 4A — propagate the engine error as a structured field
    // instead of stamping a `probe_error` flag with passed:true/score:0,
    // which the scoring engine used to evaluate as CLEAN+confidence=1.0.
    const errorMessage = errorToMessage(err);
    log.error(`Probe ${probe.name} failed: ${errorMessage}`);
    return {
      probeName: probe.name,
      passed: false,
      flags: [],
      rawOutput: '',
      score: 0,
      errorMessage,
    };
  }
}

/**
 * Issue #118 (N12) — branch on whether Hunter findings produced packets.
 *
 * - Non-empty `evidencePackets`: run `evidence-review` per packet (replaces
 *   instruction-detection + adversarial-compliance for this chunk) plus
 *   `summarization` on the full chunk. The packet-bearing path is the
 *   focused-context payoff of #112's Hunter wiring.
 * - Empty/absent `evidencePackets`: run the existing 3-probe stack on the
 *   full chunk. This is the fall-through for chunks that the Hunters
 *   marked non-BENIGN but produced no usable activations (Hawk-only
 *   chunk-level signal). Preserves coverage for novel content.
 */
export async function runProbes(
  chunk: string,
  evidencePackets: readonly EvidencePacket[] = [],
): Promise<readonly ProbeResult[]> {
  if (evidencePackets.length === 0) {
    const results: ProbeResult[] = [];
    for (const probe of FULL_STACK_PROBES) {
      results.push(await runOneProbe(probe, probe.systemPrompt, probe.buildUserMessage(chunk), chunk));
    }
    return results;
  }

  const results: ProbeResult[] = [];
  for (const packet of evidencePackets) {
    const userMessage = evidenceReviewProbe.buildPacketMessage!(packet);
    results.push(
      await runOneProbe(evidenceReviewProbe, evidenceReviewProbe.systemPrompt, userMessage, packet.flagged),
    );
  }
  // Summarization always runs on the full chunk for general anomaly coverage
  // (e.g. encoding-density spikes outside the flagged spans).
  results.push(
    await runOneProbe(summarizationProbe, summarizationProbe.systemPrompt, summarizationProbe.buildUserMessage(chunk), chunk),
  );
  return results;
}
