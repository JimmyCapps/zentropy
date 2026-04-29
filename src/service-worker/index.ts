import type {
  HoneyLLMMessage,
  VerifyStampResultMessage,
} from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';
import { startKeepalive } from './keepalive.js';
import { analyzeSnapshot, AnalysisAbortedError, getInFlightCount, getInFlightTabIds } from './orchestrator.js';
import { analyzeResponse } from './response-analyzer.js';
import { setTabVerdict, handleTabActivated, handleTabRemoved } from './toolbar-icon.js';
import { ensureInstallSecret } from '@/shared/install-secret.js';
import { verifyStamp } from './stamp.js';
import { dispatchVerdictMessages, handleRescanWithMitigation, handleRescanPage } from './dispatch.js';

const log = createLogger('ServiceWorker');

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

chrome.runtime.onInstalled.addListener(() => {
  log.info('HoneyLLM installed');
  startKeepalive();
  bootstrapInstallSecret();
});

chrome.runtime.onStartup.addListener(() => {
  log.info('HoneyLLM startup');
  startKeepalive();
  bootstrapInstallSecret();
});

// Phase 4 Stage 4D.4 — per-tab icon state lifecycle hooks.
chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);

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

    case 'PING_KEEPALIVE': {
      sendResponse({ type: 'PONG_KEEPALIVE' });
      return;
    }

    case 'ENGINE_STATUS': {
      log.info(`Engine status: ${message.status}`, message.progress ?? '');
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
