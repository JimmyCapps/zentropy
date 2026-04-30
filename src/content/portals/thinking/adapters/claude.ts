import type {
  CapturedThinking,
  PortalId,
} from '@/types/portal-response.js';
import type { ThinkingAdapter } from './types.js';
import { createStreamEndDebouncer } from '../../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../../constants.js';
import { extractMarkdownText, firstAttribute, narrowToHTMLElement } from '../../dom-utils.js';

// Issue #131 (N7c) — Claude.ai thinking adapter.
//
// Selector ladder:
//   1. Turn container: [data-test-render-count] (same as response adapter)
//   2. Thinking subtree (selector ladder, in order of confidence):
//        - [data-testid*="thinking" i]
//        - [data-test-thinking]
//        - details[aria-label*="thinking" i]
//        - [aria-label*="thinking" i] (last-resort, may catch UI chrome)
//   3. Stream-end signal: data-is-streaming="false" on the turn container
//      (mirrors the response adapter); fall back to debounce.
//   4. messageId: `claude-thinking:` + data-test-render-count value, with
//      a text-prefix fallback. Namespaced so a thinking capture and a
//      response capture for the same turn cannot collide in dedup.

const PORTAL_ID: PortalId = 'claude';

const TURN_SELECTOR = '[data-test-render-count]';
const THINKING_SELECTORS: readonly string[] = [
  '[data-testid*="thinking" i]',
  '[data-test-thinking]',
  'details[aria-label*="thinking" i]',
  '[aria-label*="thinking" i]',
];

function matchesHost(host: string): boolean {
  return host === 'claude.ai';
}

function findThinkingBlocks(root: ParentNode): readonly HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const sel of THINKING_SELECTORS) {
    const list = root.querySelectorAll<HTMLElement>(sel);
    for (const el of Array.from(list)) found.add(el);
  }
  // Filter to thinking blocks that sit inside an assistant turn.
  return Array.from(found).filter((el) => el.closest(TURN_SELECTOR) !== null);
}

function getThinkingText(el: HTMLElement): string {
  return extractMarkdownText(el);
}

function getMessageId(el: HTMLElement): string {
  const turn = el.closest(TURN_SELECTOR) as HTMLElement | null;
  if (turn !== null) {
    const id = firstAttribute(turn, ['data-test-render-count', 'data-message-id']);
    if (id !== null) return `claude-thinking:${id}`;
  }
  const prefix = (el.textContent ?? '').slice(0, 32).replace(/\s+/g, '_');
  return `claude-thinking:fallback:${prefix}`;
}

function isTurnStreaming(turn: HTMLElement | null): boolean {
  return turn?.getAttribute('data-is-streaming') === 'true';
}

function isThinkingComplete(el: HTMLElement): boolean {
  const turn = el.closest(TURN_SELECTOR) as HTMLElement | null;
  return turn?.getAttribute('data-is-streaming') === 'false';
}

function conversationIdFromLocation(): string | null {
  try {
    const m = window.location.pathname.match(/\/chat\/([^/?#]+)/);
    return m?.[1] ?? null;
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
      if (cap.text.trim().length === 0) return;
      callback(cap);
    },
  });

  function bumpForElement(el: HTMLElement): void {
    const turn = el.closest(TURN_SELECTOR) as HTMLElement | null;
    if (isTurnStreaming(turn)) return;
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
        for (const sel of THINKING_SELECTORS) {
          const closest = (targetEl.closest?.(sel) ?? null) as HTMLElement | null;
          if (closest !== null && closest.closest(TURN_SELECTOR) !== null) {
            bumpForElement(closest);
            break;
          }
        }
      }
      for (const added of Array.from(record.addedNodes)) {
        const addedEl = narrowToHTMLElement(added);
        if (addedEl === null) continue;
        for (const sel of THINKING_SELECTORS) {
          if (addedEl.matches?.(sel) && addedEl.closest(TURN_SELECTOR) !== null) {
            bumpForElement(addedEl);
          }
          const sub = addedEl.querySelectorAll?.(sel) ?? [];
          for (const s of Array.from(sub)) {
            const candidate = s as HTMLElement;
            if (candidate.closest(TURN_SELECTOR) !== null) bumpForElement(candidate);
          }
        }
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

export const claudeThinkingAdapter: ThinkingAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findThinkingBlocks,
  attachThinkingObserver,
};
