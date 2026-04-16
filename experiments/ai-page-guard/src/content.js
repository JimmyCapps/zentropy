/**
 * content.js — AI Page Guard content script
 * Runs in the ISOLATED world. Injects signal.js into the MAIN world,
 * starts the DOM scanner, and handles messages from the popup.
 */

import { startObserver, getState, getEventLog } from './lib/dom-scanner.js';

// ─── Inject signal.js into the page's MAIN world ─────────────────────────────
(function injectSignal() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('signal.js');
  script.type = 'text/javascript';
  // Inject before any other scripts by prepending to <head> or <html>
  (document.head || document.documentElement).prepend(script);
  script.onload = () => script.remove();
})();

// ─── Message handler (popup / background → content) ──────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get_status') {
    sendResponse(getState());
    return true;
  }
  if (message?.type === 'get_log') {
    sendResponse(getEventLog());
    return true;
  }
});

// ─── Start scanning ───────────────────────────────────────────────────────────
try {
  startObserver();
} catch (err) {
  console.error('[AI Page Guard] Content script error:', err);
}
