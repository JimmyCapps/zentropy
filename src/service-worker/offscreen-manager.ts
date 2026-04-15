import { OFFSCREEN_URL, OFFSCREEN_REASON } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('OffscreenManager');

let creating: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (creating !== null) {
    await creating;
    return;
  }

  log.info('Creating offscreen document for LLM runtime');

  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [OFFSCREEN_REASON],
      justification: 'Run local LLM inference via WebGPU for security canary analysis',
    })
    .finally(() => {
      creating = null;
    });

  await creating;
  log.info('Offscreen document created');
}

export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
    log.info('Offscreen document closed');
  }
}
