# Chromium-family browser compatibility checklist — Stage 4E (#8)

**Scope:** informational-only audit. Goal is to document reach, not expand it. Per Phase 4 Hard Rules, HoneyLLM does NOT block on non-Chrome support.

**Prep:** `npm run build` has already run on `test/issue-2-refresh-baselines-2026-04-20`. Load `dist/` as an unpacked extension in each browser.

**Output target:** when done, copy the filled table below into `docs/testing/PHASE4_BROWSER_COMPATIBILITY.md`.

---

## Per-browser procedure

For each browser:

1. Open `chrome://extensions/` (or equivalent: `edge://extensions/`, `brave://extensions/`, etc.)
2. Toggle Developer mode → **Load unpacked** → select `/Users/node3/Documents/projects/HoneyLLM/dist`.
3. Note the extension ID (needed for some checks).
4. Open the service-worker inspect link.
5. In the SW console run:
   ```js
   // 1. LanguageModel presence
   typeof self.LanguageModel;
   // 2. Availability (if present)
   self.LanguageModel ? await self.LanguageModel.availability() : 'no-api';
   ```
6. Open a fresh tab and load `file:///Users/node3/Documents/projects/HoneyLLM/test-pages/clean/simple-article.html`. Wait for HoneyLLM to analyse. Record verdict (see popup).
7. Open a fresh tab and load `file:///Users/node3/Documents/projects/HoneyLLM/test-pages/nano-harness.html`. If `LanguageModel` was available, trigger one probe and record the result.
8. WebGPU check: from the offscreen doc (inspect link appears after first PAGE_SNAPSHOT), or from any tab's devtools:
   ```js
   const a = await navigator.gpu?.requestAdapter?.(); a && a.info;
   ```
9. MLC Gemma smoke: after loading simple-article.html, confirm the popup shows a verdict with `engine: 'mlc'`.
10. Fill in the row below.

## Results table

| Browser | Version | `LanguageModel` | `availability()` | Nano smoke | WebGPU adapter | MLC Gemma smoke | Notes |
|---|---|---|---|---|---|---|---|
| Chrome (baseline) |  |  |  |  |  |  |  |
| Microsoft Edge |  |  |  |  |  |  |  |
| Brave |  |  |  |  |  |  |  |
| Opera |  |  |  |  |  |  |  |
| Vivaldi |  |  |  |  |  |  |  |
| Arc |  |  |  |  |  |  |  |

## Expected findings (hypothesis from #8)

- Chrome: full support (Nano + MLC).
- Edge: MLC works; Nano likely absent (Edge ships Phi Silica via a different API path).
- Brave / Opera / Vivaldi / Arc: MLC works; Nano absent (these Chromium forks strip Google on-device AI distribution).

## Time budget

~10 minutes per browser once built. Block ~1 hour total.

## When done

1. Move this file to `docs/testing/PHASE4_BROWSER_COMPATIBILITY.md` with the table filled.
2. Close issue #8 with a comment linking the report.
3. Mark Stage 4E done on any Phase 4 tracker notes.
