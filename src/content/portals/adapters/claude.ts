import type {
  CapturedResponse,
  PortalAdapter,
  PortalId,
} from '@/types/portal-response.js';
import { createStreamEndDebouncer } from '../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../constants.js';
import { extractMarkdownText, firstAttribute, narrowToHTMLElement } from '../dom-utils.js';

// Issue #126 (N7a) — Claude.ai adapter.
//
// Selector ladder (see docs/portals/SELECTORS.md):
//   1. Primary: turns with [data-test-render-count] AND a Claude
//      response article inside (role="article" with assistant-style
//      aria-label).
//   2. Stream-end signal: data-is-streaming="false" attribute on the
//      turn container. We DO NOT fire while data-is-streaming="true".
//   3. messageId source: data-test-render-count value.
//   4. Text subtree: the assistant article element.
//   5. conversationId: parsed from /chat/<uuid> path.

const PORTAL_ID: PortalId = 'claude';

const TURN_SELECTOR = '[data-test-render-count]';
const ASSISTANT_ARTICLE_SELECTOR = '[role="article"][aria-label*="response" i], [role="article"][aria-label*="claude" i]';

function matchesHost(host: string): boolean {
  return host === 'claude.ai';
}

function isAssistantTurn(el: HTMLElement): boolean {
  return el.querySelector(ASSISTANT_ARTICLE_SELECTOR) !== null;
}

function findAssistantResponses(root: ParentNode): readonly HTMLElement[] {
  const turns = Array.from(root.querySelectorAll<HTMLElement>(TURN_SELECTOR));
  return turns.filter(isAssistantTurn);
}

function getMessageId(el: HTMLElement): string {
  const id = firstAttribute(el, ['data-test-render-count', 'data-message-id']);
  if (id !== null) return `claude:${id}`;
  const prefix = (el.textContent ?? '').slice(0, 32).replace(/\s+/g, '_');
  return `claude:fallback:${prefix}`;
}

function isStreamComplete(el: HTMLElement): boolean {
  // Explicit signal: data-is-streaming="false" indicates the turn finished.
  const v = el.getAttribute('data-is-streaming');
  return v === 'false';
}

function isStreaming(el: HTMLElement): boolean {
  return el.getAttribute('data-is-streaming') === 'true';
}

function getResponseText(el: HTMLElement): string {
  const article = el.querySelector(ASSISTANT_ARTICLE_SELECTOR);
  if (article !== null) return extractMarkdownText(article);
  return extractMarkdownText(el);
}

function conversationIdFromLocation(): string | null {
  try {
    const m = window.location.pathname.match(/\/chat\/([^/?#]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildCapture(el: HTMLElement, key: string): CapturedResponse {
  const messageId = key.split('|', 1)[0] ?? getMessageId(el);
  return {
    portalId: PORTAL_ID,
    text: getResponseText(el),
    capturedAt: Date.now(),
    conversationId: conversationIdFromLocation(),
    messageId,
    streamComplete: isStreamComplete(el),
  };
}

function attachResponseObserver(
  root: ParentNode,
  callback: (cap: CapturedResponse) => void,
): () => void {
  const trackedByKey = new Map<string, HTMLElement>();
  const firedKeys = new Set<string>();

  const debouncer = createStreamEndDebouncer({
    debounceMs: STREAM_END_DEBOUNCE_MS,
    maxLatencyMs: MAX_DEBOUNCE_LATENCY_MS,
    onFire: (key) => {
      const el = trackedByKey.get(key);
      trackedByKey.delete(key);
      firedKeys.add(key);
      if (el === undefined || !el.isConnected) return;
      callback(buildCapture(el, key));
    },
  });

  function bumpForElement(el: HTMLElement): void {
    // Suppress while streaming — the explicit data-is-streaming="true"
    // attribute is the authoritative "not done yet" signal on Claude.
    if (isStreaming(el)) return;
    if (!isAssistantTurn(el)) return;
    const messageId = getMessageId(el);
    const text = getResponseText(el);
    const key = `${messageId}|${text.slice(0, 32)}`;
    if (firedKeys.has(key)) return;
    trackedByKey.set(key, el);
    debouncer.bump(key);
    if (isStreamComplete(el)) {
      debouncer.markComplete(key);
    }
  }

  for (const el of findAssistantResponses(root)) bumpForElement(el);

  const targetNode = (root as { documentElement?: Node }).documentElement ?? (root as unknown as Node);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      const targetEl = narrowToHTMLElement(target as Node);
      if (targetEl !== null) {
        const closest = targetEl.closest(TURN_SELECTOR) as HTMLElement | null;
        if (closest !== null) bumpForElement(closest);
      }
      for (const added of Array.from(record.addedNodes)) {
        const addedEl = narrowToHTMLElement(added);
        if (addedEl === null) continue;
        if (addedEl.matches?.(TURN_SELECTOR)) bumpForElement(addedEl);
        const sub = addedEl.querySelectorAll?.(TURN_SELECTOR) ?? [];
        for (const s of Array.from(sub)) bumpForElement(s as HTMLElement);
      }
    }
  });
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-is-streaming', 'data-test-render-count'],
  });

  return () => {
    observer.disconnect();
    debouncer.dispose();
    trackedByKey.clear();
  };
}

export const claudeAdapter: PortalAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findAssistantResponses,
  attachResponseObserver,
};
