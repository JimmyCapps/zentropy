// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import geminiCompleteHtml from './__fixtures__/gemini-complete.html?raw';
import geminiStreamingHtml from './__fixtures__/gemini-streaming.html?raw';
import { geminiAdapter } from './gemini.js';

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

describe('geminiAdapter — host matching', () => {
  it('matches gemini.google.com', () => {
    expect(geminiAdapter.matchesHost('gemini.google.com')).toBe(true);
  });

  it('does not match unrelated hosts', () => {
    expect(geminiAdapter.matchesHost('chatgpt.com')).toBe(false);
    expect(geminiAdapter.matchesHost('claude.ai')).toBe(false);
  });
});

describe('geminiAdapter — findAssistantResponses', () => {
  it('returns model-response elements', () => {
    loadFixture(geminiCompleteHtml);
    const found = geminiAdapter.findAssistantResponses(document);
    expect(found).toHaveLength(1);
    expect(found[0]?.tagName.toLowerCase()).toBe('model-response');
  });

  it('returns empty array when no model-response present', () => {
    const div = document.createElement('div');
    div.textContent = 'no model response here';
    document.body.appendChild(div);
    expect(geminiAdapter.findAssistantResponses(document)).toHaveLength(0);
  });
});

describe('geminiAdapter — attachResponseObserver', () => {
  it('extracts message-content text and skips thinking-block content', () => {
    loadFixture(geminiCompleteHtml);
    const fired: string[] = [];
    const dispose = geminiAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain('The answer is 4.');
    expect(fired[0]).toContain('most basic addition');
    expect(fired[0]).not.toContain('Calculating 2+2'); // thinking-block excluded
    dispose();
  });

  it('fires after debounce when streaming fixture has no completion marker', () => {
    loadFixture(geminiStreamingHtml);
    const fired: string[] = [];
    const dispose = geminiAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(700);
    expect(fired).toHaveLength(1);
    dispose();
  });

  it('uses portalId "gemini"', () => {
    loadFixture(geminiCompleteHtml);
    const fired: string[] = [];
    const dispose = geminiAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.portalId);
    });
    expect(fired).toEqual(['gemini']);
    dispose();
  });

  it('returns a disposer', () => {
    loadFixture(geminiStreamingHtml);
    const fired: string[] = [];
    const dispose = geminiAdapter.attachResponseObserver(document, (cap) => {
      fired.push(cap.text);
    });
    dispose();
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(0);
  });
});
