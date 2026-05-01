import { sha256Hex } from '@/shared/hash.js';
import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import type { EmbedResultMessage, EmbedTextMessage } from '@/types/messages.js';

/**
 * Issue #129 Stage 4 — minimum chunk length to surface to the embedding
 * pipeline. Shorter strings produce noisy mean-pooled vectors and burn an
 * offscreen RPC round-trip plus a ~30–60 ms warm inference each. Mirrors
 * `MIN_NER_CHARS` so the two SW-side routers behave consistently.
 */
export const MIN_EMBED_CHARS = 20;

export interface EmbedRouterDeps {
  readonly send: (text: string) => Promise<EmbedResultMessage>;
}

const cache = new Map<string, Float32Array | null>();
const inflight = new Map<string, Promise<Float32Array | null>>();

async function defaultSend(text: string): Promise<EmbedResultMessage> {
  const message: EmbedTextMessage = { type: 'EMBED_TEXT', text };
  const reply = (await chrome.runtime.sendMessage(message)) as EmbedResultMessage;
  return reply;
}

const defaultDeps: EmbedRouterDeps = { send: defaultSend };

function rehydrate(reply: EmbedResultMessage): Float32Array | null {
  if (reply.embedding === null) return null;
  if (reply.embedding.length !== EMBEDDING_DIM) return null;
  const out = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const v = reply.embedding[i]!;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

/**
 * Issue #129 Stage 4 — sha256(text)-keyed single-flight + persistent cache
 * for the embeddings Hunter's per-chunk vector lookup. Mirrors
 * `ner-router.ts`'s shape: cache survives for the SW lifetime so navigations
 * that re-emit the same chunk text skip the offscreen round-trip. Total /
 * never-throws contract: returns `null` on send rejection, short input,
 * dim-mismatch, or `null` reply embedding so the embeddings Hunter folds
 * into the no-signal branch (`cleanResult`) in `createEmbeddingsHunter`.
 *
 * `null` results are cached so a one-time init failure does not loop the
 * orchestrator into N retries on the next N chunks. The next SW wakeup
 * starts with a fresh cache.
 */
export async function embedTextForChunk(
  text: string,
  deps: EmbedRouterDeps = defaultDeps,
): Promise<Float32Array | null> {
  if (text.length < MIN_EMBED_CHARS) return null;

  const key = await sha256Hex(text);

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = (async (): Promise<Float32Array | null> => {
    try {
      const reply = await deps.send(text);
      const vec = rehydrate(reply);
      cache.set(key, vec);
      return vec;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function _resetForTesting(): void {
  cache.clear();
  inflight.clear();
}
