import type { SecurityVerdict, AISecurityReport } from '@/types/verdict.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('WindowGlobals');

function buildReport(verdict: SecurityVerdict): AISecurityReport {
  const summarization = verdict.probeResults.find((r) => r.probeName === 'summarization');
  const detection = verdict.probeResults.find((r) => r.probeName === 'instruction_detection');
  const adversarial = verdict.probeResults.find((r) => r.probeName === 'adversarial_compliance');

  return {
    status: verdict.status,
    confidence: verdict.confidence,
    timestamp: verdict.timestamp,
    url: verdict.url,
    probes: {
      summarization: {
        passed: summarization?.passed ?? true,
        flags: [...(summarization?.flags ?? [])],
      },
      instructionDetection: {
        passed: detection?.passed ?? true,
        found: [...(detection?.flags ?? [])],
      },
      adversarialCompliance: {
        passed: adversarial?.passed ?? true,
        flags: [...(adversarial?.flags ?? [])],
      },
    },
    analysis: {
      roleDrift: verdict.behavioralFlags.roleDrift,
      exfiltrationIntent: verdict.behavioralFlags.exfiltrationIntent,
      instructionFollowing: verdict.behavioralFlags.instructionFollowing,
    },
    mitigationsApplied: [...verdict.mitigationsApplied],
    analysisError: verdict.analysisError,
    canaryId: verdict.canaryId,
    webgpuAdapterMode: verdict.webgpuAdapterMode,
  };
}

export function setWindowGlobals(verdict: SecurityVerdict): void {
  const report = buildReport(verdict);

  window.postMessage(
    {
      type: 'HONEYLLM_SET_STATUS',
      status: verdict.status,
      report,
    },
    '*',
  );

  log.info(`Window globals set: __AI_SITE_STATUS__ = ${verdict.status}`);
}
