import type { HoneyLLMMessage, ProbeResultsMessage } from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';
import { initEngine } from './engine.js';
import { runProbes } from './probe-runner.js';

const log = createLogger('Offscreen');

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'honeyllm-offscreen-keepalive') {
    log.debug('Keepalive port connected');
    port.onDisconnect.addListener(() => {
      log.debug('Keepalive port disconnected');
    });
  }
});

chrome.runtime.onMessage.addListener((message: HoneyLLMMessage, _sender, sendResponse) => {
  if (message.type === 'RUN_PROBES') {
    const { tabId, chunk, chunkIndex } = message;

    log.info(`Running probes for tab ${tabId}, chunk ${chunkIndex}`);

    runProbes(chunk)
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
