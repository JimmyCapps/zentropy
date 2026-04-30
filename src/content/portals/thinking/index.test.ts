// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { selectThinkingAdapter, attachThinkingObserver } from './index.js';

describe('selectThinkingAdapter', () => {
  it('returns the chatgpt adapter for chatgpt hostnames', () => {
    expect(selectThinkingAdapter('chatgpt.com')?.portalId).toBe('chatgpt');
    expect(selectThinkingAdapter('chat.openai.com')?.portalId).toBe('chatgpt');
  });

  it('returns the claude adapter for claude.ai', () => {
    expect(selectThinkingAdapter('claude.ai')?.portalId).toBe('claude');
  });

  it('returns the gemini adapter for gemini.google.com', () => {
    expect(selectThinkingAdapter('gemini.google.com')?.portalId).toBe('gemini');
  });

  it('returns null for non-portal hostnames', () => {
    expect(selectThinkingAdapter('example.com')).toBeNull();
    expect(selectThinkingAdapter('attacker.test')).toBeNull();
  });
});

describe('attachThinkingObserver', () => {
  it('returns a disposer; calling it unhooks without throwing', () => {
    // Smoke test only — the per-portal observer behaviour is covered by
    // the per-adapter test files. This confirms the wrapper threads the
    // adapter's disposer through cleanly.
    const adapter = {
      portalId: 'gemini' as const,
      matchesHost: () => true,
      findThinkingBlocks: () => [] as readonly HTMLElement[],
      attachThinkingObserver: (_root: ParentNode, _cb: (cap: import('@/types/portal-response.js').CapturedThinking) => void) => {
        return () => undefined;
      },
    };
    const dispose = attachThinkingObserver({ adapter });
    expect(() => dispose()).not.toThrow();
  });
});
