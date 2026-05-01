import { describe, it, expect, beforeEach } from 'vitest';
import { embedTextForChunk, _resetForTesting, MIN_EMBED_CHARS } from './embed-router.js';
import type { EmbedResultMessage } from '@/types/messages.js';

interface FakeDeps {
  readonly send: (text: string) => Promise<EmbedResultMessage>;
}

function fakeReply(embedding: readonly number[] | null): EmbedResultMessage {
  return {
    type: 'EMBED_RESULT',
    embedding,
    inferenceMs: 7,
  };
}

function unitArray(seed: number, dim = 384): readonly number[] {
  const out: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const x = Math.sin(seed * 7919 + i * 31);
    out.push(x);
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  return out.map((x) => x / norm);
}

describe('embedTextForChunk (issue #129 Stage 4)', () => {
  beforeEach(() => _resetForTesting());

  it('cache hit — same text → one RPC across multiple calls', async () => {
    const vec = unitArray(1);
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply(vec);
      },
    };

    const r1 = await embedTextForChunk('repeated chunk text content longer than threshold', deps);
    const r2 = await embedTextForChunk('repeated chunk text content longer than threshold', deps);
    const r3 = await embedTextForChunk('repeated chunk text content longer than threshold', deps);

    expect(sendCalls).toBe(1);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
    expect(Array.from(r1!)).toEqual(Array.from(r2!));
    expect(Array.from(r2!)).toEqual(Array.from(r3!));
  });

  it('different text → separate RPCs', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply(unitArray(sendCalls));
      },
    };

    await embedTextForChunk('chunk A content longer than threshold', deps);
    await embedTextForChunk('chunk B content longer than threshold', deps);
    expect(sendCalls).toBe(2);
  });

  it('single-flight: concurrent calls for same text trigger one RPC', async () => {
    let sendCalls = 0;
    let resolve: ((reply: EmbedResultMessage) => void) | undefined;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return new Promise<EmbedResultMessage>((r) => {
          resolve = r;
        });
      },
    };

    const promises = [
      embedTextForChunk('shared text longer than threshold', deps),
      embedTextForChunk('shared text longer than threshold', deps),
      embedTextForChunk('shared text longer than threshold', deps),
    ];
    // sha256 hashing is genuinely async; allow the inflight registration to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(sendCalls).toBe(1);
    resolve!(fakeReply(unitArray(1)));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(3);
    expect(sendCalls).toBe(1);
    for (const r of results) expect(r).not.toBeNull();
  });

  it('returns null when send throws', async () => {
    const deps: FakeDeps = {
      send: async () => {
        throw new Error('SW → offscreen channel disconnected');
      },
    };
    const result = await embedTextForChunk('a long enough chunk to clear MIN_EMBED_CHARS', deps);
    expect(result).toBeNull();
  });

  it('returns null when offscreen replies with null embedding (model load failure)', async () => {
    const deps: FakeDeps = {
      send: async () => fakeReply(null),
    };
    const result = await embedTextForChunk('a long enough chunk to clear MIN_EMBED_CHARS', deps);
    expect(result).toBeNull();
  });

  it('returns null when reply embedding has wrong dim', async () => {
    const deps: FakeDeps = {
      send: async () => fakeReply(unitArray(1, 100)),
    };
    const result = await embedTextForChunk('a long enough chunk to clear MIN_EMBED_CHARS', deps);
    expect(result).toBeNull();
  });

  it('skips RPC for short text', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply(unitArray(1));
      },
    };
    const result = await embedTextForChunk('hi', deps);
    expect(result).toBeNull();
    expect(sendCalls).toBe(0);
    expect(MIN_EMBED_CHARS).toBeGreaterThan(2);
  });

  it('returns Float32Array of length 384 when reply is well-formed', async () => {
    const vec = unitArray(7);
    const deps: FakeDeps = {
      send: async () => fakeReply(vec),
    };
    const result = await embedTextForChunk('payload longer than the threshold for embedding', deps);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result!.length).toBe(384);
    for (let i = 0; i < 384; i++) {
      expect(result![i]).toBeCloseTo(vec[i]!, 5);
    }
  });

  it('caches null replies so repeat calls do not retry', async () => {
    let sendCalls = 0;
    const deps: FakeDeps = {
      send: async () => {
        sendCalls++;
        return fakeReply(null);
      },
    };
    await embedTextForChunk('a long enough chunk to clear MIN_EMBED_CHARS', deps);
    await embedTextForChunk('a long enough chunk to clear MIN_EMBED_CHARS', deps);
    expect(sendCalls).toBe(1);
  });
});
