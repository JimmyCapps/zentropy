import { CreateMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm';
import { MODEL_PRIMARY, MODEL_FALLBACK, STORAGE_KEY_MODEL } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

// Chrome's built-in Prompt API (window.LanguageModel, Gemini Nano) is NOT
// called from the offscreen document. It runs from the Phase 3 Stage 4
// harness page (window context) per the spec-safe routing documented in
// docs/testing/PHASE3_TRACK_A_RUNTIME_DIAGNOSTIC.md. The offscreen engine
// exclusively hosts WebGPU MLC models via @mlc-ai/web-llm.

const log = createLogger('Engine');

interface CompletionEngine {
  generate(systemPrompt: string, userMessage: string): Promise<string>;
  id: string;
}

let engine: CompletionEngine | null = null;
let loadedModelId: string | null = null;
// Phase 4 Stage 4B.3 — single-flight promise for engine initialisation.
// Concurrent callers of initEngine() during the load window must all await
// the SAME in-flight promise. Previously each caller re-entered the function
// body and raced independent CreateMLCEngine calls, which produced partial/
// empty probe results on the first cell of a sweep (cold-start race).
let initPromise: Promise<CompletionEngine> | null = null;

function reportProgress(report: InitProgressReport): void {
  log.info(`Model load: ${report.text} (${Math.round((report.progress ?? 0) * 100)}%)`);
  chrome.runtime.sendMessage({
    type: 'ENGINE_STATUS',
    status: 'loading',
    progress: report.progress,
    modelId: loadedModelId,
  });
}

/**
 * Read the configured model id.
 *
 * Preference order:
 *   1. URL query string `?model=<id>` — set by the Stage 5 runner when
 *      creating the offscreen document. This is a synchronous read that
 *      bypasses `chrome.storage` entirely, avoiding the cross-context
 *      consistency lag observed in Stage 5 (SW wrote `honeyllm:model`,
 *      offscreen read empty within the same tick and fell back to
 *      MODEL_PRIMARY).
 *   2. `chrome.storage.local[STORAGE_KEY_MODEL]` — the production path
 *      used when a user selects a model via future popup UI.
 *   3. `MODEL_PRIMARY` fallback.
 *
 * `chrome.storage` is occasionally still undefined at the moment the
 * offscreen module body runs (observed in fresh Playwright profiles on
 * Chromium 127+), so step 2 polls with a short backoff for up to ~2 s.
 */
async function getPreferredModel(): Promise<string> {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const fromUrl = params.get('model');
    if (fromUrl !== null && fromUrl.length > 0) {
      log.info(`Model id from URL query: ${fromUrl}`);
      return fromUrl;
    }
  } catch {
    // location unavailable (non-browser context); fall through.
  }

  const deadline = Date.now() + 2_000;
  while (typeof chrome === 'undefined' || chrome.storage === undefined || chrome.storage.local === undefined) {
    if (Date.now() > deadline) {
      log.warn('chrome.storage.local never became available; using MODEL_PRIMARY');
      return MODEL_PRIMARY;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const result = await chrome.storage.local.get(STORAGE_KEY_MODEL);
  return (result[STORAGE_KEY_MODEL] as string) ?? MODEL_PRIMARY;
}

async function createMLCEngineAdapter(modelId: string): Promise<CompletionEngine> {
  let mlc: MLCEngine;
  let effectiveModelId = modelId;
  try {
    mlc = await CreateMLCEngine(modelId, { initProgressCallback: reportProgress });
  } catch (err) {
    log.warn(`Primary model failed, falling back to ${MODEL_FALLBACK}`, err);
    effectiveModelId = MODEL_FALLBACK;
    loadedModelId = MODEL_FALLBACK;
    mlc = await CreateMLCEngine(MODEL_FALLBACK, { initProgressCallback: reportProgress });
  }
  return {
    id: effectiveModelId,
    async generate(systemPrompt: string, userMessage: string): Promise<string> {
      const response = await mlc.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 512,
      });
      return response.choices[0]?.message?.content ?? '';
    },
  };
}

export async function initEngine(): Promise<CompletionEngine> {
  if (engine !== null) return engine;
  if (initPromise !== null) return initPromise;

  // Single-flight: first caller starts the load, all concurrent callers
  // (e.g. module-load + concurrent RUN_PROBES arrivals) await the same
  // promise. On success the initPromise is cleared so future calls short-
  // circuit via the `engine !== null` check; on failure it's also cleared
  // so a subsequent call can retry (matches the Track A direct-probe path
  // that reported errorMessage rather than caching a poisoned promise).
  initPromise = (async () => {
    const modelId = await getPreferredModel();
    loadedModelId = modelId;
    log.info(`Initializing engine with model: ${modelId}`);
    const created = await createMLCEngineAdapter(modelId);
    engine = created;
    log.info('Engine ready');
    chrome.runtime.sendMessage({
      type: 'ENGINE_STATUS',
      status: 'ready',
      modelId: loadedModelId,
    });
    return created;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

export async function getEngine(): Promise<CompletionEngine> {
  if (engine !== null) return engine;
  return initEngine();
}

export function getLoadedModelId(): string | null {
  return loadedModelId;
}

export async function generateCompletion(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const eng = await getEngine();
  return eng.generate(systemPrompt, userMessage);
}
