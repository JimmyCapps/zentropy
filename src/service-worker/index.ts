import type {
  HoneyLLMMessage,
  InterceptVerdict,
  InterceptVerdictMessage,
  VerifyStampResultMessage,
} from '@/types/messages.js';
import { STORAGE_KEY_PENDING_INTERCEPT, MAX_INTERCEPT_LATENCY_MS } from '@/shared/constants.js';
import { createLogger, setLogSink, setLogSource } from '@/shared/logger.js';
import { LogBus, LOG_PORT_NAME } from '@/shared/log-bus.js';
import { startKeepalive } from './keepalive.js';
import { analyzeSnapshot, AnalysisAbortedError, getInFlightCount, getInFlightTabIds } from './orchestrator.js';
import { analyzeResponse } from './response-analyzer.js';
import { analyzeThinking } from './thinking-analyzer.js';
import { setTabVerdict, handleTabActivated, handleTabRemoved } from './toolbar-icon.js';
import { ensureInstallSecret } from '@/shared/install-secret.js';
import { verifyStamp } from './stamp.js';
import {
  dispatchVerdictMessages,
  handleRescanWithMitigation,
  handleRescanPage,
  handleTabRemovedForDispatch,
} from './dispatch.js';
import { scanUrl } from './url-scanner.js';
import { loadRegistryOnce } from '@/registry/lookup.js';
import { bootstrapEmbeddingsHunter } from './embeddings-bootstrap.js';

// Issue #218 — log bus + viewer-page port plumbing. The bus is module-
// scoped so it survives onMessage / onConnect re-registration on every
// SW wakeup; chrome.runtime.* listeners are added below at top-level so
// MV3's "register synchronously" requirement is met. Sink + source are
// configured before the first createLogger so the bootstrap log lines
// are captured.
const logBus = new LogBus();
setLogSource('sw');
setLogSink((entry) => logBus.push(entry));

const log = createLogger('ServiceWorker');

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === LOG_PORT_NAME) {
    logBus.connect(port);
  }
});

// Issue #117 (N13) — bootstrap the per-install HMAC secret on every
// SW wakeup. ensureInstallSecret is read-before-write idempotent, so
// onInstalled (which fires on every UPDATE, not just first install)
// will not rotate the secret. Errors are logged at warn — the call
// will be retried on the first VERIFY_STAMP / verdict-stamping path.
function bootstrapInstallSecret(): void {
  ensureInstallSecret().catch((err) => {
    log.warn('Install secret bootstrap failed; will retry on first use', err);
  });
}

// SR-F (registry-#51) — bootstrap the signed site-structure registry on
// every SW wakeup. loadRegistryOnce is idempotent (cached promise) and
// fail-safe: any of fetch-404 / parse-error / verify-fail leaves the
// cached bundle null, so lookupRegistry misses for the rest of the SW
// lifetime and analyzeSnapshot falls through to full analysis. Doing
// the load + verify once at startup amortises the ~5 ms verify cost
// over the SW's lifetime instead of paying it on the first PAGE_SNAPSHOT.
function bootstrapRegistry(): void {
  loadRegistryOnce().catch((err) => {
    log.warn('Registry bootstrap failed; treating as MISS for SW lifetime', err);
  });
}

