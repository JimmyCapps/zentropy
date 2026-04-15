export {};

declare global {
  interface Window {
    __AI_SITE_STATUS__?: string;
    __AI_SECURITY_REPORT__?: unknown;
    __HONEYLLM_GUARD_ACTIVE__?: boolean;
  }
}

(function honeyLLMMainWorld() {
  let guardActive = false;

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;

  const BLOCKED_PATTERNS = [
    /webhook\.site/i,
    /requestbin/i,
    /pipedream/i,
    /hookbin/i,
    /ngrok\.io/i,
    /burpcollaborator/i,
    /interact\.sh/i,
    /oastify\.com/i,
    /beeceptor/i,
  ];

  function isBlocked(url: string): boolean {
    if (!guardActive) return false;
    return BLOCKED_PATTERNS.some((p) => p.test(url));
  }

  window.fetch = function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (isBlocked(url)) {
      console.warn(`[HoneyLLM] Blocked fetch to suspicious URL: ${url}`);
      return Promise.reject(new Error('[HoneyLLM] Request blocked by security guard'));
    }

    return originalFetch.call(window, input, init);
  };

  XMLHttpRequest.prototype.open = function guardedOpen(
    method: string,
    url: string | URL,
    ...args: unknown[]
  ) {
    const urlStr = typeof url === 'string' ? url : url.href;

    if (isBlocked(urlStr)) {
      console.warn(`[HoneyLLM] Blocked XHR to suspicious URL: ${urlStr}`);
      throw new Error('[HoneyLLM] Request blocked by security guard');
    }

    return (originalXhrOpen as Function).call(this, method, url, ...args);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'HONEYLLM_ACTIVATE_GUARD') {
      guardActive = event.data.active === true;
      window.__HONEYLLM_GUARD_ACTIVE__ = guardActive;
    }

    if (event.data?.type === 'HONEYLLM_SET_STATUS') {
      window.__AI_SITE_STATUS__ = event.data.status;
      window.__AI_SECURITY_REPORT__ = event.data.report;
    }
  });
})();
