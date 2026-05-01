import type { Entity, EntityType } from '@/hunters/ner/types.js';
import { createLogger } from '@/shared/logger.js';
import { loadTransformers } from './transformers-runtime.js';

const log = createLogger('NerEngine');

/**
 * Issue #156 — quantized DistilBERT-NER served from the Hugging Face CDN.
 * Lazy-fetched on first use; cached in the Cache API for subsequent loads.
 * `dtype: 'q8'` matches `DEFAULT_DEVICE_DTYPE_MAPPING.wasm`, but is named
 * explicitly so an upstream default change doesn't silently degrade us to
 * fp32.
 */
// Issue #209 — `Xenova/distilbert-base-NER` is now gated / no longer publicly
// resolvable from `huggingface.co/Xenova/...` and returns 404 to anonymous
// extension fetches. `Xenova/bert-base-NER` is the closest publicly-available
// ONNX-converted NER model on the same Hub namespace; same task signature
// (token-classification with PER/LOC/ORG/MISC labels), slightly larger model
// (~110 MB q8 vs ~65 MB), comparable accuracy on English NER.
const NER_MODEL_ID = 'Xenova/bert-base-NER';
const NER_DEVICE = 'wasm' as const;
const NER_DTYPE = 'q8' as const;
const NER_AGGREGATION = 'simple' as const;

const DEFAULT_INFERENCE_DEADLINE_MS = 250;

/**
 * Issue #156 — confidence floor for surfacing freeform NER entities. The
 * regex extractors at `src/hunters/ner/extractors/*` use 0.6–0.95 ranges; a
 * 0.85 floor for freeform output keeps the noise-to-signal ratio inside
 * acceptable bounds for evidence-review rendering. Below this we'd surface
 * tokenization artefacts (sub-words, partial spans) into the popup.
 */
const CONFIDENCE_FLOOR = 0.85;

const TAG_TO_TYPE: Readonly<Record<string, EntityType>> = {
  PER: 'person',
  ORG: 'organization',
  LOC: 'location',
  MISC: 'misc',
};

interface NerHit {
  readonly entity_group?: string;
  readonly entity?: string;
  readonly score: number;
  readonly word: string;
  readonly start?: number;
  readonly end?: number;
}

type NerAggregation = 'simple' | 'none';

interface NerPipeline {
  (text: string, options?: { aggregation_strategy?: NerAggregation }): Promise<readonly NerHit[]>;
}

let nerInstance: NerPipeline | null = null;
let nerInitPromise: Promise<NerPipeline | null> | null = null;
let factoryOverride: (() => Promise<NerPipeline>) | null = null;

function timeoutSignal(ms: number): Promise<null> {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
}

async function defaultFactory(): Promise<NerPipeline> {
  const tf = await loadTransformers();
  const pipe = await tf.pipeline('token-classification', NER_MODEL_ID, {
    dtype: NER_DTYPE,
    device: NER_DEVICE,
  });
  // Narrow the typed pipeline to the structural NerPipeline surface used
  // here. The transformers.js callable signature is over-specified for our
  // use; we only need (text, options) → hits[].
  return (text: string, options?: { aggregation_strategy?: NerAggregation }) =>
    pipe(text, options) as unknown as Promise<readonly NerHit[]>;
}

async function getOrInitNer(): Promise<NerPipeline | null> {
  if (nerInstance !== null) return nerInstance;
  if (nerInitPromise !== null) return nerInitPromise;

  const factory = factoryOverride ?? defaultFactory;

  nerInitPromise = (async (): Promise<NerPipeline | null> => {
    try {
      const created = await factory();
      nerInstance = created;
      return created;
    } catch (err) {
      log.warn('NER pipeline init failed', err);
      return null;
    } finally {
      nerInitPromise = null;
    }
  })();

  return nerInitPromise;
}

/**
 * Issue #156 — total function. Returns `readonly Entity[]` (`[]` on any
 * failure path: empty input, model load failure, deadline miss, unexpected
 * pipeline error). The caller (`handleRunNer` invocation in
 * `src/offscreen/index.ts`) treats `[]` as "no NER signal" and the
 * orchestrator merge pass keeps the regex-extracted entities untouched.
 *
 * The `deadlineMs` parameter races BOTH the cold-load and inference
 * combined, so the first call after the offscreen-doc is created will
 * almost always return `[]` (CDN model fetch + ONNX session init takes
 * 2–5s warm). Production wiring pre-warms NER on offscreen-doc creation
 * to minimise that window.
 */
export async function handleRunNer(
  text: string,
  deadlineMs: number = DEFAULT_INFERENCE_DEADLINE_MS,
  offset = 0,
): Promise<readonly Entity[]> {
  if (text.length === 0) return [];

  const work = (async (): Promise<readonly Entity[]> => {
    const pipe = await getOrInitNer();
    if (pipe === null) return [];
    const hits = await pipe(text, { aggregation_strategy: NER_AGGREGATION });
    return mapHitsToEntities(hits, offset);
  })();

  try {
    const result = await Promise.race([work, timeoutSignal(deadlineMs)]);
    if (result === null) {
      log.debug(`NER inference exceeded ${deadlineMs}ms deadline`);
      return [];
    }
    return result;
  } catch (err) {
    log.warn('handleRunNer unexpected failure', err);
    return [];
  }
}

function mapHitsToEntities(hits: readonly NerHit[], offset: number): readonly Entity[] {
  const entities: Entity[] = [];
  for (const hit of hits) {
    if (hit.score < CONFIDENCE_FLOOR) continue;
    if (hit.start === undefined || hit.end === undefined) continue;
    const rawTag = hit.entity_group ?? hit.entity ?? '';
    const normalisedTag = rawTag.replace(/^[BI]-/, '');
    const type = TAG_TO_TYPE[normalisedTag];
    if (type === undefined) continue;
    entities.push({
      type,
      value: hit.word,
      span: [offset + hit.start, offset + hit.end] as const,
      confidence: hit.score,
    });
  }
  return entities;
}

export function _setNerFactoryForTesting(
  factory: (() => Promise<NerPipeline>) | null,
): void {
  factoryOverride = factory;
}

export function _resetForTesting(): void {
  nerInstance = null;
  nerInitPromise = null;
  factoryOverride = null;
}
