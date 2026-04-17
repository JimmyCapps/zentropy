import { CreateMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm';
import {
  MODEL_PRIMARY,
  MODEL_FALLBACK,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_CANARY,
  CANARY_CATALOG,
  CANARY_FALLBACK_ORDER,
  DEFAULT_CANARY_ID,
  type CanaryId,
  type CanaryDefinition,
} from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

// Phase 4 Stage 4D.1 — dual-path engine.
//
// Prior Phase 3 note said the Prompt API (window.LanguageModel) was NOT
// called from the offscreen document. Empirical check in Stage 4D.1
// (2026-04-18) showed window.LanguageModel is actually available in the
// offscreen context when Chrome's EPP grants it to the profile. Nano is
// therefore hosted directly in the offscreen document alongside MLC,
// selected via the canary catalog at initEngine() time.

const log = createLogger('Engine');

export interface CompletionEngine {
  readonly id: string;
  generate(systemPrompt: string, userMessage: string): Promise<string>;
}

/**
 * Minimal structural types for Chrome's Prompt API. The real API is
 * declared on the ambient Window interface by Chrome, but typing it
 * structurally here keeps the adapter self-contained and lets tests
 * inject a fake.
 */
interface NanoSession {
  prompt(userMessage: string): Promise<string>;
  destroy(): void;
}

interface NanoCreateOptions {
  readonly initialPrompts?: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  readonly temperature?: number;
  readonly topK?: number;
  readonly expectedOutputs?: ReadonlyArray<{ type: 'text'; languages?: readonly string[] }>;
}

type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface NanoLanguageModel {
  availability(): Promise<NanoAvailability>;
  create(options?: NanoCreateOptions): Promise<NanoSession>;
}

function getNanoApi(): NanoLanguageModel | null {
  const lm = (globalThis as unknown as { LanguageModel?: NanoLanguageModel }).LanguageModel;
  return lm ?? null;
}

let engine: CompletionEngine | null = null;
let loadedModelId: string | null = null;
let loadedCanaryId: CanaryId | null = null;
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
 * Read the configured MLC model id. Only consulted for MLC-transport canaries
 * (Gemma, Qwen, etc.); Nano uses its own model id baked into the Prompt API.
 *
 * Preference order:
 *   1. URL query string `?model=<id>` — set by the Stage 5 runner when
 *      creating the offscreen document. Synchronous read that bypasses
 *      `chrome.storage` entirely (avoids cross-context consistency lag).
 *   2. `chrome.storage.local[STORAGE_KEY_MODEL]` — legacy production path,
 *      used before 4D.3 introduces the canary catalog as the selector.
 *   3. The resolved canary's `transportModelId` (passed in).
 *   4. MODEL_PRIMARY fallback.
 */
async function getPreferredMlcModel(canaryFallback: string): Promise<string> {
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
      log.warn(`chrome.storage.local never became available; using canary model ${canaryFallback}`);
      return canaryFallback;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const result = await chrome.storage.local.get(STORAGE_KEY_MODEL);
  const stored = result[STORAGE_KEY_MODEL];
  return typeof stored === 'string' && stored.length > 0 ? stored : canaryFallback;
}

/**
 * Read the user's canary selection from sync storage. Returns the raw value
 * if valid (including 'auto'), or DEFAULT_CANARY_ID otherwise.
 */
async function getUserCanaryChoice(): Promise<CanaryId> {
  if (typeof chrome === 'undefined' || chrome.storage === undefined || chrome.storage.sync === undefined) {
    return DEFAULT_CANARY_ID;
  }
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_CANARY);
    const raw = result[STORAGE_KEY_CANARY];
    if (raw === 'auto' || raw === 'gemma-2-2b-mlc' || raw === 'chrome-builtin-gemini-nano' || raw === 'qwen2.5-0.5b-mlc') {
      return raw;
    }
  } catch (err) {
    log.warn('Failed to read canary choice from storage.sync', err);
  }
  return DEFAULT_CANARY_ID;
}

/**
 * Probe whether a given canary is runnable right now. For MLC canaries
 * we optimistically return true (WebGPU availability is checked later by
 * WebLLM); for Nano we call LanguageModel.availability().
 */
