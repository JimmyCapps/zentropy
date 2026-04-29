import type {
  CapturedResponse,
  PortalAdapter,
  PortalId,
} from '@/types/portal-response.js';
import { createStreamEndDebouncer } from '../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../constants.js';
import { extractMarkdownText, firstAttribute, narrowToHTMLElement } from '../dom-utils.js';

// Issue #126 (N7a) — ChatGPT (chatgpt.com + chat.openai.com) adapter.
//
// Selector ladder (see docs/portals/SELECTORS.md):
//   1. Primary container:   [data-message-author-role="assistant"]
//   2. Markdown subtree:    .markdown   (avoids toolbar/timestamp text)
//   3. messageId source:    data-message-id  (synthesised fallback if absent)
//   4. Stream-end signal:   copy/regenerate button presence in toolbar
//   5. Conversation id:     parsed from /c/<id> path
//
// Selector REGRESSION POSTURE: a redesign that breaks the primary
// selector causes findAssistantResponses to return [] — the observer
// fires no callbacks, the page-content scan is unaffected. Console
// surfaces a warning at 30s of inactivity (handled in portals/index.ts).

const PORTAL_ID: PortalId = 'chatgpt';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const MARKDOWN_SELECTOR = '.markdown';
const COMPLETION_MARKER_SELECTORS = [
  '[data-testid="copy-turn-action-button"]',
  '[data-testid="regenerate-response-button"]',
  'button[aria-label="Copy"]',
];

function matchesHost(host: string): boolean {
  return host === 'chatgpt.com' || host === 'chat.openai.com';
}

function findAssistantResponses(root: ParentNode): readonly HTMLElement[] {
  const list = root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR);
  return Array.from(list);
}

function getMessageId(el: HTMLElement): string {
  const id = firstAttribute(el, ['data-message-id']);
  if (id !== null) return id;
  // Synthesise: include text-prefix hash so regenerate (which keeps the
  // same DOM element) yields a different key.
  const prefix = (el.textContent ?? '').slice(0, 32).replace(/\s+/g, '_');
  return `chatgpt:fallback:${prefix}`;
}

function isStreamComplete(el: HTMLElement): boolean {
  for (const sel of COMPLETION_MARKER_SELECTORS) {
    if (el.querySelector(sel) !== null) return true;
  }
  return false;
}

function getResponseText(el: HTMLElement): string {
  const md = el.querySelector(MARKDOWN_SELECTOR);
  if (md !== null) return extractMarkdownText(md);
  // Fallback: pull text from the whole turn (may include toolbar text).
  return extractMarkdownText(el);
}

function conversationIdFromLocation(): string | null {
  try {
    const m = window.location.pathname.match(/\/c\/([^/?#]+)/);
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
  // Map dedup key (`messageId|textPrefix`) → assistant element.
  const trackedByKey = new Map<string, HTMLElement>();
  // Once a key has fired, suppress subsequent bumps for the same key.
  // Regenerate produces a NEW textPrefix → new key → new fire.
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
    const messageId = getMessageId(el);
    const text = getResponseText(el);
    // Include first 32 chars of text-prefix in the dedup key so a
    // regenerate of the same messageId starts a fresh debounce window.
    const key = `${messageId}|${text.slice(0, 32)}`;
    if (firedKeys.has(key)) return;
    trackedByKey.set(key, el);
    debouncer.bump(key);
    if (isStreamComplete(el)) {
      debouncer.markComplete(key);
    }
  }

  // Initial sweep — capture any assistant turns already in the DOM.
  for (const el of findAssistantResponses(root)) {
    bumpForElement(el);
  }

  const targetNode = (root as { documentElement?: Node }).documentElement ?? (root as unknown as Node);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Mutations on existing assistant turns: walk up to the assistant
      // ancestor.
      const target = record.target;
      const targetEl = narrowToHTMLElement(target as Node);
      if (targetEl !== null) {
        const closest = targetEl.closest(ASSISTANT_SELECTOR) as HTMLElement | null;
        if (closest !== null) bumpForElement(closest);
      }
      // New assistant turn nodes added: bump for each.
      for (const added of Array.from(record.addedNodes)) {
        const addedEl = narrowToHTMLElement(added);
        if (addedEl === null) continue;
        if (addedEl.matches?.(ASSISTANT_SELECTOR)) bumpForElement(addedEl);
        const sub = addedEl.querySelectorAll?.(ASSISTANT_SELECTOR) ?? [];
        for (const s of Array.from(sub)) bumpForElement(s as HTMLElement);
      }
    }
  });
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-message-id'],
  });

  return () => {
    observer.disconnect();
    debouncer.dispose();
    trackedByKey.clear();
  };
}

export const chatgptAdapter: PortalAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findAssistantResponses,
  attachResponseObserver,
};
