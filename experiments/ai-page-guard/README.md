# AI Page Guard

> **Note:** This is a standalone experimental implementation living under [`experiments/`](../). It does not share dependencies, build, or CI with the root HoneyLLM extension. See [`../README.md`](../README.md) for a comparison of approaches.

A Chrome Extension (Manifest V3) that protects AI tools from consuming poisoned web content. Detects prompt injection, hidden instructions, and malicious DOM elements using a cascade of regex rules and on-device ONNX classifiers.

## What it does

When an AI agent (Claude, Playwright, MCP, etc.) or a human reads a web page, adversarial content can hijack the AI's behaviour — hidden `[INST]` blocks, `display:none` instructions, "ignore previous instructions" phrases in comments, etc. AI Page Guard runs in the page before the AI sees it:

1. **Regex layer** (< 5ms) — fast pattern match for obvious injection keywords and hidden-element injections. Catches the clear cases immediately.
2. **Prompt Guard 22M** (~50-200ms on CPU) — Meta's ONNX classifier for prompt injection. Runs on content that passed the regex filter.
3. **DeBERTa v3 injection** (cascade, borderline only) — ProtectAI's classifier for ambiguous cases.

Malicious content is either stripped from the DOM (hidden injections) or masked with `[Content removed by AI Page Guard]` (visible injections).

## Signal API

Every page exposes the scan result so AI tools can query before trusting the page:

```js
window.__AI_SECURITY_REPORT__
// {
//   status: "clean" | "threats_found" | "scanning",
//   url: "...",
//   threats: [{ type, layer, confidence, action, snippet, node_selector }],
//   scan_coverage: 0.0-1.0,
//   pending_nodes: number,
//   models_loaded: boolean,
//   last_scan: timestamp,
//   onnx_classified: number,   // how many elements the AI has checked
//   onnx_total_queued: number
// }

window.__AI_PAGE_GUARD_LOG__
// Structured event log — scan_start, scan_complete, threat_detected,
// onnx_flush, onnx_response, onnx_timeout, mutation events
```

Playwright / CDP usage:
```js
const report = await page.evaluate(() => window.__AI_SECURITY_REPORT__);
if (report.status === 'threats_found') { /* don't trust this page */ }
```

## Architecture

```
Content script (per tab)          Background SW          Offscreen document (singleton)
├─ MutationObserver               ├─ Message router      ├─ ONNX Runtime Web (WASM)
├─ Regex layer                    ├─ Badge manager       ├─ Prompt Guard 22M (bundled)
├─ DOM strip/mask/neuter          ├─ Offscreen lifecycle └─ DeBERTa v3 (lazy remote)
├─ Leaf-element detection         └─ Keepalive (25s)
├─ Event log
└─ Signal API bridge (signal.js in page MAIN world)
```

Key design decisions:
- **Bundled Prompt Guard model** (69MB) — loads in ~1s from `chrome-extension://` URL, no network download on first use.
- **Classifier models, not generative LLMs** — single forward pass (~100ms) vs multi-second token generation. Works on CPU via WASM, no WebGPU required.
- **Deferred mitigations** — during tree walk, actions are queued. Applied after walk completes so `TreeWalker` doesn't lose its position when nodes are stripped.
- **ONNX queue cap (50/page)** — prevents unbounded growth on SPAs like YouTube where mutations are continuous.
- **Honest scanning status** — "Scanning..." only shown until the AI has actually classified the first batch. Popup info line shows "AI checked: N elements" as proof of real work.

## Install & run

```bash
npm install
npm run build      # → dist/
```

Then load `dist/` as an unpacked extension at `chrome://extensions/` with Developer mode enabled.

## Tests

```bash
npm test           # 22 unit tests (regex rules)
npm run test:e2e   # 30 Playwright e2e tests (extension in headless Chrome)
npm run test:all   # both
```

E2E tests use a real Chrome instance via `--headless=new` with the built extension loaded. Every test cross-references both DOM state and the internal event log, so tests fail if the extension's internal work doesn't match visible behaviour.

## Project layout

```
src/
├── background.js         Background service worker (message router, badge, offscreen lifecycle)
├── content.js            Content script entry — injects signal.js, starts observer
├── offscreen.js          ONNX inference (Prompt Guard + DeBERTa cascade)
├── offscreen.html        Offscreen document shell
├── signal.js             Injected into page MAIN world — bridges state to window globals
├── popup.html, popup.js  Extension popup UI
├── manifest.json         MV3 manifest
├── icons/                Extension icons
└── lib/
    ├── regex-rules.js       scanText() + scanElement() — the deterministic layer
    ├── regex-rules.test.js  22 unit tests
    └── dom-scanner.js       MutationObserver, leaf detection, deferred mitigation, ONNX queueing

models/
└── prompt-guard/        Prompt Guard 22M model files (not in git — downloaded separately)

test/
├── test-page.html       Manual test page with regex/hidden/ONNX/dynamic sections
├── test-page.spec.js    E2E tests against test-page.html
└── extension.spec.js    E2E tests with synthetic pages
```

## Comparison with other projects

**Zentropy / HoneyLLM** ([JimmyCapps/zentropy](https://github.com/JimmyCapps/zentropy)) — similar goal, different approach. Uses generative LLMs (Phi-3-mini via WebGPU/MLC-LLM) to run three behavioural probes: summarization, instruction detection, adversarial compliance. Scores 0-150 across multiple signals. Catches novel attacks via behavioural analysis but requires WebGPU + ~2GB VRAM and runs 10-50x slower per scan. We use classifiers (purpose-built detectors) which are faster and hardware-universal but more limited to patterns the models were trained on.

## Models

- **Prompt Guard 2 22M** — [gravitee-io/Llama-Prompt-Guard-2-22M-onnx](https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx). Quantized INT8 ONNX, 69MB. Bundled with extension.
- **DeBERTa v3 base injection** — [protectai/deberta-v3-base-injection-onnx](https://huggingface.co/protectai/deberta-v3-base-injection-onnx). 704MB. Not bundled; lazy-loaded via Transformers.js remote fetch.

To re-download model files:
```bash
mkdir -p models/prompt-guard
cd models/prompt-guard
for f in config.json tokenizer_config.json tokenizer.json special_tokens_map.json model.quant.onnx; do
  curl -sL "https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx/resolve/main/$f" -o "$f"
done
```

## Limitations

- Classifier models only catch patterns they were trained on. Novel obfuscated attacks may slip through where zentropy's behavioural approach would catch them.
- DeBERTa v3 is not bundled — first use downloads 704MB from HuggingFace.
- ONNX cap of 50 elements per page means very large pages (>50 leaf elements) only get regex + AI on the first 50 ONNX-worthy elements.
- Playwright e2e tests launch a real Chrome via `--headless=new` (extensions don't work in classic headless mode).

## License

MIT
