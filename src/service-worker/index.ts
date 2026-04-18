import type { HoneyLLMMessage, VerdictMessage, ApplyMitigationMessage } from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';
import { startKeepalive } from './keepalive.js';
import { analyzeSnapshot, AnalysisAbortedError } from './orchestrator.js';
import { setTabVerdict, handleTabActivated, handleTabRemoved } from './toolbar-icon.js';

const log = createLogger('ServiceWorker');

chrome.runtime.onInstalled.addListener(() => {
  log.info('HoneyLLM installed');
  startKeepalive();
});

chrome.runtime.onStartup.addListener(() => {
  log.info('HoneyLLM startup');
  startKeepalive();
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

      analyzeSnapshot(tabId, message.snapshot)
        .then((verdict) => {
          setTabVerdict(tabId, verdict.status);
          const verdictMsg: VerdictMessage = { type: 'VERDICT', verdict };
          chrome.tabs.sendMessage(tabId, verdictMsg);

          if (verdict.status === 'COMPROMISED' || verdict.status === 'SUSPICIOUS') {
            const mitigateMsg: ApplyMitigationMessage = {
              type: 'APPLY_MITIGATION',
              verdict,
            };
            chrome.tabs.sendMessage(tabId, mitigateMsg);
          }
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

    case 'PING_KEEPALIVE': {
      sendResponse({ type: 'PONG_KEEPALIVE' });
      return;
    }

    case 'ENGINE_STATUS': {
      log.info(`Engine status: ${message.status}`, message.progress ?? '');
      return;
    }

    default:
      return;
  }
});
