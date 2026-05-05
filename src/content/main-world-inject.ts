import { BLOCKED_PATTERNS } from '@/shared/blocked-patterns.js';

export {};

declare global {
  interface Window {
    __AI_SITE_STATUS__?: string;
    __AI_SECURITY_REPORT__?: unknown;
    __HONEYLLM_GUARD_ACTIVE__?: boolean;
  }
}

export type MainWorldTarget = Window & typeof globalThis;

export function installNetworkGuard(
  target: MainWorldTarget = globalThis as MainWorldTarget,
): void {
  let guardActive = false;

  const originalFetch = target.fetch;
  const originalXhrOpen = target.XMLHttpRequest.prototype.open;

  function isBlocked(url: string): boolean {
    if (!guardActive) return false;
    return BLOCKED_PATTERNS.some((p) => p.test(url));
  }

  const guardedFetch = function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (isBlocked(url)) {
      console.warn(`[HoneyLLM] Blocked fetch to suspicious URL: ${url}`);
      return Promise.reject(new Error('[HoneyLLM] Request blocked by security guard'));
    }

    return originalFetch.call(target, input, init);
  };

  const guardedOpen = function guardedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...args: unknown[]
  ): unknown {
    const urlStr = typeof url === 'string' ? url : url.href;

    if (isBlocked(urlStr)) {
      console.warn(`[HoneyLLM] Blocked XHR to suspicious URL: ${urlStr}`);
      throw new Error('[HoneyLLM] Request blocked by security guard');
    }

    return (originalXhrOpen as (...a: unknown[]) => unknown).call(this, method, url, ...args);
  };

  target.fetch = guardedFetch as typeof target.fetch;
  target.XMLHttpRequest.prototype.open = guardedOpen as typeof target.XMLHttpRequest.prototype.open;

  installToStringMask([
    [guardedFetch, 'fetch'],
    [guardedOpen, 'open'],
  ]);

  target.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== target) return;

    if (event.data?.type === 'HONEYLLM_ACTIVATE_GUARD') {
      guardActive = event.data.active === true;
      target.__HONEYLLM_GUARD_ACTIVE__ = guardActive;
    }

    if (event.data?.type === 'HONEYLLM_SET_STATUS') {
      target.__AI_SITE_STATUS__ = event.data.status;
      target.__AI_SECURITY_REPORT__ = event.data.report;
    }
  });
}

// Issue #217 — anti-adblock systems detect non-native fetch / XHR.open by
// calling `Function.prototype.toString.call(window.fetch)` and checking for
// `[native code]`. A direct `.toString` override on the function is bypassed
// by callers that use `.call`, so we proxy `Function.prototype.toString`
// itself: a WeakMap of wrappers returns the synthesized native string,
// everything else falls through. Self-masked so the patched toString also
// rounds-trips as native, otherwise a probe of toString itself unmasks the
// patch. Without this, dynamic-DOM commerce pages (e.g. officeworks.com.au)
// trigger an ad-rotation cascade on detection that runs the renderer RSS
// past 5 GB inside 5 minutes idle.
function installToStringMask(wrappers: ReadonlyArray<readonly [Function, string]>): void {
  const FunctionProto = Function.prototype;
  const originalToString = FunctionProto.toString;
  const masked = new WeakMap<Function, string>();
  for (const [fn, name] of wrappers) {
    masked.set(fn, `function ${name}() { [native code] }`);
  }

  const proxiedToString = new Proxy(originalToString, {
    apply(targetFn, thisArg, args): unknown {
      if (typeof thisArg === 'function') {
        const m = masked.get(thisArg);
        if (m !== undefined) return m;
      }
      return Reflect.apply(targetFn, thisArg, args);
    },
  });
  masked.set(proxiedToString, 'function toString() { [native code] }');

  FunctionProto.toString = proxiedToString;
}
