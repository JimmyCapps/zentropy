# HoneyLLM — Phase 3 Prompt

Copy everything between the `---` markers below into a fresh Claude Code session at `/Users/node3/Documents/projects/HoneyLLM/`. This prompt asks Claude Code to **generate a detailed plan + task list** first, then execute after approval.

---

# HoneyLLM — Phase 3: Affected Baseline + Live Regression + Native-Surface Detection

## Your first job

**Produce a plan and task list. Do not start executing yet.** This prompt has three distinct work tracks. Read all the referenced artifacts, think through the sequencing, then write:

1. A plan file at `/Users/node3/.claude/plans/honeyllm-phase-3.md` with Context, Stages (with gates), Critical Files, Hard Rules, Verification sections.
2. A seeded task list in the tracker (20–30 tasks with blockers wired).
3. A one-page summary of the approach you're proposing, ending in ExitPlanMode for user approval.

Only start executing once the user approves the plan.

## Context

You are resuming work on HoneyLLM, a Manifest V3 Chrome extension that runs a client-side LLM security canary to detect prompt injection in webpage content.

**Phase 1 (complete, v1.3 in `MODEL_BEHAVIORAL_TEST_REPORT.md`):** 19 production LLMs baselined via direct API, 513 rows, no extension in the loop. `docs/testing/{anthropic,gpt}-results.json` + `gemini-all-models/raw-results.json`.

**Phase 2 (complete, `INBROWSER_MODEL_REPORT.md`):** 6 canary candidates baselined via `mlc_llm serve` local HTTP. 162 real rows + 27 Gemini Nano placeholder rows. **This was the "native" baseline — canaries hosted on the same Metal GPU, same weights, same quantization as Chrome would use, but running in a native process, not in the browser.**

**Phase 3 goal:** three tracks.

**Track A — "Affected" baseline (in-extension re-baseline of all 6 canaries).** Real in-browser hosting may change both speed (WebGPU vs Metal native) and behavior (message passing, chunking, context-window handling, service-worker lifecycle). The Phase 2 numbers are the native floor; this track establishes the actual deployed ceiling. Run all 6 MLC candidates AND Gemini Nano through the extension's offscreen engine, using the same 9 inputs × 3 probes. Output schema and tables must be directly comparable to Phase 2 so the delta can be quantified. **This is where "tiny models in real in-browser hosting may affect speeds/behaviours" gets measured — the numbers from Phase 2 are provisional until this track replaces them.**

**Track B — Live-browser regression.** Extension loaded in a real user-profile Chrome against the 9 Phase-1 fixtures served from localhost AND at least one real public page per fixture category. Three primary production LLMs in the loop via their web-search / agent / auto-read-page features. Confirm extension verdict fires before the model ingests the content, and measure compliance delta vs Phase 1 baseline.

**Track C — Functional detection testing across native clients.** Every accessible LLM surface (Claude.ai, Claude Desktop, Claude Code, Agent SDK; ChatGPT web + desktop, Atlas, Codex CLI, Responses/Assistants/Realtime APIs; Gemini web + app, AI Studio, Vertex Workbench, Gemini SDK, Antigravity/Jules). Document which surfaces the extension CAN attach to and which it CANNOT, and what a protection story would look like where attachment isn't possible.

**Read first, in order:**
1. `docs/testing/MODEL_BEHAVIORAL_TEST_REPORT.md` (v1.3)
2. `docs/testing/INBROWSER_MODEL_REPORT.md`
3. `docs/ARCHITECTURE.md`
4. `TESTING_PLAN.md`
5. `src/offscreen/engine.ts`, `src/offscreen/probe-runner.ts`, `src/service-worker/orchestrator.ts`
6. `src/tests/playwright-integration.ts` (the existing `waitForHoneyLLM()` helper)
7. `scripts/run-mlc-local-baseline.ts` (Phase 2 runner to mirror)
8. `scripts/run-gemini-nano-baseline.ts` (Phase 2 Chrome harness to reuse)

**Canonical data (never regenerate):**
- `docs/testing/anthropic-results.json`
- `docs/testing/gpt-results.json`
- `gemini-all-models/raw-results.json`
- `docs/testing/inbrowser-results.json` (Phase 2 — native MLC rows)

## Track A — Affected baseline (in-extension)

**The point:** Phase 2 ran the canaries on native Metal via `mlc_llm serve` — fast, reliable, but not what users will actually experience. The browser offscreen document uses `@mlc-ai/web-llm` on WebGPU, with Chrome's memory pressure, service-worker lifecycle, and message-passing overhead all in play. A model that summarised sourdough in 940 ms via `mlc_llm serve` may take 2–5× longer in the extension, or produce subtly different outputs if the tokenizer/sampler settings drift between the native and browser packages. Those differences **are** HoneyLLM's real deployment characteristics. The Phase 2 table is the unaffected baseline; Track A produces the affected baseline.

**What to do:**