// Issue #129 Stage 4 — bootstrap the embeddings Hunter on every SW wakeup.
// Loads the populated injection corpus from `dist/data/injection-corpus.json`,
// builds the in-memory cosine-similarity index, and wires the offscreen
// EMBED_TEXT bridge as the chunk embed function. bootstrapEmbeddingsHunter
// is idempotent + single-flight; any failure path (corpus missing / parse
// error / unexpected throw) falls back to the Stage 3 no-op hunter so the
// Phase 2 byte-locked baseline is preserved.
function bootstrapEmbeddings(): void {
  bootstrapEmbeddingsHunter().catch((err) => {
    log.warn('Embeddings bootstrap failed; staying as no-op for SW lifetime', err);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  log.info('HoneyLLM installed');
  startKeepalive();
  bootstrapInstallSecret();
  bootstrapRegistry();
  bootstrapEmbeddings();
});

chrome.runtime.onStartup.addListener(() => {
  log.info('HoneyLLM startup');
  startKeepalive();
  bootstrapInstallSecret();
  bootstrapRegistry();
  bootstrapEmbeddings();
});

// Phase 4 Stage 4D.4 — per-tab icon state lifecycle hooks.
chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId);
  // Issue #230 — drop the per-tab dedup entry so a future tab reusing the same
  // numeric id (Chrome recycles ids over the SW lifetime) starts fresh.
  handleTabRemovedForDispatch(tabId);
});

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage, sender, sendResponse) => {
  switch (message.type) {
    case 'PAGE_SNAPSHOT': {
      const tabId = sender.tab?.id ?? message.tabId;
      if (tabId === undefined) {
        log.warn('Received PAGE_SNAPSHOT without tab ID');
        return;
      }

      // Issue #113 (N2) — forceMitigation propagates from TRIGGER_RESCAN
      // through the content script's re-sent PAGE_SNAPSHOT. When true,
      // the dispatch helper bypasses the testing-mode gate for this
      // single verdict only; the persisted toggle is not mutated.
      const forceMitigation = message.forceMitigation === true;
      analyzeSnapshot(tabId, message.snapshot)
        .then(async (verdict) => {
          setTabVerdict(tabId, verdict.status);
          await dispatchVerdictMessages(tabId, verdict, forceMitigation);
        })
        .catch((err) => {
          // Issue #11 — an abort from a newer PAGE_SNAPSHOT is expected,
          // not an error. Log at info level and skip the verdict send
          // since the newer analysis will produce its own verdict.
          if (err instanceof AnalysisAbortedError) {
            log.info(`Analysis for tab ${tabId} superseded: ${err.message}`);
            return;
          }
          log.error('Analysis failed', err);
        });

      return;
    }

    // Issue #126 (N7a) — chat-portal observers dispatch RESPONSE_CAPTURED
    // when an assistant response finishes streaming. The analyzer reuses
    // the existing 3-probe stack against the response text and writes a
    // ResponseVerdict onto the per-origin record. No mitigations.
    case 'RESPONSE_CAPTURED': {
      const tabId = sender.tab?.id ?? message.tabId;
      if (tabId === undefined) {
        log.warn('Received RESPONSE_CAPTURED without tab ID');
        return;
      }
      analyzeResponse(tabId, message.capture, message.metadata).catch((err) => {
        log.error('Response analysis failed', err);
      });
      return;
    }

    // Issue #131 (N7c) — chat-portal thinking observers dispatch
    // THINKING_CAPTURED when an assistant reasoning block finishes
    // streaming. Distinct analyzer + telemetry slot from #126 so a
    // CLEAN response with SUSPICIOUS thinking is visibly different in
    // the popup. No mitigations.
    case 'THINKING_CAPTURED': {
      const tabId = sender.tab?.id ?? message.tabId;
      if (tabId === undefined) {
        log.warn('Received THINKING_CAPTURED without tab ID');
        return;
      }
      analyzeThinking(tabId, message.capture, message.metadata).catch((err) => {
        log.error('Thinking analysis failed', err);
      });
      return;
    }

    // Issue #130 (N7b) — pre-send URL intercept. Scan the URL, record a
    // pending-intercept entry for the popup, send back INTERCEPT_VERDICT
    // when ready, and clear pending on CLEAN. SUSPICIOUS/COMPROMISED/
    // UNKNOWN verdicts leave the pending record in place so the popup
    // can render Send-anyway / Cancel / (Wait) UX.
    case 'INTERCEPT_SCAN_REQUEST': {
      const tabId = sender.tab?.id ?? message.tabId;
      void handleInterceptScanRequest(tabId, message);
      return;
    }

    case 'PING_KEEPALIVE': {
      sendResponse({ type: 'PONG_KEEPALIVE' });
      return;
    }

    case 'ENGINE_STATUS': {
      log.info(`Engine status: ${message.status}`, message.progress ?? '');
      return;
    }

    // Issue #218 — log forwarding from offscreen / content / popup.
    // Push directly into the bus; do not re-emit via createLogger to
    // avoid double-counting (the sender already wrote to its own
    // console).
    case 'LOG_ENTRY': {
      logBus.push(message.entry);
      return;
    }

    // Issue #117 (N13) — VERIFY_STAMP is registered on onMessage ONLY,
    // never onMessageExternal. The local harness already reaches
    // onMessageExternal for HONEYLLM_STATUS_PING (see below); exposing
    // stamp verification there would let the harness use HoneyLLM as
    // an HMAC oracle against the install secret. Internal channel only.
    // Issue #113 (N2) — popup-triggered rescan with mitigations forced
    // on for one run, regardless of the testing-mode flag. The handler
    // fans out a TRIGGER_RESCAN to the target tab; the content script
    // re-extracts the snapshot and re-sends PAGE_SNAPSHOT with
    // forceMitigation=true, which bypasses the gate at dispatch time.
    case 'RESCAN_WITH_MITIGATION': {
      handleRescanWithMitigation(message.tabId);
      return;
    }

    // Issue #114 (N3) — generic popup rescan. Re-runs the orchestrator
    // pipeline against the named tab without forcing mitigations; the
    // testing-mode gate in dispatchVerdictMessages applies normally.
    case 'RESCAN_PAGE': {
      handleRescanPage(message.tabId);
      return;
    }

    case 'VERIFY_STAMP': {
      ensureInstallSecret()
        .then((secret) => verifyStamp(message.stamp, secret, message.currentUrl))
        .then((result) => {
          const response: VerifyStampResultMessage = {
            type: 'VERIFY_STAMP_RESULT',
            result,
          };
          sendResponse(response);
        })
        .catch((err) => {
          log.error('VERIFY_STAMP handler failed', err);
          const response: VerifyStampResultMessage = {
            type: 'VERIFY_STAMP_RESULT',
            result: { valid: false, mismatchReason: 'malformed' },
          };
          sendResponse(response);
        });
      // Returning true keeps the message port open for the async sendResponse.
      return true;
    }

    default:
      return;
  }
});

