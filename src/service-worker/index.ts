import type { HoneyLLMMessage, VerdictMessage, ApplyMitigationMessage } from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';
import { startKeepalive } from './keepalive.js';
import { analyzeSnapshot } from './orchestrator.js';

const log = createLogger('ServiceWorker');

chrome.runtime.onInstalled.addListener(() => {
  log.info('HoneyLLM installed');
  startKeepalive();
});

chrome.runtime.onStartup.addListener(() => {
  log.info('HoneyLLM startup');
  startKeepalive();
});

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
