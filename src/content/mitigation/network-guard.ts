import { createLogger } from '@/shared/logger.js';

const log = createLogger('NetworkGuard');

export function injectNetworkGuard(): void {
  const scriptUrl = chrome.runtime.getURL('dist/content/main-world-inject.js');

  const script = document.createElement('script');
  script.src = scriptUrl;
  script.dataset.honeyllmGuard = 'true';
  document.documentElement.appendChild(script);

  script.onload = () => {
    script.remove();
    log.info('Network guard injected into MAIN world');
  };

  script.onerror = () => {
    log.error('Failed to inject network guard');
  };
}

export function activateNetworkGuard(): void {
  window.postMessage({ type: 'HONEYLLM_ACTIVATE_GUARD', active: true }, '*');
  log.info('Network guard activated');
}

export function deactivateNetworkGuard(): void {
  window.postMessage({ type: 'HONEYLLM_ACTIVATE_GUARD', active: false }, '*');
}
