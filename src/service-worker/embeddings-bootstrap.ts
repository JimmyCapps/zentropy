import type { Hunter, HunterResult } from '@/hunters/base-hunter.js';
import { cleanResult } from '@/hunters/base-hunter.js';
import {
  createEmbeddingsHunter,
  embeddingsHunter as embeddingsHunterNoOp,
} from '@/hunters/embeddings/index.js';
import { loadInjectionCorpus } from '@/hunters/embeddings/corpus-loader.js';
import { createVectorIndex } from '@/hunters/embeddings/vector-index.js';
import type { ChunkEmbedFn, CorpusEntry } from '@/hunters/embeddings/types.js';
import { embedTextForChunk } from './embed-router.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('EmbeddingsBootstrap');

/**
 * Issue #129 Stage 4 — SW-side bootstrap that wires the embeddings Hunter.
 *
 * Stages 1–3 shipped the corpus + the offscreen embedding pipeline + the
 * vector-index module + a no-op Hunter default. This bootstrap is the
 * connective tissue that loads the populated corpus on SW startup, builds
 * the in-memory cosine-similarity index, and creates the live Hunter that
 * the orchestrator's `runHunters([...])` call actually invokes.
 *
 * Failure modes (any of these → fall back to the Stage 3 no-op so the
 * Phase 2 byte-locked baseline (162 rows in `inbrowser-results.json`) still
 * sees zero changed verdicts):
 * - `chrome.runtime.getURL` unavailable (test env) → no-op
 * - Corpus fetch / parse / verify fails → empty corpus → empty index →
 *   `createEmbeddingsHunter` already short-circuits to clean
 * - Init throws unexpectedly → caught here, bootstrap returns no-op
 *
 * The exported `embeddingsHunter` is a synchronous proxy: the orchestrator
 * imports it once at module load, but its `scan()` waits on the bootstrap
 * promise and delegates. Until the bootstrap resolves the proxy returns a
 * clean result (no-op). This preserves the orchestrator's existing import
 * shape and the Phase 2 baseline contract during the cold-load window.
 */

interface BootstrapDeps {
  readonly getURL: (path: string) => string;
  readonly loadCorpus: (opts: { url: string }) => Promise<readonly CorpusEntry[]>;
  readonly embedFn: ChunkEmbedFn;
}

const CORPUS_PATH = 'data/injection-corpus.json';

let resolvedHunter: Hunter | null = null;
let initPromise: Promise<Hunter> | null = null;
let testDeps: BootstrapDeps | null = null;

function getDefaultDeps(): BootstrapDeps {
  return {
    getURL: (path) => chrome.runtime.getURL(path),
    loadCorpus: loadInjectionCorpus,
    embedFn: embedTextForChunk,
  };
}

async function doBootstrap(deps: BootstrapDeps): Promise<Hunter> {
  try {
    const url = deps.getURL(CORPUS_PATH);
    const corpus = await deps.loadCorpus({ url });
    if (corpus.length === 0) {
      log.warn('Embeddings corpus loaded empty; staying as no-op');
      return embeddingsHunterNoOp;
    }
    const index = createVectorIndex(corpus);
    if (index.size === 0) {
      log.warn('Vector index built with zero indexable rows; staying as no-op');
      return embeddingsHunterNoOp;
    }
    log.info(`Embeddings hunter wired with ${index.size} corpus rows`);
    return createEmbeddingsHunter({ embedFn: deps.embedFn, index });
  } catch (err) {
    log.warn('Embeddings bootstrap failed; staying as no-op', err);
    return embeddingsHunterNoOp;
  }
}

/**
 * Trigger the corpus load + index build. Idempotent + single-flight: every
 * caller after the first joins the same promise. On failure we fall back to
 * the Stage 3 no-op hunter and remember that result — no retry loop in the
 * orchestrator hot path. The next SW wakeup gets a fresh state.
 */
export function bootstrapEmbeddingsHunter(): Promise<Hunter> {
  if (resolvedHunter !== null) return Promise.resolve(resolvedHunter);
  if (initPromise !== null) return initPromise;

  const deps = testDeps ?? getDefaultDeps();
  initPromise = doBootstrap(deps).then((hunter) => {
    resolvedHunter = hunter;
    return hunter;
  });
  return initPromise;
}

/**
 * Synchronous proxy used by the orchestrator. Until `bootstrapEmbeddingsHunter`
 * resolves, `scan()` returns a clean (no-op) result so the Phase 2 byte-locked
 * baseline stays byte-identical during cold-load. After resolution every call
 * delegates to the wired hunter (or the no-op fallback if init failed).
 */
export const embeddingsHunter: Hunter = {
  name: 'embeddings',
  async scan(chunk: string): Promise<HunterResult> {
    if (resolvedHunter !== null) return resolvedHunter.scan(chunk);
    if (initPromise === null) return cleanResult('embeddings');
    // Bootstrap is in flight. Returning clean here (rather than awaiting
    // the init) keeps the orchestrator's chunk loop responsive during the
    // cold-load window. The Phase 2 baseline contract permits this — the
    // Stage 3 no-op is the fallback.
    return cleanResult('embeddings');
  },
};

export function _resetForTesting(): void {
  resolvedHunter = null;
  initPromise = null;
  testDeps = null;
}

export function _setBootstrapDepsForTesting(deps: BootstrapDeps | null): void {
  testDeps = deps;
}
