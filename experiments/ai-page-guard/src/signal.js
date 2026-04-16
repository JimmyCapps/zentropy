/**
 * signal.js — injected into the page's MAIN world as a web-accessible resource.
 * Exposes window.__AI_SECURITY_REPORT__ so AI tools reading the page can
 * check whether the current page has been scanned and found safe or unsafe.
 */

window.__AI_SECURITY_REPORT__ = {
  status: 'initializing',
  url: location.href,
  scan_coverage: 0,
  threats: [],
  pending_nodes: 0,
  last_scan: null,
  models_loaded: false,
};

window.__AI_PAGE_GUARD_LOG__ = [];

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'AI_PAGE_GUARD_UPDATE') {
    Object.assign(window.__AI_SECURITY_REPORT__, event.data.report);
    if (event.data.log) {
      window.__AI_PAGE_GUARD_LOG__ = event.data.log;
    }
  }
});
