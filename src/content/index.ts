import type { HoneyLLMMessage, PageSnapshotMessage } from '@/types/messages.js';
import type { SecurityVerdict } from '@/types/verdict.js';
import { CONTENT_PING_INTERVAL_MS } from '@/shared/constants.js';
import { createLogger, setLogSink, setLogSource, type LogEntry } from '@/shared/logger.js';
import { bootstrapLogLevel } from '@/shared/log-level-bootstrap.js';
import { LOG_PORT_NAME } from '@/shared/log-bus.js';

// Issue #236 — content→SW logging via long-lived Port (`chrome.runtime.connect`)
// gated on whether a log viewer is connected. The previous design used
// `chrome.runtime.sendMessage(...).catch(...)` per log line; while SW was
// asleep the returned Promise + .catch arrow + decorated LogEntry piled
// up in the runtime's pending-message queue and never GC'd (heap-snapshot
// diff at the 19h overnight session: +266k closures + +159k V8 contexts).
//
// Port semantics: postMessage is fire-and-forget — no Promise return, no
// closure retention. When the SW sleeps Chrome buffers across the wake
// cycle. After 5min idle Chrome auto-disconnects; lazy ensureLogPort()
// reconnects on the next log line.
//
// Viewer-gate: when no log viewer is open we skip the postMessage entirely.
// Zero per-tick allocation in the steady state.
let logPort: chrome.runtime.Port | null = null;
let viewerConnected = false;

function ensureLogPort(): chrome.runtime.Port | null {
  if (logPort !== null) return logPort;
  try {
    const port = chrome.runtime.connect({ name: LOG_PORT_NAME });
    port.onDisconnect.addListener(() => {
      logPort = null;
    });
    logPort = port;
    return port;
  } catch {
    return null;
  }
}

setLogSource('content');
setLogSink((entry: LogEntry) => {
  if (!viewerConnected) return;
  const decorated: LogEntry = {
    ...entry,
    pageUrl: entry.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
  };
  try {
    ensureLogPort()?.postMessage({ type: 'APPEND', entry: decorated });
  } catch {
    // Port may have just disconnected; null out so the next call reconnects.
    logPort = null;
  }
});
void bootstrapLogLevel();
import { extractPageSnapshot } from './ingestion/extractor.js';
import {
  injectNetworkGuard,
  activateNetworkGuard,
  deactivateNetworkGuard,
} from './mitigation/network-guard.js';
import { sanitizeSuspiciousNodes } from './mitigation/dom-sanitizer.js';
import {
  activateRedirectBlocker,
  deactivateRedirectBlocker,
} from './mitigation/redirect-blocker.js';
import { applyMitigations as applyMitigationsCore } from './apply-mitigations.js';
import { setWindowGlobals } from './signaling/window-globals.js';
import { setSecurityMetaTag } from './signaling/meta-tag.js';
import {
  embedStamp,
  installStampObservers,
  installNavigationTeardown,
  type NavigationTeardownHandle,
} from './signaling/page-stamp-embed.js';
import { rescanWithForcedMitigation } from './rescan.js';
import { startHeartbeat, type HeartbeatHandle } from './diagnostic-heartbeat.js';

const log = createLogger('Content');

function isLocalHarnessHost(): boolean {
  return window.location.hostname === '127.0.0.1' && window.location.port === '8765';
}

if (isLocalHarnessHost()) {
  log.info('skipping content script init — local harness host detected');
} else {
  injectNetworkGuard();
}

function startKeepalivePing(): void {
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'PING_KEEPALIVE' }).catch(() => {});
  }, CONTENT_PING_INTERVAL_MS);
}

function applyMitigations(verdict: SecurityVerdict): SecurityVerdict {
  return applyMitigationsCore(verdict, {
    sanitizeSuspiciousNodes,
    activateNetworkGuard,
    deactivateNetworkGuard,
    activateRedirectBlocker,
    deactivateRedirectBlocker,
  });
}

// Issue #231 — track the active stamp lifecycle so a fresh VERDICT can
// dispose the previous observer pair + popstate/hashchange listeners
// before installing a new pair. Without this, repeat VERDICTs (see #230)
// stack observers and listeners that leak across the page lifetime.
let activeStamp: NavigationTeardownHandle | null = null;

