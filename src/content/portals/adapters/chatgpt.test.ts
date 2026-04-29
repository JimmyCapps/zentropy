// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import chatgptCompleteHtml from './__fixtures__/chatgpt-complete.html?raw';
import chatgptStreamingHtml from './__fixtures__/chatgpt-streaming.html?raw';
import { chatgptAdapter } from './chatgpt.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
});

function loadFixture(html: string): void {
  // Parse static fixture HTML (no user input, no XSS surface) into a
  // disconnected document, then move children into document.body —
  // avoids innerHTML to keep the security hook quiet.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const child of Array.from(parsed.body.childNodes)) {
    document.body.appendChild(document.importNode(child, true));
  }
}

describe('chatgptAdapter — host matching', () => {
  it('matches chatgpt.com', () => {
    expect(chatgptAdapter.matchesHost('chatgpt.com')).toBe(true);
  });

  it('matches chat.openai.com', () => {
    expect(chatgptAdapter.matchesHost('chat.openai.com')).toBe(true);
  });

  it('does not match unrelated hosts', () => {
    expect(chatgptAdapter.matchesHost('claude.ai')).toBe(false);
    expect(chatgptAdapter.matchesHost('example.com')).toBe(false);
  });
});

describe('chatgptAdapter — findAssistantResponses', () => {
  it('returns assistant turn elements', () => {
    loadFixture(chatgptCompleteHtml);
    const found = chatgptAdapter.findAssistantResponses(document);
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute('data-message-author-role')).toBe('assistant');
  });

  it('ignores user turn elements', () => {
    loadFixture(chatgptCompleteHtml);
    const found = chatgptAdapter.findAssistantResponses(document);
    expect(found.some((el) => el.getAttribute('data-message-author-role') === 'user')).toBe(false);
  });

  it('returns an empty array when no assistant turns are present', () => {
    const placeholder = document.createElement('div');
    placeholder.textContent = 'nothing here';
    document.body.appendChild(placeholder);
    expect(chatgptAdapter.findAssistantResponses(document)).toHaveLength(0);
  });
});

describe('chatgptAdapter — attachResponseObserver', () => {
  it('fires CapturedResponse on the initial sweep when fixture is already complete', () => {
    loadFixture(chatgptCompleteHtml);
    const fired: { messageId: string; text: string }[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push({ messageId: cap.messageId, text: cap.text });
    });
    // Complete fixture: completion-marker bypasses the debounce and fires
    // synchronously during the initial sweep (markComplete path).
    expect(fired).toHaveLength(1);
    expect(fired[0]?.messageId).toBe('msg-asst-1');
    expect(fired[0]?.text).toContain('The answer is 4.');
    expect(fired[0]?.text).toContain('Mathematicians');
    dispose();
  });

  it('fires after stream-end debounce settles on a streaming response', () => {
    loadFixture(chatgptStreamingHtml);
    const fired: { messageId: string; streamComplete: boolean }[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push({ messageId: cap.messageId, streamComplete: cap.streamComplete });
    });
    // No completion marker → debounce path: nothing yet.
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(700);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.messageId).toBe('msg-asst-1');
    expect(fired[0]?.streamComplete).toBe(false);
    dispose();
  });

  it('uses portalId "chatgpt" on the captured response', () => {
    loadFixture(chatgptCompleteHtml);
    const fired: string[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.portalId);
    });
    expect(fired).toEqual(['chatgpt']);
    dispose();
  });

  it('marks streamComplete=true when the action toolbar is present', () => {
    loadFixture(chatgptCompleteHtml);
    const fired: boolean[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.streamComplete);
    });
    expect(fired).toEqual([true]);
    dispose();
  });

  it('does NOT re-fire for the same messageId+textPrefix on subsequent mutations', () => {
    loadFixture(chatgptCompleteHtml);
    const fired: string[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    expect(fired).toHaveLength(1);
    // Append whitespace beyond the first 32 chars of text — same dedup key,
    // suppressed.
    const md = document.querySelector('[data-message-author-role="assistant"] .markdown');
    md?.appendChild(document.createTextNode(' more later'));
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
    dispose();
  });

  it('returns a disposer that detaches the observer', () => {
    loadFixture(chatgptStreamingHtml);
    const fired: string[] = [];
    const dispose = chatgptAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    dispose();
    document.querySelector('[data-message-author-role="assistant"]')?.appendChild(document.createTextNode(' more'));
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(0);
  });
});
