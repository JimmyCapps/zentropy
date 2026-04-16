import { env, pipeline } from '@huggingface/transformers';

// Configure WASM paths to bundled files (v4 requires object, not string prefix)
env.backends.onnx.wasm.wasmPaths = {
  wasm: chrome.runtime.getURL('wasm/ort-wasm-simd-threaded.jsep.wasm'),
  mjs: chrome.runtime.getURL('wasm/ort-wasm-simd-threaded.jsep.mjs'),
};
env.allowLocalModels = false;
env.allowRemoteModels = true;

let promptGuardPipeline = null;
let debertaPipeline = null;

const PROMPT_GUARD_THRESHOLD_HIGH = 0.85;
const PROMPT_GUARD_THRESHOLD_LOW = 0.30;
const DEBERTA_THRESHOLD = 0.70;

async function loadPromptGuard() {
  if (promptGuardPipeline) return promptGuardPipeline;
  console.log('[AI Page Guard] Loading Prompt Guard 22M...');
  // Use bundled model via extension URL — Transformers.js fetches via fetch()
  const modelUrl = chrome.runtime.getURL('models/prompt-guard');
  promptGuardPipeline = await pipeline(
    'text-classification',
    modelUrl,
    { model_file_name: 'model.quant', dtype: 'fp32', revision: 'main' }
  );
  console.log('[AI Page Guard] Prompt Guard 22M loaded');
  return promptGuardPipeline;
}

async function loadDeBERTa() {
  if (debertaPipeline) return debertaPipeline;
  console.log('[AI Page Guard] Loading DeBERTa v3 injection model...');
  debertaPipeline = await pipeline(
    'text-classification',
    'protectai/deberta-v3-base-injection-onnx',
    { subfolder: '', model_file_name: 'model', dtype: 'fp32' }
  );
  console.log('[AI Page Guard] DeBERTa v3 loaded');
  return debertaPipeline;
}

// Rough token approximation: 1 token ≈ 4 chars
function splitIntoWindows(text, maxTokens = 512) {
  const charLimit = maxTokens * 4;
  if (text.length <= charLimit) return [text];
  const stride = 480 * 4;
  const overlap = 32 * 4;
  const windows = [];
  for (let i = 0; i < text.length; i += stride - overlap) {
    windows.push(text.slice(i, i + charLimit));
    if (i + charLimit >= text.length) break;
  }
  return windows;
}

async function classifyChunk(text) {
  const pg = await loadPromptGuard();
  const windows = splitIntoWindows(text);

  // Run Prompt Guard on all windows, take max malicious score
  let maxScore = 0;
  for (const w of windows) {
    const results = await pg(w, { topk: null });
    const malicious = results.find(r => r.label === 'MALICIOUS');
    if (malicious && malicious.score > maxScore) {
      maxScore = malicious.score;
    }
  }

  if (maxScore > PROMPT_GUARD_THRESHOLD_HIGH) {
    return { verdict: 'unsafe', layer: 'prompt_guard', confidence: maxScore, action: 'strip' };
  }
  if (maxScore < PROMPT_GUARD_THRESHOLD_LOW) {
    return { verdict: 'safe', layer: 'prompt_guard', confidence: 1 - maxScore, action: null };
  }

  // Borderline → cascade to DeBERTa
  const deberta = await loadDeBERTa();
  let maxInjScore = 0;
  for (const w of windows) {
    const results = await deberta(w, { topk: null });
    const injection = results.find(r => r.label === 'INJECTION');
    if (injection && injection.score > maxInjScore) {
      maxInjScore = injection.score;
    }
  }

  if (maxInjScore > DEBERTA_THRESHOLD) {
    return { verdict: 'unsafe', layer: 'deberta', confidence: maxInjScore, action: 'strip' };
  }

  return { verdict: 'safe', layer: 'deberta', confidence: 1 - maxInjScore, action: null };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages explicitly targeted at offscreen
  if (message.target !== 'offscreen' && message.type !== 'keepalive' && message.type !== 'models_status' && message.type !== 'preload') return false;

  if (message.type === 'classify') {
    (async () => {
      const results = [];
      for (const chunk of message.chunks) {
        try {
          const result = await classifyChunk(chunk.text);
          results.push({ id: chunk.id, ...result });
        } catch (err) {
          console.error('[AI Page Guard] Classification error:', err);
          results.push({ id: chunk.id, verdict: 'safe', layer: 'error', confidence: 0, action: null });
        }
      }
      sendResponse({ type: 'classify_result', results });
    })();
    return true;
  }

  if (message.type === 'preload') {
    console.log('[AI Page Guard] Offscreen pre-loading Prompt Guard model...');
    loadPromptGuard()
      .then(() => {
        console.log('[AI Page Guard] Prompt Guard pre-loaded successfully');
        sendResponse({ loaded: true });
      })
      .catch(err => {
        console.error('[AI Page Guard] Prompt Guard pre-load failed:', err);
        sendResponse({ loaded: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'keepalive') {
    sendResponse({ alive: true });
    return true;
  }

  if (message.type === 'models_status') {
    sendResponse({ promptGuardLoaded: !!promptGuardPipeline, debertaLoaded: !!debertaPipeline });
    return true;
  }
});

console.log('[AI Page Guard] Offscreen document ready — pre-loading Prompt Guard model...');
// Auto-load model immediately so it's ready when the first classify arrives
loadPromptGuard().then(() => {
  console.log('[AI Page Guard] Prompt Guard model pre-loaded and ready');
}).catch(err => {
  console.error('[AI Page Guard] Failed to pre-load Prompt Guard:', err);
});
