import type { HoneyLLMMessage, LogEntryMessage, PageSnapshotMessage } from '@/types/messages.js';
import type { SecurityVerdict } from '@/types/verdict.js';
import { CONTENT_PING_INTERVAL_MS } from '@/shared/constants.js';
import { createLogger, setLogSink, setLogSource, type LogEntry } from '@/shared/logger.js';

// Issue #218 — forward content-script logs to the SW LogBus. Best
// effort; failures (SW asleep, navigation) are silenced — console.*
// already wrote the line locally.
// Issue #222 — stamp pageUrl on each outgoing entry so the file writer
// can route to per-page jsonl files. window.location.href is captured
// at sink time (each call) so SPA navigations route correctly without
// a manual reset hook.
setLogSource('content');
setLogSink((entry: LogEntry) => {
  const decorated: LogEntry = {
    ...entry,
    pageUrl: entry.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
  };
  const msg: LogEntryMessage = { type: 'LOG_ENTRY', entry: decorated };
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // chrome.runtime missing on a torn-down page — ignore.
  }
});
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
  const applied: string[] = [];

  if (verdict.status === 'COMPROMISED') {
    const removed = sanitizeSuspiciousNodes();
    if (removed.length > 0) {
      applied.push(`dom_sanitized:${removed.length}`);
    }

    activateNetworkGuard();
    applied.push('network_guard_active');

    activateRedirectBlocker();
    applied.push('redirect_blocker_active');
  }

  if (verdict.status === 'SUSPICIOUS') {
    const removed = sanitizeSuspiciousNodes();
    if (removed.length > 0) {
      applied.push(`dom_sanitized:${removed.length}`);
    }
  }

  return applied.length > 0
    ? { ...verdict, mitigationsApplied: [...verdict.mitigationsApplied, ...applied] }
    : verdict;
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
});

// Issue #224 — diagnostic heartbeat for the leak hunt (#217). Started
// after snapshot dispatch so the periodic stats line shows up alongside
// post-verdict observation. Stopped on pagehide so SPA-style same-tab
// navigations don't double-up timers across page rebuilds.
let heartbeatHandle: HeartbeatHandle | null = null;

function startDiagnosticHeartbeat(): void {
  if (heartbeatHandle !== null) return;
  heartbeatHandle = startHeartbeat();
  const stop = (): void => {
    heartbeatHandle?.stop();
    heartbeatHandle = null;
    window.removeEventListener('pagehide', stop);
  };
  window.addEventListener('pagehide', stop);
}

async function run(): Promise<void> {
  startKeepalivePing();

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

  startDiagnosticHeartbeat();
}

if (isLocalHarnessHost()) {
  log.info('suppressing page snapshot — harness page, extension stays out of the way');
} else {
  run().catch((err) => {
    log.error('Content script initialization failed', err);
  });
}