1. **Re-baseline all 6 MLC candidates through the extension.** For each candidate, swap `chrome.storage.sync[honeyllm:model]` to that candidate, reload the offscreen document, run 9 inputs × 3 probes against the model through the orchestrator pipeline, capture raw probe results + timing. Use Playwright to drive a real extension-loaded Chrome.
2. **Run Gemini Nano the same way** using `window.LanguageModel` inside a content-script/offscreen context — this replaces the 27 skipped rows from Phase 2 with real data. Requires `chrome://flags/#optimization-guide-on-device-model` enabled on the profile used for testing; warn the user if unavailable and produce skipped rows with a clear `skipped_reason`.
3. **Write output to `docs/testing/inbrowser-results-affected.json`** — separate file so the Phase 2 native data remains intact and comparable. Same schema as Phase 2, plus fields: `runtime_delta_ms_vs_native_phase2`, `behavioral_delta_flags` (list of classifier flags that differ between the native Phase 2 row and the affected Phase 3 row for the same model × input × probe), `first_load_ms` (cold-start time), `webgpu_backend_detected` (string).
4. **Produce a side-by-side comparison table** (native vs affected) per candidate, for: median inference latency, p95 latency, vulnerable-cell coverage, real-compliance rate.
5. **Re-run the FP review** on the affected data — a model whose behavior shifts in the browser may produce new FP patterns the Phase 2 classifier didn't see.
6. **Update the recommendation** from Phase 2 if the affected data changes it. For example, if Gemma 2 2B's inference time balloons to >20 s p95 in WebGPU, Qwen 0.5B may become the better primary. Or if Gemini Nano's affected numbers match or beat Gemma 2 2B, the strategic default shifts to zero-install.

**Expected row count for Track A:** 7 models × 9 inputs × 3 probes = 189 rows. Plus 189 Phase-2 native rows already on file = 378 paired comparison rows.

**Methodology options you must evaluate and pick one:**

