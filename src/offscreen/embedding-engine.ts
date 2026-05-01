import { createLogger } from '@/shared/logger.js';
import { loadTransformers } from './transformers-runtime.js';

const log = createLogger('EmbeddingEngine');

/**
 * Issue #129 Stage 2 — multilingual embedding model. `intfloat/multilingual-e5-small`
 * produces 384-dim sentence embeddings across 100+ languages in a shared space.
 * Quantized (q8) variant is served from the Hugging Face CDN, lazy-fetched on
 * first use, cached in the Cache API for subsequent loads (same lifecycle as
 * the NER model at `src/offscreen/ner-engine.ts`).
 *
 * The e5 family expects an instruction prefix on every input: `passage:` for
 * corpus/document text, `query:` for retrieval queries. Stage 4 (SW
 * orchestrator integration) will pass page chunks as `passage:` and Stage 3
 * (vector index) seeds use the same prefix; downstream consumers that compare
 * a freeform user-supplied query against the index would use `query:`.
 */
const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';
const EMBEDDING_DEVICE = 'wasm' as const;
const EMBEDDING_DTYPE = 'q8' as const;

export const EMBEDDING_DIM = 384;

interface EmbeddingTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

interface EmbedderPipeline {
  (
    inputs: string | readonly string[],
    options?: { pooling?: 'mean' | 'none'; normalize?: boolean },
  ): Promise<EmbeddingTensor>;
}

export interface EmbedOptions {
  /** `passage` (default) for corpus/document text; `query` for retrieval queries. */
  readonly mode?: 'passage' | 'query';
}

let embedderInstance: EmbedderPipeline | null = null;
let embedderInitPromise: Promise<EmbedderPipeline | null> | null = null;
let factoryOverride: (() => Promise<EmbedderPipeline>) | null = null;

async function defaultFactory(): Promise<EmbedderPipeline> {
  const tf = await loadTransformers();
  const pipe = await tf.pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
    dtype: EMBEDDING_DTYPE,
    device: EMBEDDING_DEVICE,
  });
  return ((inputs, options) =>
    pipe(inputs as string | string[], options) as unknown as Promise<EmbeddingTensor>) as EmbedderPipeline;
}

async function getOrInitEmbedder(): Promise<EmbedderPipeline | null> {
  if (embedderInstance !== null) return embedderInstance;
  if (embedderInitPromise !== null) return embedderInitPromise;

  const factory = factoryOverride ?? defaultFactory;

  embedderInitPromise = (async (): Promise<EmbedderPipeline | null> => {
    try {
      const created = await factory();
      embedderInstance = created;
      return created;
    } catch (err) {
      log.warn('Embedder pipeline init failed', err);
      return null;
    } finally {
      embedderInitPromise = null;
    }
  })();

  return embedderInitPromise;
}

function prefix(text: string, mode: 'passage' | 'query'): string {
  return `${mode}: ${text}`;
}

function sliceRow(flat: Float32Array, row: number, dim: number): Float32Array {
  return flat.slice(row * dim, (row + 1) * dim);
}

function dimsMatchSingle(dims: readonly number[]): boolean {
  if (dims.length === 1) return dims[0] === EMBEDDING_DIM;
  if (dims.length === 2) return dims[0] === 1 && dims[1] === EMBEDDING_DIM;
  return false;
}

function dimsMatchBatch(dims: readonly number[], expectedRows: number): boolean {
  return dims.length === 2 && dims[0] === expectedRows && dims[1] === EMBEDDING_DIM;
}

/**
 * Embeds a single string and returns a `Float32Array` of length
 * `EMBEDDING_DIM`. Returns null on empty input, model load failure, or any
 * unexpected pipeline error. The result is L2-normalised, so callers can use
 * a plain dot product as cosine similarity.
 */
export async function embedText(
  text: string,
  options?: EmbedOptions,
): Promise<Float32Array | null> {
  if (text.length === 0) return null;

  try {
    const pipe = await getOrInitEmbedder();
    if (pipe === null) return null;
    const mode = options?.mode ?? 'passage';
    const tensor = await pipe(prefix(text, mode), { pooling: 'mean', normalize: true });
    if (!dimsMatchSingle(tensor.dims)) {
      log.warn('Unexpected embedding tensor dims', { dims: tensor.dims });
      return null;
    }
    if (tensor.data.length < EMBEDDING_DIM) return null;
    return tensor.data.slice(0, EMBEDDING_DIM);
  } catch (err) {
    log.warn('embedText unexpected failure', err);
    return null;
  }
}

/**
 * Batched embedding. Returns `Float32Array[]` aligned to `texts`, or `null`
 * on init/inference failure. Empty input array → `[]`.
 */
export async function embedTexts(
  texts: readonly string[],
  options?: EmbedOptions,
): Promise<Float32Array[] | null> {
  if (texts.length === 0) return [];

  try {
    const pipe = await getOrInitEmbedder();
    if (pipe === null) return null;
    const mode = options?.mode ?? 'passage';
    const inputs = texts.map((t) => prefix(t, mode));
    const tensor = await pipe(inputs, { pooling: 'mean', normalize: true });
    if (!dimsMatchBatch(tensor.dims, texts.length)) {
      log.warn('Unexpected batch embedding tensor dims', { dims: tensor.dims, expected: texts.length });
      return null;
    }
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(sliceRow(tensor.data, i, EMBEDDING_DIM));
    }
    return out;
  } catch (err) {
    log.warn('embedTexts unexpected failure', err);
    return null;
  }
}

export function _setEmbedderFactoryForTesting(
  factory: (() => Promise<EmbedderPipeline>) | null,
): void {
  factoryOverride = factory;
}

export function _resetForTesting(): void {
  embedderInstance = null;
  embedderInitPromise = null;
  factoryOverride = null;
}
