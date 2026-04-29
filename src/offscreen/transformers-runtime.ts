import { createLogger } from '@/shared/logger.js';

type TransformersModule = typeof import('@huggingface/transformers');

const log = createLogger('TransformersRuntime');

let cachedModule: TransformersModule | null = null;
let importPromise: Promise<TransformersModule> | null = null;
let envConfigured = false;
let importerOverride: (() => Promise<TransformersModule>) | null = null;

/**
 * Issue #156 — single-flight loader for `@huggingface/transformers` v4. Both
 * the NER engine and the lang-detect xlm-roberta fallback consume this so
 * the (~1–2 MB) library bundle is loaded once per offscreen-doc lifetime,
 * `env.backends.onnx.wasm.numThreads` is set exactly once, and concurrent
 * callers share one dynamic-import promise.
 *
 * `numThreads = 1` is set deliberately: offscreen documents cannot set
 * `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`, so
 * `SharedArrayBuffer` is unavailable and threaded WASM falls back to the
 * single-threaded variant. Setting numThreads=1 explicitly suppresses the
 * silent-fallback warning and makes the configuration intentional.
 */
export async function loadTransformers(): Promise<TransformersModule> {
  if (cachedModule !== null) return cachedModule;
  if (importPromise !== null) return importPromise;

  importPromise = (async () => {
    try {
      const mod =
        importerOverride !== null
          ? await importerOverride()
          : await import('@huggingface/transformers');
      if (!envConfigured) {
        try {
          const wasm = mod.env.backends.onnx.wasm;
          if (wasm !== undefined) {
            wasm.numThreads = 1;
          }
          envConfigured = true;
        } catch (err) {
          log.warn('failed to set ONNX wasm numThreads', err);
        }
      }
      cachedModule = mod;
      return mod;
    } finally {
      importPromise = null;
    }
  })();

  return importPromise;
}

export function _setTransformersImporterForTesting(
  factory: (() => Promise<TransformersModule>) | null,
): void {
  importerOverride = factory;
}

export function _resetForTesting(): void {
  cachedModule = null;
  importPromise = null;
  envConfigured = false;
  importerOverride = null;
}
