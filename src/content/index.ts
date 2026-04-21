import type { HoneyLLMMessage, PageSnapshotMessage } from '@/types/messages.js';
import type { SecurityVerdict } from '@/types/verdict.js';
import { CONTENT_PING_INTERVAL_MS } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';
import { extractPageSnapshot } from './ingestion/extractor.js';
import { injectNetworkGuard, activateNetworkGuard } from './mitigation/network-guard.js';
import { sanitizeSuspiciousNodes } from './mitigation/dom-sanitizer.js';
import { activateRedirectBlocker } from './mitigation/redirect-blocker.js';
import { setWindowGlobals } from './signaling/window-globals.js';
import { setSecurityMetaTag } from './signaling/meta-tag.js';

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

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage) => {
  if (message.type === 'VERDICT') {
    const verdict = message.verdict;
    log.info(`Received verdict: ${verdict.status} (confidence: ${verdict.confidence})`);

    setWindowGlobals(verdict);
    setSecurityMetaTag(verdict.status);
  }

  if (message.type === 'APPLY_MITIGATION') {
    const updated = applyMitigations(message.verdict);
    setWindowGlobals(updated);
    log.info(`Mitigations applied: ${updated.mitigationsApplied.join(', ')}`);
  }
});

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
}

if (isLocalHarnessHost()) {
  log.info('suppressing page snapshot — harness page, extension stays out of the way');
} else {
  run().catch((err) => {
    log.error('Content script initialization failed', err);
  });
}
