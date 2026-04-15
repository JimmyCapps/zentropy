import { CreateMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm';
import { MODEL_PRIMARY, MODEL_FALLBACK, STORAGE_KEY_MODEL } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('Engine');

const CHROME_BUILTIN_MODEL_ID = 'chrome-builtin-gemma';

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

interface LanguageModelAPI {
  availability(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(options?: {
    systemPrompt?: string;
    temperature?: number;
    topK?: number;
  }): Promise<LanguageModelSession>;
}

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

function getLanguageModelAPI(): LanguageModelAPI | null {
  const globalScope = globalThis as unknown as {
    LanguageModel?: LanguageModelAPI;
    ai?: { languageModel?: LanguageModelAPI };
  };
  if (globalScope.LanguageModel) return globalScope.LanguageModel;
  if (globalScope.ai?.languageModel) return globalScope.ai.languageModel;
  return null;
}

async function createChromeBuiltinEngine(): Promise<CompletionEngine> {
  const api = getLanguageModelAPI();
  if (!api) {
    throw new Error('Chrome built-in Prompt API not available in this runtime');
  }
  const availability = await api.availability();
  if (availability === 'unavailable') {
    throw new Error('Chrome built-in Prompt API reports unavailable');
  }
  log.info(`Chrome built-in availability: ${availability}`);

  return {
    id: CHROME_BUILTIN_MODEL_ID,
    async generate(systemPrompt: string, userMessage: string): Promise<string> {
      const session = await api.create({ systemPrompt, temperature: 0.1 });
      try {
        return await session.prompt(userMessage);
      } finally {
        session.destroy?.();
      }
    },
  };
}

async function createMLCEngineAdapter(modelId: string): Promise<CompletionEngine> {
  let mlc: MLCEngine;
  try {
    mlc = await CreateMLCEngine(modelId, { initProgressCallback: reportProgress });
  } catch (err) {
    log.warn(`Primary model failed, falling back to ${MODEL_FALLBACK}`, err);
    loadedModelId = MODEL_FALLBACK;
    mlc = await CreateMLCEngine(MODEL_FALLBACK, { initProgressCallback: reportProgress });
  }
  return {
    id: modelId,
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

  engine = modelId === CHROME_BUILTIN_MODEL_ID
    ? await createChromeBuiltinEngine()
    : await createMLCEngineAdapter(modelId);

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
