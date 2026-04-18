# Phase 4 Stage 4E — Chromium-Family Compatibility Audit Methodology

> **Status:** Methodology only. No browser data has been collected yet — see the
> empty results table at the bottom and fill in cells as you audit each browser.
> Tracking issue: [#8](https://github.com/JimmyCapps/zentropy/issues/8).
>
> **Hard rule (per Phase 4 plan):** This is an *informational* audit. We are
> documenting reach, not expanding it. Non-Chrome support does NOT block
> Phase 4 completion. Cells where HoneyLLM does not work are findings, not
> bugs to fix.

## 1. Purpose

Capture, per Chromium-family browser, whether HoneyLLM's two on-device engines
(Chrome built-in Gemini Nano via the Prompt API, and `@mlc-ai/web-llm` via
WebGPU) actually function, and what verdict the extension produces on a known
injection fixture. The output is a single matrix that lets us answer reach
questions truthfully (e.g. "does HoneyLLM produce a real verdict on Edge?")
without speculation.

## 2. Browsers in scope

| Browser | Channel | Why included |
|---|---|---|
| Chrome | Stable | Baseline — already known working; reference row |
| Chrome | Beta / Canary | Forward-compat smoke (catches Prompt API regressions early) |
| Microsoft Edge | Stable | Largest non-Chrome Chromium; ships Phi Silica via a different API path |
| Brave | Stable | De-Googled fork; Nano distribution likely stripped |
| Arc | Stable | Chromium fork; minimal first-party AI surface |
| Vivaldi | Stable | Chromium fork; Opera-lineage |
| Opera | Stable | Chromium fork; ships Aria via remote API |

Out of scope: Firefox (not Chromium), Safari (not Chromium), mobile-only
Chromium variants (no extension support).

## 3. Signals captured per browser (matrix columns)

For each browser, capture four signal types:

| Signal | Source | Type | Notes |
|---|---|---|---|
| `LanguageModel` presence | `typeof window.LanguageModel !== 'undefined'` evaluated **inside the offscreen document** | `present` / `absent` | The Prompt API surface for Chrome's built-in Gemini Nano. Must be tested in the offscreen doc, not the page — extension contexts are where Chrome exposes it. |
| `LanguageModel.availability()` | `await LanguageModel.availability()` (only if `LanguageModel` is present) | `'available'` / `'downloadable'` / `'downloading'` / `'unavailable'` / `<error>` | Nano has an EPP gate plus a per-profile component download. `'unavailable'` on Chrome Stable usually means the profile isn't EPP-enrolled. |
| WebGPU adapter mode | `getWebGPUAdapterInfo()` exported from `src/offscreen/engine.ts` (introduced by [PR #56](https://github.com/JimmyCapps/zentropy/pull/56), closes [#49](https://github.com/JimmyCapps/zentropy/issues/49)) | `'core'` / `'compatibility'` / `'none'` / `'unknown'` | The shape is `AdapterIntrospection { mode, info }` from `src/offscreen/webgpu-introspection.ts`. The downstream `SecurityVerdict.webgpuAdapterMode` field is **TBD on merge of #56 follow-up** (#56 itself defers verdict-stamping). For the audit, read the engine-init log line `WebGPU adapter mode: <mode>` from the offscreen DevTools console. |
| Verdict on canary fixture | Open `test-pages/phase4/nano-harness.html` (manual Nano sweep) and `test-pages/clean/simple-article.html` (full-extension MLC path); read the persisted verdict from `chrome.storage` via the popup or service worker console | `CLEAN` / `SUSPICIOUS` / `COMPROMISED` / `UNKNOWN` / `<error>` | A non-`UNKNOWN` verdict on a real injection page demonstrates the full pipeline ran. `UNKNOWN` with `analysisError` set means the engine layer failed — diagnose using the WebGPU adapter mode and `LanguageModel.availability()` columns. |

## 4. Pass / partial / fail criteria per browser

A browser cell rolls up to one of three outcomes:

- **Pass** — both engines are available *or* at least one engine is available
  AND produces a non-`UNKNOWN` verdict on the canary fixture. HoneyLLM is
  fully usable on this browser.
- **Partial** — exactly one engine works (e.g. MLC works but `LanguageModel`
  is absent). The extension still produces meaningful verdicts via the
  working engine. Document which engine is missing and why (best guess).
- **Fail** — neither engine works on this browser, or both engines initialise
  but the canary fixture returns `UNKNOWN`. The extension installs but does
  not produce verdicts.

The hypothesised distribution (per issue #8): Chrome Stable = Pass; Edge,
Brave, Arc, Vivaldi, Opera = Partial (MLC only, Nano absent because forks
strip Google's on-device-AI distribution).

## 5. Test procedure (run for every browser)

Time budget: ~15 minutes per browser. The download steps are bandwidth-bound,
not interaction-bound — start the MLC and (where applicable) Nano downloads
early and let them run in parallel.

### 5.1 One-time per browser

1. Install the browser. Update to latest stable channel (or named channel for
   Chrome Beta / Canary).
2. Build HoneyLLM locally: `npm run build` from the repo root. Produces
   `dist/`.
3. In the browser, enable Developer Mode for extensions:
   - Chrome / Edge / Brave / Arc / Vivaldi: `chrome://extensions` → toggle
     **Developer mode** (top-right).
   - Opera: `opera://extensions` → toggle **Developer mode**.
4. **Load unpacked** → select the repo's `dist/` directory.
5. Note the unpacked extension ID assigned by this browser (it will differ
   per browser, but that's fine — the extension functions the same regardless
   of ID, and storage is per-browser anyway).

### 5.2 Capture `LanguageModel` presence and `availability()`

1. Open the extension's offscreen document DevTools:
   - Navigate to `chrome://extensions` (or browser equivalent).
   - Find HoneyLLM, click **service worker** → opens DevTools for the SW.
   - From SW console, send any test page a `PAGE_SNAPSHOT` so the offscreen
     document is created (it's lazy — see `CLAUDE.md` §Offscreen document is
     lazy). The simplest way: open
     `test-pages/clean/simple-article.html` in any tab and wait ~5 s.
   - Back in `chrome://extensions`, the offscreen doc now appears as an
     inspectable view under HoneyLLM. Click **inspect** to open its DevTools.
2. In the offscreen DevTools console, run:
   ```js
   typeof LanguageModel
   await LanguageModel?.availability?.()
   ```
3. Record `present` / `absent`, and the availability string.
4. If `availability` returns `'downloadable'` or `'downloading'`, the model
   component is being fetched in the background. Wait until it returns
   `'available'`, then proceed. If it stays `'unavailable'` indefinitely,
   record that and move on — most non-Chrome Chromium browsers will land
   here, and that's the finding.

### 5.3 Capture WebGPU adapter mode

1. In the offscreen DevTools console (after PR #56 merges and is on `main`):
   ```js
   // Imported at module top in src/offscreen/engine.ts
   const info = (await import('./engine.js')).getWebGPUAdapterInfo();
   info?.mode  // 'core' | 'compatibility' | 'none' | 'unknown'
   ```
   *Until #56 merges*, capture the value by reading the engine-init log line
   `WebGPU adapter mode: <mode>` directly from the offscreen console output
   on first probe run.
2. Record the mode. If `'compatibility'`, MLC is expected to fail — note
   that for the verdict column.
3. If `'none'`, the browser has no WebGPU at all — unusual for modern
   Chromium-family but record as a finding.

### 5.4 Capture verdict on canary fixture

1. Open `test-pages/clean/simple-article.html` in a tab. Wait ~30 s for
   chunk dispatch + probe completion (cold start can take longer if MLC just
   downloaded the model).
2. Open the HoneyLLM popup (toolbar icon). Read the verdict.
3. Cross-check by reading from the SW console:
   ```js
   const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
   const result = await chrome.storage.local.get(`verdict:${tabs[0].id}`);
   console.log(result);
   ```
4. Record verdict. If `UNKNOWN`, note the `analysisError` field — that's the
   diagnostic explaining which engine failed.
5. *(Optional, only if `LanguageModel` was `'available'`)* Run the manual
   Nano harness at `test-pages/phase4/nano-harness.html` per
   `test-pages/phase4/README.md`. This isolates the Nano path from the MLC
   path. A non-error sweep result here means Nano is fully working.

## 6. Worked example — Chrome Stable on macOS

This row is derived from existing repo evidence (CLAUDE.md, manifest.json,
`test-pages/phase4/README.md`, `docs/testing/phase4/mlc-root-cause.md`,
PR #56 description, project memory). It is **not** a fresh audit — re-run
the steps above and overwrite if any cell is `?` or appears stale.

| Field | Value | Source / confidence |
|---|---|---|
| Browser | Chrome | — |
| Channel / Version | Stable / `?` (record the exact version when re-running) | unknown until run |
| Extension ID (this profile) | `immjocpajnooomnmdgecldcfimembndj` | CLAUDE.md §Chrome Stable unpacked extension ID; project memory `project_chrome_extension_id.md`. Treat as stable until the user signals a reload changed it. |
| `LanguageModel` presence | `present` | Inferred: the `test-pages/phase4/nano-harness.html` flow exists and is documented as working on the user's EPP-enrolled profile (`docs/testing/phase4/mlc-root-cause.md`, `test-pages/phase4/README.md`). Re-confirm with `typeof LanguageModel`. |
| `LanguageModel.availability()` | `'available'` (on EPP-enrolled profile with both flags enabled and component downloaded) | `test-pages/phase4/README.md` §"One-time prep" — the flow assumes `await LanguageModel.availability()` returns `'available'` before sweep. On a non-EPP profile this is `'unavailable'`. |
| WebGPU adapter mode | `?` (likely `'core'` on Apple Silicon Macs; record from offscreen console once PR #56 is on `main`) | PR #56 has not landed on `main` as of branch creation. Apple Silicon Macs are not in the cohort that compat-mode targets (D3D11.1- on Windows, Vulkan 1.1- on Android), so `'core'` is the expected value. |
| Verdict on `simple-article.html` (clean fixture) | Likely `CLEAN` with `confidence ~0.93` | `docs/testing/phase4/mlc-root-cause.md` §"Verification outcome" recorded `CLEAN, confidence 0.93` on the wikipedia-sourdough clean fixture post-4B.3 fix. The `simple-article.html` fixture is similarly clean. |
| Verdict on a real injection fixture | `?` (run `test-pages/clean/security-blog.html` or any of the affected-set fixtures; expect `SUSPICIOUS` or `COMPROMISED`) | The MDN fixture in the same Track B verification produced `SUSPICIOUS, confidence 0.67` — that's the shape we expect from a non-clean page. |
| Roll-up | **Pass** (assumed, pending verification) | Both engines available + non-UNKNOWN verdict expected. |

Re-running this row to replace `?` cells should take ~5 minutes on the
already-set-up Chrome Stable profile.

## 7. Results table template (fill in as you audit)

Copy this table into `docs/testing/PHASE4_BROWSER_COMPATIBILITY.md` (the
deliverable from issue #8) once you start collecting data, or append rows
inline below as a working scratchpad.

| Browser | Channel / Version | `LanguageModel` | `availability()` | WebGPU adapter mode | Verdict on clean fixture | Verdict on injection fixture | Roll-up | Notes |
|---|---|---|---|---|---|---|---|---|
| Chrome | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Re-run worked example above to replace `?` cells. |
| Chrome | Beta / `?` | `?` | `?` | `?` | `?` | `?` | `?` | |
| Chrome | Canary / `?` | `?` | `?` | `?` | `?` | `?` | `?` | |
| Edge | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Hypothesis: Nano absent (Phi Silica is on a different API path), MLC works → Partial. |
| Brave | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Hypothesis: Nano stripped, MLC works → Partial. |
| Arc | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Hypothesis: Nano stripped, MLC works → Partial. |
| Vivaldi | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Hypothesis: Nano stripped, MLC works → Partial. |
| Opera | Stable / `?` | `?` | `?` | `?` | `?` | `?` | `?` | Hypothesis: Nano stripped (Aria is remote API), MLC works → Partial. |

## 8. Cross-references

- **Tracking issue:** [#8 Phase 4 Stage 4E — Chromium-family browser compatibility audit](https://github.com/JimmyCapps/zentropy/issues/8)
- **WebGPU introspection (gives us the adapter-mode column):**
  - Issue: [#49 feat: WebGPU adapter introspection at engine init](https://github.com/JimmyCapps/zentropy/issues/49)
  - PR: [#56 feat(phase4-#49): WebGPU adapter introspection at engine init](https://github.com/JimmyCapps/zentropy/pull/56)
  - Module: `src/offscreen/webgpu-introspection.ts` (post-merge)
  - Engine getter: `getWebGPUAdapterInfo()` in `src/offscreen/engine.ts` (post-merge)
  - Verdict-field stamping (`SecurityVerdict.webgpuAdapterMode`) — **TBD on follow-up to #56**; PR #56 explicitly defers this.
- **Manual Nano harness (used for the verdict column when `LanguageModel` is `'available'`):** `test-pages/phase4/README.md`
- **Phase 4 plan and hard rules:** `docs/testing/PHASE4_PROMPT.md` §Stage 4E (referenced in issue #8)
- **Final deliverable doc (the populated matrix):** `docs/testing/PHASE4_BROWSER_COMPATIBILITY.md` — to be created when audit data is collected.
- **MLC root-cause writeup (context for verdict expectations):** `docs/testing/phase4/mlc-root-cause.md`
- **Project gotchas relevant to running this audit:**
  - Offscreen document is lazy (CLAUDE.md §Offscreen document is lazy) — must trigger one `PAGE_SNAPSHOT` before inspecting it.
  - Chrome Stable extension ID is `immjocpajnooomnmdgecldcfimembndj` (CLAUDE.md §Chrome Stable unpacked extension ID); other browsers will assign their own.
