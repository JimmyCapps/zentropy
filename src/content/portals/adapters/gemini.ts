import type {
  CapturedResponse,
  PortalAdapter,
  PortalId,
} from '@/types/portal-response.js';
import { createStreamEndDebouncer } from '../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../constants.js';
import { extractMarkdownText, narrowToHTMLElement } from '../dom-utils.js';

// Issue #126 (N7a) — Gemini (gemini.google.com) adapter.
//
// Selector ladder (see docs/portals/SELECTORS.md):
//   1. Primary: <model-response> custom element.
//   2. Text subtree: <message-content>. Skips <model-thoughts> /
//      <thinking-block> — those are #131 (view-thinking) scope.
//   3. messageId source: synthesised from text-prefix hash because
//      Gemini's DOM lacks a stable per-turn id.
//   4. Stream-end signal: copy button presence, debounce-only fallback.
//   5. conversationId: parsed from ?c=<id> when present.

const PORTAL_ID: PortalId = 'gemini';

const ASSISTANT_SELECTOR = 'model-response';
const MESSAGE_CONTENT_SELECTOR = 'message-content';
const COMPLETION_MARKER_SELECTORS = [
  'button[aria-label="Copy"]',
  'button[aria-label*="Copy" i]',
];

function matchesHost(host: string): boolean {
  return host === 'gemini.google.com';
}

function findAssistantResponses(root: ParentNode): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR));
}

function getResponseText(el: HTMLElement): string {
  const content = el.querySelector(MESSAGE_CONTENT_SELECTOR);
  if (content !== null) return extractMarkdownText(content);
  return extractMarkdownText(el);
}

function getMessageId(el: HTMLElement): string {
  const text = getResponseText(el);
  const prefix = text.slice(0, 32).replace(/\s+/g, '_');
  return `gemini:${prefix}`;
}

function isStreamComplete(el: HTMLElement): boolean {
  for (const sel of COMPLETION_MARKER_SELECTORS) {
    if (el.querySelector(sel) !== null) return true;
  }
  return false;
}

function conversationIdFromLocation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('c');
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
    const messageId = getMessageId(el);
    const text = getResponseText(el);
    const key = `${messageId}|${text.slice(0, 32)}`;
    if (firedKeys.has(key)) return;
    trackedByKey.set(key, el);
    debouncer.bump(key);
    if (isStreamComplete(el)) debouncer.markComplete(key);
  }

  for (const el of findAssistantResponses(root)) bumpForElement(el);

  const targetNode = (root as { documentElement?: Node }).documentElement ?? (root as unknown as Node);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      const targetEl = narrowToHTMLElement(target as Node);
      if (targetEl !== null) {
        const closest = targetEl.closest(ASSISTANT_SELECTOR) as HTMLElement | null;
        if (closest !== null) bumpForElement(closest);
      }
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
  });

  return () => {
    observer.disconnect();
    debouncer.dispose();
    trackedByKey.clear();
  };
}

export const geminiAdapter: PortalAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findAssistantResponses,
  attachResponseObserver,
};
