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

function reportProgress(report: InitProgressReport): void {
  log.info(`Model load: ${report.text} (${Math.round((report.progress ?? 0) * 100)}%)`);
  chrome.runtime.sendMessage({
    type: 'ENGINE_STATUS',
    status: 'loading',
    progress: report.progress,
    modelId: loadedModelId,
  });
}

async function getPreferredModel(): Promise<string> {
  const result = await chrome.storage.sync.get(STORAGE_KEY_MODEL);
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

  const modelId = await getPreferredModel();
  loadedModelId = modelId;

  log.info(`Initializing engine with model: ${modelId}`);
  engine = await createMLCEngineAdapter(modelId);
  log.info('Engine ready');

  chrome.runtime.sendMessage({
    type: 'ENGINE_STATUS',
    status: 'ready',
    modelId: loadedModelId,
  });

  return engine;
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
