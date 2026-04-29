import { sha256Hex } from '@/shared/hash.js';
import type { Entity } from '@/hunters/ner/types.js';
import type { NerResultMessage, RunNerMessage } from '@/types/messages.js';

/**
 * Issue #156 — minimum chunk length to surface to NER. Shorter strings
 * almost never produce useful PER/ORG/LOC hits and cost an offscreen RPC
 * round-trip plus a 50–100 ms warm inference each. The same threshold is
 * used by the language router so the two systems behave consistently.
 */
export const MIN_NER_CHARS = 20;

export interface NerRouterDeps {
  readonly send: (text: string, offset: number) => Promise<NerResultMessage>;
}

const cache = new Map<string, readonly Entity[]>();
const inflight = new Map<string, Promise<readonly Entity[]>>();

async function defaultSend(text: string, chunkOffset: number): Promise<NerResultMessage> {
  const message: RunNerMessage = { type: 'RUN_NER', text, chunkOffset };
  const reply = (await chrome.runtime.sendMessage(message)) as NerResultMessage;
  return reply;
}

const defaultDeps: NerRouterDeps = { send: defaultSend };

/**
 * Issue #156 — sha256(text)-keyed single-flight + persistent cache for the
 * orchestrator's per-chunk NER lookup. Mirrors `language-router.ts`'s
 * pattern: cache survives for the SW lifetime so navigations that re-emit
 * the same chunk text (browse-back, hash-only navigation) skip the
 * offscreen round-trip. `chunkOffset` participates in the cache key
 * because the offscreen handler reuses it to absolute-ize entity spans —
 * different offsets must NOT share a cache entry.
 *
 * Total/never-throws contract: returns `[]` on send rejection, short
 * input, or empty offscreen reply. Exceptions become empty arrays so the
 * orchestrator merge pass keeps regex entities untouched.
 */
export async function runNerForChunk(
  text: string,
  chunkOffset: number,
  deps: NerRouterDeps = defaultDeps,
): Promise<readonly Entity[]> {
  if (text.length < MIN_NER_CHARS) return [];

  const baseKey = await sha256Hex(text);
  const key = `${baseKey}:${chunkOffset}`;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    try {
      const reply = await deps.send(text, chunkOffset);
      const entities = reply.entities ?? [];
      cache.set(key, entities);
      return entities;
    } catch {
      return [] as readonly Entity[];
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