- **Option A1 — Playwright drives the extension, probes run via existing orchestrator.** Send a synthetic `PAGE_SNAPSHOT` to the service worker; it chunks, calls offscreen, returns a `VERDICT`; capture the raw probe results via `chrome.storage.local`. Matches production flow exactly but bundles chunking + analyzers + policy — harder to isolate the canary's raw output.
- **Option A2 — Playwright drives the offscreen directly via a test-only message type.** Add a `RUN_PROBES_DIRECT` handler gated behind a test flag in `src/offscreen/index.ts` that bypasses the service worker and returns raw probe results. Clean data, fast to iterate. Adds ~10 lines of test-only code to the offscreen entry.
- **Option A3 — Expose the canary over a local HTTP endpoint via a content-script bridge.** Most isolated (same as Phase 2's `mlc_llm serve` pattern but actually running in WebGPU). Heaviest to build.

**Recommendation in the plan:** pick A2 — it's the minimal-change path that still gives clean probe-level data, and the test-only handler is reversible. But present all three options with tradeoffs in the plan file and let the user pick.

## Track B — Live-browser regression

Run the extension + selected canary against the 9 Phase-1 fixtures served from `localhost:8080` (existing `test-pages/` directory) AND at least one real public URL per category:

| Category | Fixture (local) | Real public page suggestion |
|---|---|---|
| clean | `test-pages/clean/simple-article.html` | Wikipedia "Sourdough" article |
| clean | `test-pages/clean/code-tutorial.html` | MDN JS tutorial |
| injected | `test-pages/injected/hidden-div-basic.html` | Synthesized local-only |
| injected | `test-pages/injected/inject_exfil.html` | Synthesized local-only |
| borderline | `test-pages/borderline/ai-research-paper.html` | arXiv paper on prompt injection |

For each fixture × each of 3 production LLMs:

1. **Extension ON:** Chrome with selected canary. Navigate to the LLM's browsing/agent UI, point it at the fixture URL. Record:
   - Extension verdict (`CLEAN`/`SUSPICIOUS`/`COMPROMISED`) from `chrome.storage.local[honeyllm:verdict:*]`
   - Verdict-fire timing: how long between page nav and verdict-fire
   - LLM final response text (what the user sees)
   - Whether the LLM was tricked
2. **Extension OFF:** Same navigation, same LLM, no extension. Compare LLM behavior against the Phase 1 baseline row for the same (model, input, probe).

**Primary LLMs + agent modes:**
- Claude.ai with web search and computer-use mode
- ChatGPT with browsing and Agent Mode / Atlas
- Gemini web with browsing + Deep Research, plus AI Studio with grounding

Budget: ~$20 AUD combined across all three. Agent modes burn tokens fast — monitor.

## Track C — Native-surface functional detection

For each surface below, document:
- **Attachment mode:** `extension_active` / `manual_paste` / `proxy` / `not_applicable`
- **Result:** extension verdict if applicable, LLM compliance on the injection, whether a canary would have helped

**Anthropic:** Claude.ai web, Claude Desktop, Claude Code CLI, Agent SDK (TS + Python)
**OpenAI:** ChatGPT web + desktop, Atlas browser, Codex CLI, Codex Code, Responses/Assistants/Realtime APIs
**Google:** Gemini web, Gemini app, AI Studio, Vertex AI Workbench, Gemini SDK (Python + JS), Antigravity / Jules
**Emergent surfaces:** document any other surface encountered

For surfaces the extension cannot attach to, state:
- What a protection story would need to look like (sidecar process, SDK middleware, system-level network filter)
- Whether Phase 3 testing suggests such a solution is worth building

## Deliverables

1. **`docs/testing/inbrowser-results-affected.json`** — Track A row data (189 rows, or 189 minus whatever Gemini Nano skips cleanly)
2. **`docs/testing/phase3-results.json`** — Track B + Track C rows per-surface, extending the Phase 2 schema with:
   - `surface` (e.g. `"claude.ai-web-agent"`, `"gemini-app-native"`, `"vertex-workbench"`)
   - `attachment_mode` (`extension_active` / `manual_paste` / `proxy` / `not_applicable`)
   - `agent_mode` (`browsing` / `computer_use` / `deep_research` / `none`)
   - `llm_final_response_text`
   - `extension_fired_before_model_saw_content` (bool)
   - `verdict`, `verdict_latency_ms`
   - `fp_review` (manual)
3. **`docs/testing/PHASE3_REGRESSION_REPORT.md`** — sections:
   - Executive summary + scope
   - **Native-vs-affected delta table** (Track A) — per candidate, per metric
   - **Revised canary recommendation** — may or may not differ from Phase 2's Gemma 2 2B pick depending on affected data
   - Detection accuracy matrix: live-browser extension verdicts vs ground truth (Track B)
   - Mitigation efficacy: LLM compliance drop when extension ON (Track B)
   - Surface-coverage matrix (Track C) — CAN vs CANNOT attach
   - Performance: end-to-end latency, p50/p95 verdict fire time, tokens consumed by canary
   - Regressions vs Phase 1 and Phase 2
   - Newly exposed failures (agent-mode injections that didn't fire via direct API)
   - Known gaps and future-work backlog
4. **`scripts/run-affected-baseline.ts`** — Track A runner (Playwright + extension, picks one of Options A1/A2/A3)
5. **`scripts/run-phase3-live.ts`** — Track B runner for the automatable subset
6. **Efficacy verdict:** a clear data-backed yes / no / qualified-yes on *"Can HoneyLLM's in-browser canary + current detection logic reliably flag real-world prompt injection before it reaches production LLMs across the tested surfaces?"*. Gate decision for shipping vs returning to tuning.
7. **Tuning backlog:** concrete probe, analyzer, threshold, or canary-model changes based on Phase 3 findings
8. **Updated `MODEL_BEHAVIORAL_TEST_REPORT.md` v1.4 changelog entry** linking the Phase 3 report

## Hard rules

- **Do not regenerate Phase 1 or Phase 2 rows.** `anthropic-results.json`, `gpt-results.json`, `gemini-all-models/raw-results.json`, `inbrowser-results.json` are canonical.
- **Track A writes to `inbrowser-results-affected.json`, not `inbrowser-results.json`** — keep native + affected separate so the delta is calculable.
- **API keys from env only.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`. Never persist.
- **Budget: ~$20 AUD combined for Track B + any direct-API retest work.** Agent-mode tokens burn fast. Monitor.
- **Manual FP discipline on every flagged row.** Phase 1 had 20+ FPs on Claude; Phase 2 had 13 FPs across 162 rows. Expect Phase 3 rates to be at least that high — especially Track A where the WebGPU tokenizer may produce subtly different outputs.
- **Native-app testing that can't be automated → manual with screenshots.** Don't fake Playwright drivers for Claude Desktop; describe the procedure and log observations.
- **Explicit efficacy verdict in the report.** "Maybe" is not acceptable. If data doesn't support a clear verdict, state what additional testing would produce one.
- **No new extension features unless a bug blocks validation.** Mitigation-mode toggle is known missing from Phase 2; note as gap, don't build it.
- **For Track A Option A2, the test-only `RUN_PROBES_DIRECT` handler must be gated.** Use a storage flag (e.g. `honeyllm:test-mode` = true) so it's inert in production. Revert the flag before committing. Do not ship test code to production manifest.

## Starting instructions

1. Read the 8 reference files listed above, in order.
2. Draft the plan at `/Users/node3/.claude/plans/honeyllm-phase-3.md`.
3. Seed 20–30 tasks in the tracker with blockers wired.
4. Present the plan via ExitPlanMode. Do not start executing.
5. After approval, execute Track A first (the affected baseline is the foundation for Track B interpretation). Then Track B. Then Track C. Then the report + efficacy verdict.

---

End of prompt. Phase 1 + Phase 2 artifacts are all present; nothing else needs to be prepared.
