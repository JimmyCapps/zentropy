import type {
  HoneyLLMMessage,
  ProbeBuiltinResultMessage,
} from '@/types/messages.js';
import { isTestModeEnabled } from '@/shared/test-mode.js';
import { createLogger } from '@/shared/logger.js';
import {
  runBuiltinProbe,
  defaultCreateOptions,
  type BuiltinProbeDeps,
  type LanguageModelFacade,
} from './builtin-probe.js';

const log = createLogger('builtin-harness');

/**
 * Phase 3 Track A Path 2 — window-context harness for Chrome's built-in
 * Prompt API (Gemini Nano). This page exists solely for the Stage 5
 * Playwright runner + manual Stage 4d smoke; it has no production role.
 *
 * Gated via the `honeyllm:test-mode` storage flag in `runBuiltinProbe`.
 * When the flag is absent/false, every incoming `RUN_PROBE_BUILTIN` message
 * resolves with `skipped:true, skippedReason:'test-mode-disabled'`.
 */

function getLanguageModel(): LanguageModelFacade | null {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelFacade };
  return g.LanguageModel ?? null;
}

const defaultDeps: BuiltinProbeDeps = {
  isTestModeEnabled,
  getLanguageModel,
  now: () => performance.now(),
  createOptions: defaultCreateOptions,
};

function buildHelperRejectionResult(
  message: { requestId: string; probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance' },
  err: unknown,
): ProbeBuiltinResultMessage {
  return {
    type: 'PROBE_BUILTIN_RESULT',
    requestId: message.requestId,
    probeName: message.probeName,
    engineRuntime: 'chrome-builtin-prompt-api',
    engineModel: 'chrome-builtin-gemini-nano',
    rawOutput: '',
    inferenceMs: 0,
    firstCreateMs: null,
    availability: null,
    skipped: false,
    skippedReason: null,
    errorMessage: `runBuiltinProbe rejected (bug): ${err instanceof Error ? err.message : String(err)}`,
  };
}

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage, _sender, sendResponse) => {
  // runBuiltinProbe is TOTAL — it catches every error path internally and
  // always resolves. A rejection here would indicate a regression in the
  // helper. We still catch defensively so the Stage 5 runner never hangs
  // on the unclosed message channel, and the errorMessage prefix makes
  // the "helper bug" condition greppable in row data.
  if (message.type === 'RUN_PROBE_BUILTIN') {
    runBuiltinProbe(message, defaultDeps)
      .then((result: ProbeBuiltinResultMessage) => sendResponse(result))
      .catch((err: unknown) => {
        log.error('runBuiltinProbe rejected unexpectedly', err);
        sendResponse(buildHelperRejectionResult(message, err));
      });
    return true; // keep channel open for async sendResponse
  }
  return undefined;
});

const statusEl = document.getElementById('harness-status');
if (statusEl !== null) {
  statusEl.textContent = `harness ready — LanguageModel=${getLanguageModel() === null ? 'absent' : 'present'}`;
}
