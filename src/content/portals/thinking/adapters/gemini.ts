import type {
  CapturedThinking,
  PortalId,
} from '@/types/portal-response.js';
import type { ThinkingAdapter } from './types.js';
import { createStreamEndDebouncer } from '../../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../../constants.js';
import { extractMarkdownText, narrowToHTMLElement } from '../../dom-utils.js';

// Issue #131 (N7c) — Gemini thinking adapter.
//
// Selector ladder:
//   1. Container:    <model-response> (same parent as the response observer)
//   2. Thinking:     <model-thoughts> | <thinking-block>
//                    (these are explicitly EXCLUDED in adapters/gemini.ts:14
//                    so the response observer never sees them — we INVERT
//                    that exclusion into a capture here.)
//   3. messageId:    `gemini-thinking:` + text-prefix hash, namespaced so
//                    a thinking capture and a response capture for the
//                    same logical turn cannot collide in the SW dedup
//                    cache.
//   4. Stream-end:   reuse the response copy button (`button[aria-label*="Copy" i]`)
//                    as the most reliable "turn complete" marker on
//                    Gemini; fall back to debounce.
//   5. conversationId: parsed from ?c=<id> when present.

const PORTAL_ID: PortalId = 'gemini';

const RESPONSE_SELECTOR = 'model-response';
const THINKING_SELECTOR = 'model-thoughts, thinking-block';
const COMPLETION_MARKER_SELECTORS = [
  'button[aria-label="Copy"]',
  'button[aria-label*="Copy" i]',
];

function matchesHost(host: string): boolean {
  return host === 'gemini.google.com';
}

function findThinkingBlocks(root: ParentNode): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(THINKING_SELECTOR));
}

function getThinkingText(el: HTMLElement): string {
  return extractMarkdownText(el);
}

function getMessageId(el: HTMLElement): string {
  const text = getThinkingText(el);
  const prefix = text.slice(0, 32).replace(/\s+/g, '_');
  return `gemini-thinking:${prefix}`;
}

function isThinkingComplete(el: HTMLElement): boolean {
  // Climb to the enclosing model-response — the copy button lives there,
  // not inside the thinking subtree itself.
  const container = el.closest(RESPONSE_SELECTOR);
  if (container === null) return false;
  for (const sel of COMPLETION_MARKER_SELECTORS) {
    if (container.querySelector(sel) !== null) return true;
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

function buildCapture(el: HTMLElement, key: string): CapturedThinking {
  const messageId = key.split('|', 1)[0] ?? getMessageId(el);
  return {
    portalId: PORTAL_ID,
    text: getThinkingText(el),
    capturedAt: Date.now(),
    conversationId: conversationIdFromLocation(),
    messageId,
    streamComplete: isThinkingComplete(el),
  };
}

function attachThinkingObserver(
  root: ParentNode,
  callback: (cap: CapturedThinking) => void,
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
      const cap = buildCapture(el, key);
      // Empty-text suppression: thinking sections that exist in DOM but
      // contain no readable text should not produce a capture (the
      // analyzer would short-circuit anyway, but we save the round-trip).
      if (cap.text.trim().length === 0) return;
      callback(cap);
    },
  });

  function bumpForElement(el: HTMLElement): void {
    const messageId = getMessageId(el);
    const text = getThinkingText(el);
    const key = `${messageId}|${text.slice(0, 32)}`;
    if (firedKeys.has(key)) return;
    trackedByKey.set(key, el);
    debouncer.bump(key);
    if (isThinkingComplete(el)) debouncer.markComplete(key);
  }

  for (const el of findThinkingBlocks(root)) bumpForElement(el);

  const targetNode = (root as { documentElement?: Node }).documentElement ?? (root as unknown as Node);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      const targetEl = narrowToHTMLElement(target as Node);
      if (targetEl !== null) {
        const closest = (targetEl.closest?.(THINKING_SELECTOR) ?? null) as HTMLElement | null;
        if (closest !== null) bumpForElement(closest);
      }
      for (const added of Array.from(record.addedNodes)) {
        const addedEl = narrowToHTMLElement(added);
        if (addedEl === null) continue;
        if (addedEl.matches?.(THINKING_SELECTOR)) bumpForElement(addedEl);
        const sub = addedEl.querySelectorAll?.(THINKING_SELECTOR) ?? [];
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

export const geminiThinkingAdapter: ThinkingAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findThinkingBlocks,
  attachThinkingObserver,
};
