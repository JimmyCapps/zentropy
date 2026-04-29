import { createLogger } from '@/shared/logger.js';

type TransformersModule = typeof import('@huggingface/transformers');

const log = createLogger('TransformersRuntime');

/**
 * Issue #156 — `@huggingface/transformers` is marked external in build.ts
 * so Rollup leaves the runtime `import()` call intact instead of inlining
 * the (~432 KB minified) library into every offscreen rebuild. The
 * prebuilt browser bundle is copied to `dist/transformers/` at build time;
 * at runtime we resolve the URL via `chrome.runtime.getURL` and `import()`
 * it as an ES module from the extension origin (no CSP `unsafe-eval`
 * needed; same-origin module imports are allowed under
 * `script-src 'self'`).
 */
const PREBUILT_BUNDLE_PATH = 'dist/transformers/transformers.web.min.js';

let cachedModule: TransformersModule | null = null;
let importPromise: Promise<TransformersModule> | null = null;
let envConfigured = false;
let importerOverride: (() => Promise<TransformersModule>) | null = null;

async function defaultImporter(): Promise<TransformersModule> {
  // chrome.runtime.getURL produces `chrome-extension://<id>/dist/transformers/...`
  // which the offscreen doc can `import()` as an ES module. The string is
  // built at runtime so the bundler does not statically resolve it.
  const url = chrome.runtime.getURL(PREBUILT_BUNDLE_PATH);
  const mod = (await import(/* @vite-ignore */ url)) as TransformersModule;
  return mod;
}

export async function loadTransformers(): Promise<TransformersModule> {
  if (cachedModule !== null) return cachedModule;
  if (importPromise !== null) return importPromise;

  importPromise = (async () => {
    try {
      const importer = importerOverride ?? defaultImporter;
      const mod = await importer();
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
