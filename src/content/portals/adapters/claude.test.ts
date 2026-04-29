// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import claudeCompleteHtml from './__fixtures__/claude-complete.html?raw';
import claudeStreamingHtml from './__fixtures__/claude-streaming.html?raw';
import { claudeAdapter } from './claude.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
});

function loadFixture(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const child of Array.from(parsed.body.childNodes)) {
    document.body.appendChild(document.importNode(child, true));
  }
}

describe('claudeAdapter — host matching', () => {
  it('matches claude.ai', () => {
    expect(claudeAdapter.matchesHost('claude.ai')).toBe(true);
  });

  it('does not match unrelated hosts', () => {
    expect(claudeAdapter.matchesHost('chatgpt.com')).toBe(false);
    expect(claudeAdapter.matchesHost('gemini.google.com')).toBe(false);
  });
});

describe('claudeAdapter — findAssistantResponses', () => {
  it('returns assistant turn containers (not user turns)', () => {
    loadFixture(claudeCompleteHtml);
    const found = claudeAdapter.findAssistantResponses(document);
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute('data-test-render-count')).toBe('2');
  });

  it('returns assistant turns even while streaming (selector match doesn\'t require completion)', () => {
    loadFixture(claudeStreamingHtml);
    const found = claudeAdapter.findAssistantResponses(document);
    expect(found).toHaveLength(1);
  });
});

describe('claudeAdapter — attachResponseObserver', () => {
  it('fires only after data-is-streaming flips to false', async () => {
    loadFixture(claudeStreamingHtml);
    const fired: { messageId: string; streamComplete: boolean }[] = [];
    const dispose = claudeAdapter.attachResponseObserver(document, (cap) => {
      fired.push({ messageId: cap.messageId, streamComplete: cap.streamComplete });
    });
    // Initial sweep with streaming=true: bumpForElement returns early → no fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toHaveLength(0);
    // Flip streaming to false. MutationObserver fires the callback as a
    // microtask; advanceTimersByTimeAsync flushes microtasks so the bump
    // path runs.
    document
      .querySelector('[data-test-render-count="2"]')
      ?.setAttribute('data-is-streaming', 'false');
    await vi.advanceTimersByTimeAsync(700);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.streamComplete).toBe(true);
    dispose();
  });

  it('fires on the initial sweep when fixture is already complete', () => {
    loadFixture(claudeCompleteHtml);
    const fired: string[] = [];
    const dispose = claudeAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain('The answer is 4.');
    expect(fired[0]).toContain('basic arithmetic');
    dispose();
  });

  it('uses portalId "claude"', () => {
    loadFixture(claudeCompleteHtml);
    const fired: string[] = [];
    const dispose = claudeAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.portalId);
    });
    expect(fired).toEqual(['claude']);
    dispose();
  });

  it('returns a disposer', () => {
    loadFixture(claudeStreamingHtml);
    const fired: string[] = [];
    const dispose = claudeAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    dispose();
    document
      .querySelector('[data-test-render-count="2"]')
      ?.setAttribute('data-is-streaming', 'false');
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(0);
  });
});
