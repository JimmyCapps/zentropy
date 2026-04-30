import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturedThinking } from '@/types/portal-response.js';
import { sendThinkingCaptured } from './dispatch.js';

const CAPTURE: CapturedThinking = {
  portalId: 'gemini',
  text: 'thinking step',
  capturedAt: 1714400000000,
  conversationId: 'abc',
  messageId: 'gemini-thinking:thinking_step',
  streamComplete: true,
};

const META = { url: 'https://gemini.google.com/?c=abc', origin: 'https://gemini.google.com' };

interface SentMessage {
  readonly type: string;
  readonly capture: CapturedThinking;
  readonly metadata: { readonly url: string; readonly origin: string };
  readonly tabId: number;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('sendThinkingCaptured', () => {
  it('sends a THINKING_CAPTURED message with the full capture and metadata', async () => {
    const calls: SentMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (msg: SentMessage) => {
          calls.push(msg);
        }),
        lastError: undefined,
      },
    });
    await sendThinkingCaptured(CAPTURE, META);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe('THINKING_CAPTURED');
    expect(calls[0]?.capture).toEqual(CAPTURE);
    expect(calls[0]?.metadata).toEqual(META);
    expect(calls[0]?.tabId).toBe(0);
  });

  it('swallows transient runtime errors without throwing', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }),
        lastError: undefined,
      },
    });
    await expect(sendThinkingCaptured(CAPTURE, META)).resolves.toBeUndefined();
  });

  it('retries once on a transient connection error', async () => {
    let calls = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => {
          calls += 1;
          if (calls === 1) throw new Error('Could not establish connection.');
          return undefined;
        }),
        lastError: undefined,
      },
    });
    await sendThinkingCaptured(CAPTURE, META);
    expect(calls).toBe(2);
  });

  it('swallows non-transient errors without retry', async () => {
    let calls = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => {
          calls += 1;
          throw new Error('something else broke');
        }),
        lastError: undefined,
      },
    });
    await expect(sendThinkingCaptured(CAPTURE, META)).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
