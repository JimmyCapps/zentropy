// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import chatgptCompleteHtml from './adapters/__fixtures__/chatgpt-complete.html?raw';
import { bootstrapPortals } from './index.js';

interface SentMessage {
  readonly type: string;
  readonly capture: { readonly portalId: string; readonly text: string };
  readonly metadata: { readonly url: string; readonly origin: string };
}

function setupChrome(): SentMessage[] {
  const sent: SentMessage[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (msg: SentMessage) => {
        sent.push(msg);
      }),
      lastError: undefined,
    },
  });
  return sent;
}

function loadFixture(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const child of Array.from(parsed.body.childNodes)) {
    document.body.appendChild(document.importNode(child, true));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
});

describe('bootstrapPortals — host routing', () => {
  it('returns a handle when hostname matches chatgpt.com', () => {
    setupChrome();
    const handle = bootstrapPortals('chatgpt.com');
    expect(handle).not.toBeNull();
    handle?.dispose();
  });

  it('returns null on unmatched hostnames', () => {
    setupChrome();
    expect(bootstrapPortals('example.com')).toBeNull();
  });

  it('routes to claude adapter on claude.ai', async () => {
    const sent = setupChrome();
    loadFixture(chatgptCompleteHtml); // wrong fixture, but Claude adapter
    // won't match since the fixture has no [data-test-render-count]
    // articles — so no captures. We just verify no crash + handle created.
    const handle = bootstrapPortals('claude.ai');
    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toHaveLength(0);
    handle?.dispose();
  });

  it('dispatches RESPONSE_CAPTURED on a successful capture', async () => {
    const sent = setupChrome();
    loadFixture(chatgptCompleteHtml);
    const handle = bootstrapPortals('chatgpt.com');
    expect(handle).not.toBeNull();
    // Initial sweep + completion-marker → synchronous fire.
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('RESPONSE_CAPTURED');
    expect(sent[0]?.capture.portalId).toBe('chatgpt');
    expect(sent[0]?.metadata.url).toContain('localhost');
    handle?.dispose();
  });

  it('dispose() detaches the observer and history hooks', async () => {
    const sent = setupChrome();
    const handle = bootstrapPortals('chatgpt.com');
    expect(handle).not.toBeNull();
    handle?.dispose();
    // After dispose, loading a fixture and mutating should produce no sends.
    loadFixture(chatgptCompleteHtml);
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toHaveLength(0);
  });

  it('survives SPA navigation by re-attaching on history.pushState', async () => {
    const sent = setupChrome();
    const handle = bootstrapPortals('chatgpt.com');
    expect(handle).not.toBeNull();

    // Trigger a history.pushState; the observer should re-attach.
    history.pushState({}, '', '/c/new-conversation');

    // Load a fresh fixture in the new "page".
    loadFixture(chatgptCompleteHtml);
    await vi.advanceTimersByTimeAsync(50);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    handle?.dispose();
  });
});
