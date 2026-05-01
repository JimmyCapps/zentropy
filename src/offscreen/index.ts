import type {
  HoneyLLMMessage,
  EmbedResultMessage,
  LanguageResultMessage,
  LogEntryMessage,
  NerResultMessage,
  ParseHtmlResultMessage,
  ProbeResultsMessage,
  ProbeDirectResultMessage,
} from '@/types/messages.js';
import { createLogger, setLogSink, setLogSource, type LogEntry } from '@/shared/logger.js';

// Issue #218 — forward log entries to the SW so the unified log-viewer
// page can stream them. console.* output is preserved by the logger
// itself; the sink is purely the LogBus pipe.
setLogSource('offscreen');
setLogSink((entry: LogEntry) => {
  const msg: LogEntryMessage = { type: 'LOG_ENTRY', entry };
  chrome.runtime.sendMessage(msg).catch(() => {
    // SW asleep / disconnected. Console line is already on screen.
  });
});
import { isTestModeEnabled } from '@/shared/test-mode.js';
import { initEngine, generateCompletion, getLoadedModelId, getLoadedCanaryId, getWebGPUAdapterInfo } from './engine.js';
import { runProbes } from './probe-runner.js';
import { runDirectProbe, type DirectProbeDeps } from './direct-probe.js';
import { handleDetectLanguage } from './lang-detect-engine.js';
import { handleRunNer } from './ner-engine.js';
import { embedText } from './embedding-engine.js';
import { parseHtmlToSnapshot } from './parse-html.js';

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

  // Issue #119 (N14a) — language detection RPC. Replies via sendResponse
  // so the SW-side `language-router.ts` can `await chrome.runtime
  // .sendMessage(...)`. handleDetectLanguage is total: it never throws,
  // returning a graceful `und` result on any path.
  if (message.type === 'DETECT_LANGUAGE') {
    handleDetectLanguage(message.text)
      .then((result) => {
        const reply: LanguageResultMessage = { type: 'LANGUAGE_RESULT', result };
        sendResponse(reply);
      })
      .catch((err: unknown) => {
        log.error('handleDetectLanguage rejected unexpectedly', err);
        const reply: LanguageResultMessage = {
          type: 'LANGUAGE_RESULT',
          result: { lang: 'und', confidence: 0, source: 'chrome-api' },
        };
        sendResponse(reply);
      });
    return true; // keep channel open for async sendResponse
  }

  // Issue #156 — freeform NER RPC. Replies via sendResponse so the
  // SW-side `ner-router.ts` can `await chrome.runtime.sendMessage(...)`.
  // handleRunNer is total: returns [] on every failure path (load failure,
  // deadline miss, factory exception). Span offsets come back absolute over
  // the page text because `chunkOffset` is forwarded into handleRunNer.
  // Issue #130 (N7b) — synthetic-snapshot HTML parse RPC. Used by the
  // SW's url-scanner: fetched HTML lands here, gets parsed via DOMParser
  // (which the SW lacks), and returns a PageSnapshot the orchestrator
  // can consume unchanged. Reduced-fidelity layout filtering — the
  // detached document has no viewport.
  if (message.type === 'PARSE_HTML_REQUEST') {
    try {
      const snapshot = parseHtmlToSnapshot(message.html, message.url);
      const reply: ParseHtmlResultMessage = {
        type: 'PARSE_HTML_RESULT',
        requestId: message.requestId,
        snapshot,
        errorMessage: null,
      };
      sendResponse(reply);
    } catch (err: unknown) {
      log.error('parseHtmlToSnapshot threw', err);
      const reply: ParseHtmlResultMessage = {
        type: 'PARSE_HTML_RESULT',
        requestId: message.requestId,
        snapshot: null,
        errorMessage: err instanceof Error ? err.message : 'parse_failed',
      };
      sendResponse(reply);
    }
    return false; // synchronous reply
  }

  // Issue #129 Stage 4 — sentence-embedding RPC. SW-side
  // `embed-router.ts` invokes this; `embedText` is total (returns null on
  // empty input / model load failure / inference exception). We serialise
  // the Float32Array to `number[]` because chrome.runtime messages are
  // JSON-cloneable; the SW router rehydrates back to Float32Array. The
  // single RPC dispatch shape mirrors RUN_NER so the offscreen-doc has a
  // single consistent contract for the orchestrator's chunk loop.
  if (message.type === 'EMBED_TEXT') {
    const start = performance.now();
    embedText(message.text, message.mode === undefined ? undefined : { mode: message.mode })
      .then((vec) => {
        const reply: EmbedResultMessage = {
          type: 'EMBED_RESULT',
          embedding: vec === null ? null : Array.from(vec),
          inferenceMs: performance.now() - start,
        };
        sendResponse(reply);
      })
      .catch((err: unknown) => {
        log.error('embedText rejected unexpectedly', err);
        const reply: EmbedResultMessage = {
          type: 'EMBED_RESULT',
          embedding: null,
          inferenceMs: performance.now() - start,
        };
        sendResponse(reply);
      });
    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'RUN_NER') {
    const start = performance.now();
    handleRunNer(message.text, message.deadlineMs ?? 250, message.chunkOffset)
      .then((entities) => {
        const reply: NerResultMessage = {
          type: 'NER_RESULT',
          entities,
          inferenceMs: performance.now() - start,
        };
        sendResponse(reply);
      })
      .catch((err: unknown) => {
        log.error('handleRunNer rejected unexpectedly', err);
        const reply: NerResultMessage = {
          type: 'NER_RESULT',
          entities: [],
          inferenceMs: performance.now() - start,
        };
        sendResponse(reply);
      });
    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'RUN_PROBES') {
    const { tabId, chunk, chunkIndex, evidencePackets } = message;

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
      .then(() => runProbes(chunk, evidencePackets ?? []))
      .then((results) => {
        const response: ProbeResultsMessage = {
          type: 'PROBE_RESULTS',
          tabId,
          chunkIndex,
          results,
          canaryId: getLoadedCanaryId(),
          webgpuAdapterMode: getWebGPUAdapterInfo()?.mode ?? null,
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
          canaryId: getLoadedCanaryId(),
          webgpuAdapterMode: getWebGPUAdapterInfo()?.mode ?? null,
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

// Issue #156 — pre-warm the NER engine at offscreen-doc creation. The
// first call triggers the prebuilt-bundle import + ONNX session init +
// quantized model CDN fetch (~70 MB), which together can take several
// seconds. Pre-warming here means the model is more likely to be warm by
// the time the orchestrator's chunk loop dispatches RUN_NER. handleRunNer
// is total (returns []), so the rejection branch only fires on an
// unexpected failure — which we log and ignore. The 30-second deadline
// bounds the cold-load wait without blocking the offscreen doc.
handleRunNer('warmup', 30_000).catch((err: unknown) => {
  log.warn('NER pre-warm failed; first scan will load on demand', err);
});

// Issue #129 Stage 4 — pre-warm the embedding engine at offscreen-doc
// creation. Same rationale as the NER pre-warm: the first
// `intfloat/multilingual-e5-small` load fetches ~50 MB from the HF CDN
// and runs ONNX session init. `embedText` is total (returns null on
// every failure path); pre-warming amortises the cold load over SW
// startup so the orchestrator's first embed RPC sees a warm model.
embedText('warmup').catch((err: unknown) => {
  log.warn('Embedding pre-warm failed; first scan will load on demand', err);
});