// Issue #230 — content-side idempotency. The SW dedups duplicate dispatches
// at dispatch.ts; this is belt-and-braces against any path that reaches the
// content script through a non-dispatch route. Keyed on verdict.timestamp,
// which is unique per analysis (Date.now() in evaluatePolicy).
let lastVerdictTimestamp: number | null = null;

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage) => {
  if (message.type === 'VERDICT') {
    const verdict = message.verdict;
    if (lastVerdictTimestamp !== null && lastVerdictTimestamp === verdict.timestamp) {
      log.warn(`Suppressed duplicate VERDICT at content-side ts=${verdict.timestamp}`);
      return;
    }
    lastVerdictTimestamp = verdict.timestamp;

    log.info(`Received verdict: ${verdict.status} (confidence: ${verdict.confidence})`);

    setWindowGlobals(verdict);
    setSecurityMetaTag(verdict.status);

    // Issue #117 (N13) — embed page stamp when one was issued. Origin-
    // skipped verdicts and verdicts where ensureInstallSecret failed
    // arrive with stamp=null and skip the embed path.
    if (verdict.stamp !== null) {
      activeStamp?.teardown();
      const nodes = embedStamp(verdict.stamp);
      const observers = installStampObservers(nodes, verdict.stamp);
      activeStamp = installNavigationTeardown(observers, nodes);
    }
  }

  if (message.type === 'APPLY_MITIGATION') {
    const updated = applyMitigations(message.verdict);
    setWindowGlobals(updated);
    log.info(`Mitigations applied: ${updated.mitigationsApplied.join(', ')}`);
  }

  // Issue #233 — symmetric deactivate. Fired by the SW when a CLEAN/UNKNOWN
  // verdict supersedes a prior COMPROMISED/SUSPICIOUS for this tab. Roll
  // back the network guard, redirect blocker, and stamp lifecycle so the
  // page is not left in a half-mitigated state after a transient flip.
  if (message.type === 'DEACTIVATE_MITIGATIONS') {
    deactivateNetworkGuard();
    deactivateRedirectBlocker();
    activeStamp?.teardown();
    activeStamp = null;
    log.info('Mitigations deactivated');
  }

  // Issue #113 (N2) — popup-triggered rescan with mitigations forced
  // on. Re-extract the snapshot and re-send PAGE_SNAPSHOT with
  // forceMitigation propagated. The async work is fire-and-forget;
  // the SW confirms via the resulting VERDICT/APPLY_MITIGATION cycle.
  // Tab context is preserved by chrome.runtime.sendMessage's
  // sender.tab.id, so a tab switch between click and re-send still
  // routes the verdict to the originating tab.
  if (message.type === 'TRIGGER_RESCAN') {
    void rescanWithForcedMitigation(message.forceMitigation).catch((err) => {
      log.warn('TRIGGER_RESCAN re-send failed', err);
    });
  }

  // Issue #236 — SW broadcasts logging state on viewer Port
  // connect/disconnect / storage change / tab updated. We update the
  // sink-gate flag and start/stop the heartbeat in response.
  if (message.type === 'SET_LOGGING_STATE') {
    viewerConnected = message.connected;
    if (!viewerConnected && logPort !== null) {
      try {
        logPort.disconnect();
      } catch {
        // already gone
      }
      logPort = null;
    }
    applyHeartbeatPreference(message.heartbeat);
  }
});

// Issue #224 / #236 — diagnostic heartbeat. Now toggle-driven via
// SET_LOGGING_STATE rather than unconditionally started at content-script
// init. Default OFF; the log-viewer UI persists the user's preference and
// the SW broadcasts the resolved per-tab value.
let heartbeatHandle: HeartbeatHandle | null = null;
let heartbeatPagehideListener: (() => void) | null = null;

function applyHeartbeatPreference(on: boolean): void {
  if (on) {
    if (heartbeatHandle !== null) return;
    heartbeatHandle = startHeartbeat();
    const stop = (): void => {
      heartbeatHandle?.stop();
      heartbeatHandle = null;
      if (heartbeatPagehideListener !== null) {
        window.removeEventListener('pagehide', heartbeatPagehideListener);
        heartbeatPagehideListener = null;
      }
    };
    heartbeatPagehideListener = stop;
    window.addEventListener('pagehide', stop);
  } else {
    if (heartbeatHandle === null) return;
    heartbeatHandle.stop();
    heartbeatHandle = null;
    if (heartbeatPagehideListener !== null) {
      window.removeEventListener('pagehide', heartbeatPagehideListener);
      heartbeatPagehideListener = null;
    }
  }
}

async function run(): Promise<void> {
  startKeepalivePing();

  // Issue #236 — read initial logging state in case SET_LOGGING_STATE
  // arrives after the first log lines fire. The SW also broadcasts on
  // chrome.tabs.onUpdated complete which will overwrite this if the
  // resolved per-tab value differs.
  try {
    const res = await chrome.storage.local.get('honeyllm:logging-state');
    const state = res['honeyllm:logging-state'] as
      | { connected?: boolean; heartbeat?: { global?: boolean } }
      | undefined;
    if (state !== undefined) {
      viewerConnected = state.connected ?? false;
      // Without a tabId the content script can't resolve perTab[id]; trust
      // the global default until the SW broadcast arrives with the resolved
      // per-tab value.
      applyHeartbeatPreference(state.heartbeat?.global ?? false);
    }
  } catch {
    // chrome.storage missing / not yet bootstrapped — ignore.
  }

  log.info(`Extracting page snapshot for ${window.location.href}`);

  const snapshot = await extractPageSnapshot();

  log.info(`Snapshot: ${snapshot.charCount} chars, ${snapshot.scriptFingerprints.length} scripts`);

  const message: PageSnapshotMessage = {
    type: 'PAGE_SNAPSHOT',
    tabId: 0,
    snapshot,
  };

  chrome.runtime.sendMessage(message).catch((err) => {
    log.error('Failed to send snapshot to service worker', err);
  });
}

if (isLocalHarnessHost()) {
  log.info('suppressing page snapshot — harness page, extension stays out of the way');
} else {
  run().catch((err) => {
    log.error('Content script initialization failed', err);
  });
}
