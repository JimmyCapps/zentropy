// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HoneyLLMMessage,
  InterceptScanRequestMessage,
  InterceptVerdict,
  InterceptVerdictMessage,
} from '@/types/messages.js';

import { chatgptInterceptAdapter } from './adapters/chatgpt.js';
import { attachInterceptObserver } from './index.js';
import { INTERCEPT_INPUT_DEBOUNCE_MS } from '@/shared/constants.js';

interface ChromeStub {
  readonly sendMessageMock: ReturnType<typeof vi.fn>;
  readonly listeners: Array<(msg: HoneyLLMMessage) => void>;
}

function setupChrome(): ChromeStub {
  const listeners: ChromeStub['listeners'] = [];
  const sendMessageMock = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: (cb: (msg: HoneyLLMMessage) => void) => listeners.push(cb),
        removeListener: (cb: (msg: HoneyLLMMessage) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      },
    },
  });
  return { sendMessageMock, listeners };
}

function buildComposer(): { input: HTMLElement; button: HTMLButtonElement } {
  while (document.body.firstChild !== null) {
    document.body.removeChild(document.body.firstChild);
  }
  const form = document.createElement('form');
  const input = document.createElement('div');
  input.id = 'prompt-textarea';
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('role', 'textbox');
  form.appendChild(input);
  const button = document.createElement('button');
  button.setAttribute('data-testid', 'send-button');
  button.setAttribute('aria-label', 'Send prompt');
  button.type = 'submit';
  form.appendChild(button);
  document.body.appendChild(form);
  return { input, button };
}

function setInputText(input: HTMLElement, text: string): void {
  input.textContent = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function deliverVerdict(stub: ChromeStub, requestId: string, verdict: InterceptVerdict): void {
  const msg: InterceptVerdictMessage = { type: 'INTERCEPT_VERDICT', requestId, verdict };
  for (const cb of stub.listeners) cb(msg);
}

function buildVerdict(overrides: Partial<InterceptVerdict> = {}): InterceptVerdict {
  return {
    status: 'CLEAN',
    scannedUrl: 'https://target.example/',
    probeBreakdown: { totalProbes: 3, suspiciousProbes: 0, compromisedProbes: 0 },
    totalScore: 0,
    cacheHit: false,
    timestamp: 0,
    analysisError: null,
    ...overrides,
  };
}

describe('attachInterceptObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dispatches INTERCEPT_SCAN_REQUEST after debounced URL detection', async () => {
    const stub = setupChrome();
    const { input } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'please look up https://target.example for me');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);

    expect(stub.sendMessageMock).toHaveBeenCalled();
    const msg = stub.sendMessageMock.mock.calls[0]![0] as InterceptScanRequestMessage;
    expect(msg.type).toBe('INTERCEPT_SCAN_REQUEST');
    expect(msg.url).toBe('https://target.example');
    expect(msg.portalId).toBe('chatgpt');
    expect(typeof msg.requestId).toBe('string');
    dispose();
  });

  it('disables the send button while a scan is in flight', async () => {
    setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'check https://target.example please');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('data-honeyllm-disabled')).toBe('true');
    expect(button.getAttribute('title')).toContain('HoneyLLM');
    dispose();
  });

  it('re-enables send button on CLEAN verdict', async () => {
    const stub = setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'check https://target.example please');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    const sentMsg = stub.sendMessageMock.mock.calls[0]![0] as InterceptScanRequestMessage;

    deliverVerdict(stub, sentMsg.requestId, buildVerdict({ status: 'CLEAN' }));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('data-honeyllm-disabled')).toBeNull();
    dispose();
  });

  it('keeps send button disabled on SUSPICIOUS verdict with title', async () => {
    const stub = setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'fetch https://target.example');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    const sentMsg = stub.sendMessageMock.mock.calls[0]![0] as InterceptScanRequestMessage;
    deliverVerdict(stub, sentMsg.requestId, buildVerdict({ status: 'SUSPICIOUS' }));

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/SUSPICIOUS/i);
    dispose();
  });

  it('keeps send button disabled on COMPROMISED verdict', async () => {
    const stub = setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'fetch https://target.example');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    const sentMsg = stub.sendMessageMock.mock.calls[0]![0] as InterceptScanRequestMessage;
    deliverVerdict(stub, sentMsg.requestId, buildVerdict({ status: 'COMPROMISED' }));

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/COMPROMISED|blocked/i);
    dispose();
  });

  it('Enter keypress is intercepted while button is gated', async () => {
    setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'fetch https://target.example');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    expect(button.disabled).toBe(true);

    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const prevented = !input.dispatchEvent(ev);
    expect(prevented).toBe(true);
    dispose();
  });

  it('Enter keypress passes through when no scan is gating', async () => {
    setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    expect(button.disabled).toBe(false);

    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const prevented = !input.dispatchEvent(ev);
    expect(prevented).toBe(false);
    dispose();
  });

  it('clearing the URL from the input restores the send button', async () => {
    const stub = setupChrome();
    const { input, button } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });

    setInputText(input, 'fetch https://target.example please');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    expect(button.disabled).toBe(true);

    // User deletes the URL
    setInputText(input, 'no url here anymore');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    expect(button.disabled).toBe(false);
    expect(stub.sendMessageMock).toHaveBeenCalledTimes(1); // only the original
    dispose();
  });

  it('dispose() removes input + key + onMessage listeners (no further dispatches)', async () => {
    const stub = setupChrome();
    const { input } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'chatgpt.com' });
    dispose();

    setInputText(input, 'fetch https://target.example');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    expect(stub.sendMessageMock).not.toHaveBeenCalled();
  });

  it('returns a no-op disposer when adapter does not match the hostname', async () => {
    setupChrome();
    const { input } = buildComposer();
    const dispose = attachInterceptObserver({ adapter: chatgptInterceptAdapter, hostname: 'example.com' });
    setInputText(input, 'fetch https://target.example');
    await vi.advanceTimersByTimeAsync(INTERCEPT_INPUT_DEBOUNCE_MS + 50);
    // no-op dispose should not throw
    expect(() => dispose()).not.toThrow();
  });
});
