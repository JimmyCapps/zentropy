import type {
  HoneyLLMMessage,
  ProbeResultsMessage,
  ProbeDirectResultMessage,
} from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';
import { isTestModeEnabled } from '@/shared/test-mode.js';
import { initEngine, generateCompletion, getLoadedModelId } from './engine.js';
import { runProbes } from './probe-runner.js';
import { runDirectProbe, type DirectProbeDeps } from './direct-probe.js';

const log = createLogger('Offscreen');

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'honeyllm-offscreen-keepalive') {
    log.debug('Keepalive port connected');
    port.onDisconnect.addListener(() => {
      log.debug('Keepalive port disconnected');
    });
  }
});

interface MinimalGPUAdapter {
  readonly info?: { readonly architecture?: string };
}

interface MinimalGPU {
  requestAdapter(): Promise<MinimalGPUAdapter | null>;
}

async function getGpuAdapterArchitecture(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGPU }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter?.info?.architecture ?? null;
  } catch {
    return null;
  }
}

const directProbeDeps: DirectProbeDeps = {
  isTestModeEnabled,
  getGpuAdapterArchitecture,
  callEngine: async (systemPrompt, userMessage) => {
    // Ensure engine is initialised before timing. initEngine() is idempotent
    // and caches after first success; subsequent calls resolve immediately.
    await initEngine();
    return generateCompletion(systemPrompt, userMessage);
  },
  getLoadedModelId,
  now: () => performance.now(),
};

function buildDirectRejectionResult(
  message: { requestId: string; probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance' },
  err: unknown,
): ProbeDirectResultMessage {
  return {
    type: 'PROBE_DIRECT_RESULT',
    requestId: message.requestId,
    probeName: message.probeName,
    engineRuntime: 'mlc-webllm-webgpu',
    engineModel: getLoadedModelId() ?? 'unknown',
    rawOutput: '',
    inferenceMs: 0,
    firstLoadMs: null,
    webgpuBackendDetected: null,
    skipped: false,
    skippedReason: null,
    errorMessage: `runDirectProbe rejected (bug): ${err instanceof Error ? err.message : String(err)}`,
  };
}

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage, _sender, sendResponse) => {
  // Phase 3 Track A Path 1 — test-only direct probe. Returns via sendResponse
  // so the Playwright runner can use `chrome.runtime.sendMessage(...).then(resp)`
  // as a native RPC. Gated in runDirectProbe; inert in production.
  //
  // runDirectProbe is TOTAL — it catches every error path internally and
  // always resolves. A rejection here would indicate a regression in the
  // helper. We still catch defensively so the Stage 5 runner never hangs
  // on the unclosed message channel, and the errorMessage prefix makes
  // the "helper bug" condition greppable in row data.
  if (message.type === 'RUN_PROBE_DIRECT') {
    runDirectProbe(message, directProbeDeps)
      .then((result: ProbeDirectResultMessage) => sendResponse(result))
      .catch((err: unknown) => {
        log.error('runDirectProbe rejected unexpectedly', err);
        sendResponse(buildDirectRejectionResult(message, err));
      });
    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'RUN_PROBES') {
    const { tabId, chunk, chunkIndex } = message;

    log.info(`Running probes for tab ${tabId}, chunk ${chunkIndex}`);

    // Phase 4 Stage 4B.3 — gate RUN_PROBES on engine-ready. The prior
    // implementation delegated engine readiness to the probe chain via
    // generateCompletion → getEngine → initEngine, which let concurrent
    // probe calls race each other during the cold-load window and return
    // partial/empty results that looked like "CLEAN, score=0, conf=0.87".
    // Explicit gate here plus the single-flight promise in engine.ts makes
    // the first-cell behaviour deterministic: all N probes run against a
    // fully-initialised engine, or the whole chunk returns probe errors
    // that flow into the 4A UNKNOWN branch.
    initEngine()
      .then(() => runProbes(chunk))
      .then((results) => {
        const response: ProbeResultsMessage = {
          type: 'PROBE_RESULTS',
          tabId,
          chunkIndex,
          results,
        };
        chrome.runtime.sendMessage(response);
      })
      .catch((err) => {
        log.error('Probe execution failed', err);
        // Emit a synthesised PROBE_RESULTS with all probes marked errored,
        // so the orchestrator's 4A aggregate-error path produces UNKNOWN
        // rather than leaving the SW listener hanging until timeout.
        const errorMessage = err instanceof Error ? err.message : String(err);
        const response: ProbeResultsMessage = {
          type: 'PROBE_RESULTS',
          tabId,
          chunkIndex,
          results: [
            { probeName: 'summarization', passed: false, flags: [], rawOutput: '', score: 0, errorMessage },
            { probeName: 'instruction_detection', passed: false, flags: [], rawOutput: '', score: 0, errorMessage },
            { probeName: 'adversarial_compliance', passed: false, flags: [], rawOutput: '', score: 0, errorMessage },
          ],
        };
        chrome.runtime.sendMessage(response);
      });
  }
});

initEngine().catch((err) => {
  log.error('Engine initialization failed', err);
  chrome.runtime.sendMessage({
    type: 'ENGINE_STATUS',
    status: 'error',
    error: String(err),
  });
});