/**
 * External status-ping from the local harness (http://127.0.0.1:8765).
 * Lets the harness show an amber start button when the extension is
 * currently analysing another page, so the user can decide whether
 * to tolerate the contention.
 *
 * externally_connectable in manifest.json restricts the origin.
 *
 * SECURITY (issue #117): VERIFY_STAMP is deliberately NOT handled here.
 * Even though the harness origin is in externally_connectable, exposing
 * stamp verification on this channel would let the harness use
 * HoneyLLM as an HMAC oracle against the install secret (feed
 * arbitrary stamps, observe valid|wrong-secret, narrow toward the
 * secret). Internal `chrome.runtime.onMessage` only.
 */
async function handleInterceptScanRequest(
  tabId: number | undefined,
  message: { url: string; origin: string; portalId: 'chatgpt' | 'claude' | 'gemini'; requestId: string },
): Promise<void> {
  const startedAt = Date.now();
  // Mark a transient pending-intercept record so the popup, if opened,
  // can show "scanning…" state before the verdict resolves.
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_PENDING_INTERCEPT]: {
        requestId: message.requestId,
        portalId: message.portalId,
        portalOrigin: message.origin,
        scannedUrl: message.url,
        status: 'scanning',
        verdict: null,
        startedAt,
        timeoutAt: startedAt + MAX_INTERCEPT_LATENCY_MS,
        timeoutExtended: false,
      },
    });
  } catch (err) {
    log.warn('Failed to write pending-intercept record', err);
  }

  let verdict: InterceptVerdict;
  try {
    verdict = await scanUrl({
      url: message.url,
      origin: message.origin,
      portalId: message.portalId,
      tabId: tabId ?? -1,
    });
  } catch (err) {
    log.error('scanUrl threw', err);
    verdict = {
      status: 'UNKNOWN',
      scannedUrl: message.url,
      probeBreakdown: { totalProbes: 0, suspiciousProbes: 0, compromisedProbes: 0 },
      totalScore: 0,
      cacheHit: false,
      timestamp: Date.now(),
      analysisError: err instanceof Error ? err.message : 'scan_threw',
    };
  }

  // Update or clear the pending-intercept record. CLEAN verdicts auto-clear
  // (no user action needed); other statuses keep the record so the popup
  // can render Send-anyway / Cancel.
  try {
    if (verdict.status === 'CLEAN') {
      await chrome.storage.local.remove(STORAGE_KEY_PENDING_INTERCEPT);
    } else {
      await chrome.storage.local.set({
        [STORAGE_KEY_PENDING_INTERCEPT]: {
          requestId: message.requestId,
          portalId: message.portalId,
          portalOrigin: message.origin,
          scannedUrl: message.url,
          status: 'verdict-ready',
          verdict,
          startedAt,
          timeoutAt: startedAt + MAX_INTERCEPT_LATENCY_MS,
          timeoutExtended: false,
        },
      });
    }
  } catch (err) {
    log.warn('Failed to update pending-intercept record', err);
  }

  // Send the verdict back to the originating tab.
  if (tabId !== undefined && tabId >= 0) {
    const verdictMsg: InterceptVerdictMessage = {
      type: 'INTERCEPT_VERDICT',
      requestId: message.requestId,
      verdict,
    };
    try {
      await chrome.tabs.sendMessage(tabId, verdictMsg);
    } catch {
      // Tab may have closed or content script may not be listening yet —
      // popup will pick up the verdict from storage on next open.
    }
  }
}

chrome.runtime.onMessageExternal.addListener((message: unknown, _sender, sendResponse) => {
  if (message === null || typeof message !== 'object' || !('type' in message)) return;
  const msg = message as { type: unknown };
  if (msg.type !== 'HONEYLLM_STATUS_PING') return;
  const inFlight = getInFlightCount();
  const tabIds = getInFlightTabIds();
  sendResponse({
    type: 'HONEYLLM_STATUS_PONG',
    analysing: inFlight > 0,
    inFlightCount: inFlight,
    inFlightTabIds: tabIds,
  });
  return true;
});
