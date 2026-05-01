import { createLogger } from '@/shared/logger.js';
import { EMBEDDING_DIM } from '@/offscreen/embedding-engine.js';
import type { CorpusEntry } from './types.js';

const log = createLogger('CorpusLoader');

/**
 * Issue #129 Stage 3 — corpus loader for the in-memory vector index.
 *
 * The corpus lives at `data/injection-corpus.json` (schema v2, populated in
 * Stage 2). Stage 5 of the build pipeline copies it to
 * `dist/data/injection-corpus.json` so the SW can `chrome.runtime.getURL` +
 * fetch it on startup. This loader is fail-safe: every error path returns
 * `[]` rather than throwing so a corrupt or missing bundle never breaks the
 * orchestrator hot path. The Hunter itself reduces to a no-op when the
 * resulting index is empty.
 */
export interface LoadInjectionCorpusOptions {
  readonly url: string;
  readonly fetcher?: typeof fetch;
}

export async function loadInjectionCorpus(
  opts: LoadInjectionCorpusOptions,
): Promise<readonly CorpusEntry[]> {
  const fetcher = opts.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher(opts.url);
  } catch (err) {
    log.warn('Corpus fetch failed', err);
    return [];
  }

  if (!response.ok) {
    log.warn('Corpus fetch non-ok', { status: response.status });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    log.warn('Corpus JSON parse failed', err);
    return [];
  }

  if (!isObject(parsed)) return [];
  const entriesRaw = parsed['entries'];
  if (!Array.isArray(entriesRaw)) return [];

  const out: CorpusEntry[] = [];
  for (const raw of entriesRaw) {
    const entry = coerceCorpusEntry(raw);
    if (entry !== null) out.push(entry);
  }
  return out;
}

function coerceCorpusEntry(raw: unknown): CorpusEntry | null {
  if (!isObject(raw)) return null;
  const id = raw['id'];
  const source = raw['source'];
  const text = raw['text'];
  const lang = raw['lang'];
  const techniques = raw['techniques'];
  const embedding = raw['embedding'];

  if (typeof id !== 'string') return null;
  if (typeof source !== 'string') return null;
  if (typeof text !== 'string') return null;
  if (typeof lang !== 'string') return null;
  if (!Array.isArray(techniques)) return null;
  for (const t of techniques) if (typeof t !== 'string') return null;

  if (!Array.isArray(embedding)) return null;
  if (embedding.length !== EMBEDDING_DIM) return null;
  for (const x of embedding) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  }

  return {
    id,
    source,
    text,
    lang,
    techniques: techniques as readonly string[],
    embedding: embedding as readonly number[],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
