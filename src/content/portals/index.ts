// Issue #126 (N7a) — chat-portal observer bootstrap.
//
// Runs as a separate content script (manifest entry: dist/content/portals/index.js)
// matched against the three portal hosts. Picks the right adapter by
// hostname, attaches the MutationObserver, and dispatches
// RESPONSE_CAPTURED to the SW. SPA navigations (history.pushState /
// replaceState) re-run the attach so a conversation switch picks up
// the new conversation root.

import type { CapturedResponse, PortalAdapter } from '@/types/portal-response.js';
import { chatgptAdapter } from './adapters/chatgpt.js';
import { claudeAdapter } from './adapters/claude.js';
import { geminiAdapter } from './adapters/gemini.js';
import { sendResponseCaptured } from './dispatch.js';
import { SELECTOR_REGRESSION_WARN_AFTER_MS } from './constants.js';
import { createLogger } from '@/shared/logger.js';
import {
  attachInterceptObserver,
  selectInterceptAdapter,
} from './intercept/index.js';
import {
  attachThinkingObserver,
  selectThinkingAdapter,
} from './thinking/index.js';

const log = createLogger('PortalObserver');

const ADAPTERS: readonly PortalAdapter[] = [chatgptAdapter, claudeAdapter, geminiAdapter];

function pickAdapter(hostname: string): PortalAdapter | null {
  for (const a of ADAPTERS) {
    if (a.matchesHost(hostname)) return a;
  }
  return null;
}

function buildMetadata(): { readonly url: string; readonly origin: string } {
  return { url: window.location.href, origin: window.location.origin };
}

interface ObserverHandle {
  readonly dispose: () => void;
  readonly captureCount: () => number;
}

function attach(adapter: PortalAdapter): ObserverHandle {
  let captureCount = 0;
  const dispose = adapter.attachResponseObserver(document, (cap: CapturedResponse) => {
    captureCount += 1;
    sendResponseCaptured(cap, buildMetadata()).catch(() => {
      // dispatch.ts already swallows errors; this catch is belt-and-suspenders.
    });
  });
  return { dispose, captureCount: () => captureCount };
}

function patchHistoryForSpaReattach(onChange: () => void): () => void {
  // Override pushState / replaceState once per page-load so SPA route
  // changes fire a custom event the adapter manager listens for.
  // Captures the original prototypes for restore on dispose.
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  let disposed = false;

  history.pushState = function (...args) {
    const ret = originalPush(...args);
    if (!disposed) onChange();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = originalReplace(...args);
    if (!disposed) onChange();
    return ret;
  };

  const popstateHandler = (): void => {
    if (!disposed) onChange();
  };
  window.addEventListener('popstate', popstateHandler);

  return () => {
    disposed = true;
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', popstateHandler);
  };
}

interface BootstrapHandle {
  readonly dispose: () => void;
}

export function bootstrapPortals(hostname: string = window.location.hostname): BootstrapHandle | null {
  const adapter = pickAdapter(hostname);
  if (adapter === null) {
    log.info(`No portal adapter for hostname: ${hostname}`);
    return null;
  }
  log.info(`Attaching portal observer: ${adapter.portalId}`);

  let handle = attach(adapter);

  const reattach = (): void => {
    log.info(`Re-attaching portal observer for SPA route change: ${adapter.portalId}`);
    handle.dispose();
    handle = attach(adapter);
  };

  const restoreHistory = patchHistoryForSpaReattach(reattach);

  // Issue #130 (N7b) — pre-send URL intercept observer. Independent of
  // the response observer; uses its own adapters for input + send-button
  // selectors. Returns a no-op disposer when the host doesn't match (the
  // selectInterceptAdapter result is null in that case).
  const interceptAdapter = selectInterceptAdapter(hostname);
  const disposeIntercept =
    interceptAdapter === null
      ? (): void => undefined
      : attachInterceptObserver({ adapter: interceptAdapter, hostname });
  if (interceptAdapter !== null) {
    log.info(`Attaching portal intercept observer: ${interceptAdapter.portalId}`);
  }

  // Issue #131 (N7c) — thinking-block (reasoning) observer. Watches the
  // thinking subtree on each portal (model-thoughts/<thinking-block> on
  // Gemini, extended-thinking ladder on Claude, reasoning ladder on
  // ChatGPT) and dispatches THINKING_CAPTURED to the SW thinking-analyzer.
  // No-op when the host doesn't match. Most portal sessions never enter
  // thinking mode → empty subtree → no captures, by design.
  const thinkingAdapter = selectThinkingAdapter(hostname);
  const disposeThinking =
    thinkingAdapter === null
      ? (): void => undefined
      : attachThinkingObserver({ adapter: thinkingAdapter });
  if (thinkingAdapter !== null) {
    log.info(`Attaching portal thinking observer: ${thinkingAdapter.portalId}`);
  }

  // Selector-regression watchdog: if no captures after the warning
  // window, surface a one-shot console warn so a developer can spot
  // selector drift before users do.
  const warnTimer = setTimeout(() => {
    if (handle.captureCount() === 0) {
      log.warn(
        `[${adapter.portalId}] no responses captured in ${SELECTOR_REGRESSION_WARN_AFTER_MS}ms — selectors may be stale`,
      );
    }
  }, SELECTOR_REGRESSION_WARN_AFTER_MS);

  return {
    dispose: () => {
      handle.dispose();
      disposeIntercept();
      disposeThinking();
      restoreHistory();
      clearTimeout(warnTimer);
    },
  };
}

// Auto-bootstrap when loaded as a content script. The `bootstrapPortals`
// export remains accessible for unit tests via direct import; gating
// the auto-run on `document` presence keeps it inert under SSR-ish
// vitest environments.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // Defer to next tick so test imports can opt out via `window` stub
  // before the bootstrap captures `window.location.hostname`.
  Promise.resolve().then(() => {
    bootstrapPortals();
  });
}