async function isCanaryAvailable(canary: CanaryDefinition): Promise<boolean> {
  if (canary.engineTransport === 'chrome-prompt-api') {
    const api = getNanoApi();
    if (api === null) return false;
    try {
      const avail = await api.availability();
      return avail === 'available';
    } catch {
      return false;
    }
  }
  // MLC path: assume available at selector time; the adapter's primary/
  // fallback loading inside createMLCEngineAdapter() handles true failure.
  return true;
}

/**
 * Resolve the user's canary choice to a concrete CanaryDefinition via the
 * CANARY_FALLBACK_ORDER. Returns the first available canary; throws if
 * none are available (which should be impossible — MLC should always
 * succeed unless WebGPU is broken).
 */
async function resolveCanary(choice: CanaryId): Promise<CanaryDefinition> {
  if (choice !== 'auto') {
    const preferred = CANARY_CATALOG[choice];
    if (await isCanaryAvailable(preferred)) {
      return preferred;
    }
    log.warn(`User-selected canary ${choice} unavailable; falling back to catalog order`);
  }
  for (const id of CANARY_FALLBACK_ORDER) {
    const candidate = CANARY_CATALOG[id];
    if (await isCanaryAvailable(candidate)) {
      return candidate;
    }
  }
  // Last resort: return Gemma even if unavailable — the MLC adapter has
  // its own MODEL_PRIMARY → MODEL_FALLBACK chain that may still produce
  // a working engine.
  log.error('No canary available; defaulting to Gemma and hoping MLC fallback catches it');
  return CANARY_CATALOG['gemma-2-2b-mlc'];
}

async function createMlcEngineAdapter(modelId: string): Promise<CompletionEngine> {
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
  loadedModelId = effectiveModelId;
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

/**
 * Nano adapter. Each generate() call opens a fresh LanguageModel session,
 * runs a single prompt, and destroys the session. This is the shape
 * validated by the Stage 4C manual harness. Sessions are cheap to create
 * and per-call isolation avoids cross-probe prompt leakage.
 *
 * `expectedOutputs: [{ type: 'text', languages: ['en'] }]` silences the
 * "No output language was specified" Chrome warning and gives the model
 * a hint about expected output shape.
 */
async function createNanoEngineAdapter(modelId: string): Promise<CompletionEngine> {
  const api = getNanoApi();
  if (api === null) {
    throw new Error('Nano adapter requested but window.LanguageModel is absent');
  }
  const avail = await api.availability();
  if (avail !== 'available') {
    throw new Error(`Nano adapter requested but availability=${avail}`);
  }
  loadedModelId = modelId;
  // Emit a single "ready" progress event so the SW and popup status
  // displays stay consistent with the MLC path.
  chrome.runtime.sendMessage({
    type: 'ENGINE_STATUS',
    status: 'loading',
    progress: 1,
    modelId,
  });
  log.info(`Nano adapter initialised for ${modelId}`);
  return {
    id: modelId,
    async generate(systemPrompt: string, userMessage: string): Promise<string> {
      const session = await api.create({
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        temperature: 0.1,
        topK: 3,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      try {
        return await session.prompt(userMessage);
      } finally {
        try {
          session.destroy();
        } catch {
          // session.destroy() is best-effort; Chrome reclaims on GC.
        }
      }
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
  // so a subsequent call can retry.
  initPromise = (async () => {
    const userChoice = await getUserCanaryChoice();
    const canary = await resolveCanary(userChoice);
    loadedCanaryId = canary.id;
    log.info(`Selected canary: ${canary.id} (${canary.engineTransport})`);

    let created: CompletionEngine;
    if (canary.engineTransport === 'chrome-prompt-api') {
      created = await createNanoEngineAdapter(canary.transportModelId);
    } else {
      const mlcModelId = await getPreferredMlcModel(canary.transportModelId);
      log.info(`Initializing MLC engine with model: ${mlcModelId}`);
      created = await createMlcEngineAdapter(mlcModelId);
    }
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

export function getLoadedCanaryId(): CanaryId | null {
  return loadedCanaryId;
}

export async function generateCompletion(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const eng = await getEngine();
  return eng.generate(systemPrompt, userMessage);
}

// Legacy re-export kept for downstream imports that still reference
// MODEL_PRIMARY (none do in the production path after 4D.3, but the
// shared constants module also still exports it for back-compat).
export { MODEL_PRIMARY };
