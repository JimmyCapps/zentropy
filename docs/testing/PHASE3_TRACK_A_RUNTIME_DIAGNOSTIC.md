# Phase 3 — Track A Runtime Diagnostic

Confirms which contexts expose Chrome's built-in Prompt API (`window.LanguageModel`)
so Track A can route probes correctly (offscreen for WebGPU MLC models,
window-context for Gemini Nano).

## Spec reference

Chrome Prompt API docs state the API is:

- Available to **top-level windows and same-origin iframes**
- **Not available in Web Workers** (includes MV3 service workers)
- Silent on extension offscreen documents (un-specified; treated as unsupported)

Source: https://developer.chrome.com/docs/ai/prompt-api (fetched 2026-04-16)

## Environment

- **Chrome channel:** Stable (EPP-enrolled)
- **Flags:**
  - `chrome://flags/#optimization-guide-on-device-model` → Enabled BypassPerfRequirement
  - `chrome://flags/#prompt-api-for-gemini-nano` → Enabled
  - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled
- **Model:** v3Nano, version 2025.06.30.1229, GPU backend, 4,072 MiB
  (`~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel/2025.8.8.1141`)
- **VRAM detected:** 12,124 MiB
- **Adaptation `kPromptApi`:** active, recently used

## Procedure

1. Open `docs/testing/phase3/runtime-diagnostic.html` directly in Chrome Stable
   (double-click the file, or `open` it; must be `file://` or a real origin —
   `chrome://` pages do not expose the API).
2. Click **Run diagnostic**. The click provides the user-gesture required by
   `LanguageModel.create()` on first use.
3. Click **Copy JSON**; paste the output into the "Context 1" section below.

## Contexts measured

| # | Context | How measured | Expected (per spec) |
|---|---|---|---|
| 1 | Plain-page window (file:// origin) | `runtime-diagnostic.html` opened directly in Chrome Stable | ✅ Available |
| 2 | Extension window-context page (harness page) | Observed during Stage 4 when `builtin-harness.html` is built | ✅ Available |
| 3 | Extension offscreen document | Observed during Stage 3 when `RUN_PROBES_DIRECT` handler is added | ❌ Unavailable (most likely) |
| 4 | MV3 service worker | Implicit — spec says Web Workers unsupported | ❌ Unavailable |

Contexts 2–4 are populated as their respective stages land, not separately
probed now, to avoid duplicate instrumentation.

## Results

### Context 1 — Plain-page window (Stage 0)

```json
{
  "when": "2026-04-16T09:07:23.880Z",
  "context": "plain_page_window",
  "origin": "file://",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "api_shape": {
    "hasLanguageModel": true,
    "hasWindowAi": false,
    "languageModelType": "function",
    "windowAiType": "undefined"
  },
  "availability": {
    "availability": "available",
    "note": null
  },
  "params": null,
  "completion_probe": {
    "summarization": {
      "ok": true,
      "first_create_ms": 2956,
      "prompt_ms": 5009,
      "output_chars": 311,
      "output_preview": "Sourdough bread is an ancient bread known for its tangy flavor resulting from a fermentation process.  The basic recipe involves mixing flour, water, and salt with a starter culture, followed by folding, overnight proofing, and baking at a "
    }
  }
}
```

### Findings

1. **`LanguageModel.availability()` returned `"available"`** — not one of the
   four values the public spec page documents (`readily-available` /
   `after-download` / `downloading` / `unavailable`). Chrome 147 Stable has
   collapsed the enum: either the model is ready (`"available"`) or it is
   not. Plan row schema `builtin_api_availability` must accept
   `"available"` as a valid value; treating only the spec-documented strings
   as valid would mark every real row as schema-invalid.

2. **`LanguageModel.params()` returned `null`**, not an object. In Chrome 147
   this method either does not exist or returns null for non-extension
   origins. Not a blocker — we only need params() data nice-to-have; the
   harness-page code should guard for null.

3. **`window.ai` is not defined** on this Chrome (Stable 147); only
   `window.LanguageModel` exists. Earlier offscreen fallback code
   (`src/offscreen/engine.ts:46–54`) checks both — the `window.ai` branch
   is dead on current Stable. Safe to simplify in Stage 3.

4. **Performance baseline (plain-page window):**
   - Cold `LanguageModel.create()`: 2,956 ms
   - First `session.prompt()` on `clean_recipe + summarization`: 5,009 ms
   - Phase 2 native `mlc_llm serve` with `chrome-builtin-gemini-nano` was
     placeholder-only (27 skipped rows) so there is no Phase 2 baseline to
     delta against for Gemini Nano. Track A Gemini Nano rows will have
     `runtime_delta_ms_vs_native_phase2 = null`.

5. **Output quality sanity:** the returned summary is on-task, factually
   correct, clean of injection artefacts. Confirms baseline behavior is
   healthy before running the 27-cell sweep in Stage 7.

### Context 2 — Extension window-context page (filled during Stage 4)

_TBD — measured when `src/tests/phase3/builtin-harness.html` runs its first
probe._

### Context 3 — Extension offscreen document (filled during Stage 3)

_TBD — measured when `RUN_PROBES_DIRECT` handler lands. If `LanguageModel` is
undefined there (expected), row is recorded and no further offscreen attempts
are made — Path 2 stays on the harness page._

### Context 4 — MV3 service worker (not measured; spec-excluded)

Not instrumented. Spec explicitly excludes Web Workers.

## Decision

Track A routing stands as planned:

- **Path 1 (6 MLC models):** WebGPU via `@mlc-ai/web-llm` in the existing
  offscreen document — does not depend on `LanguageModel`.
- **Path 2 (Gemini Nano):** `window.LanguageModel` called from the new
  extension harness page (window context) — **not** from the offscreen document.

Even if Context 3 turns out to work today, we still use the harness page for
Path 2 for spec compliance and future-Chrome safety.
