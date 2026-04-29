import { describe, it, expect, beforeEach } from 'vitest';
import { runNerForChunk, _resetForTesting } from './ner-router.js';
import type { Entity } from '@/hunters/ner/types.js';
import type { NerResultMessage } from '@/types/messages.js';

interface FakeDeps {
  readonly send: (text: string, offset: number) => Promise<NerResultMessage>;
}

function fakeReply(entities: readonly Entity[]): NerResultMessage {
  return {
    type: 'NER_RESULT',
    entities,
    inferenceMs: 12,
  };
}

describe('runNerForChunk (issue #156)', () => {
  beforeEach(() => _resetForTesting());

  it('T13: cache hit — same chunk → one RPC across multiple calls', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply([
          {
            type: 'person',
            value: 'Alice',
            span: [0, 5],
            confidence: 0.95,
          },
        ]);
      },
    };

    const r1 = await runNerForChunk('repeated chunk text content', 0, deps);
    const r2 = await runNerForChunk('repeated chunk text content', 0, deps);
    const r3 = await runNerForChunk('repeated chunk text content', 0, deps);

    expect(sendCalls).toBe(1);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('different chunk text → separate RPCs', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply([]);
      },
    };

    await runNerForChunk('chunk A content longer than threshold', 0, deps);
    await runNerForChunk('chunk B content longer than threshold', 0, deps);
    expect(sendCalls).toBe(2);
  });

  it('single-flight: concurrent calls for same text trigger one RPC', async () => {
    let sendCalls = 0;
    let resolve: ((reply: NerResultMessage) => void) | undefined;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return new Promise<NerResultMessage>((r) => { resolve = r; });
      },
    };

    const promises = [
      runNerForChunk('shared text longer than threshold', 0, deps),
      runNerForChunk('shared text longer than threshold', 0, deps),
      runNerForChunk('shared text longer than threshold', 0, deps),
    ];
    // Wait for sha256Hex hashing + inflight registration to complete.
    // crypto.subtle.digest is implemented as a real async op so a single
    // microtask flush is not enough.
    await new Promise((r) => setTimeout(r, 20));
    expect(sendCalls).toBe(1);
    resolve!(fakeReply([]));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(3);
    expect(sendCalls).toBe(1);
  });

  it('returns [] when send throws', async () => {
    const deps: FakeDeps = {
      send: async () => {
        throw new Error('SW → offscreen channel disconnected');
      },
    };
    const result = await runNerForChunk('a long enough chunk to clear MIN_NER_CHARS', 0, deps);
    expect(result).toEqual([]);
  });

  it('skips RPC for short text', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply([]);
      },
    };

    const result = await runNerForChunk('hi', 0, deps);
    expect(result).toEqual([]);
    expect(sendCalls).toBe(0);
  });
});
