import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturedResponse } from '@/types/portal-response.js';
import { sendResponseCaptured } from './dispatch.js';

const CAPTURE: CapturedResponse = {
  portalId: 'chatgpt',
  text: 'hello',
  capturedAt: 1714400000000,
  conversationId: 'abc',
  messageId: 'm-1',
  streamComplete: true,
};

const META = { url: 'https://chatgpt.com/c/abc', origin: 'https://chatgpt.com' };

interface SentMessage {
  readonly type: string;
  readonly capture: CapturedResponse;
  readonly metadata: { readonly url: string; readonly origin: string };
  readonly tabId: number;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('sendResponseCaptured', () => {
  it('sends a RESPONSE_CAPTURED message with the full capture and metadata', async () => {
    const calls: SentMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (msg: SentMessage) => {
          calls.push(msg);
        }),
        lastError: undefined,
      },
    });
    await sendResponseCaptured(CAPTURE, META);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe('RESPONSE_CAPTURED');
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
    await expect(sendResponseCaptured(CAPTURE, META)).resolves.toBeUndefined();
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
    await sendResponseCaptured(CAPTURE, META);
    expect(calls).toBe(2);
  });
});
