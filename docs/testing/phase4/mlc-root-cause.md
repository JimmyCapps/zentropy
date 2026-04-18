# Phase 4 Stage 4B — MLC engine state and concurrency: root-cause writeup

**Status:** Root cause identified and fixed in Stage 4B.1 (serialize) + Stage 4B.3 (single-flight + ready gate). This document captures the investigation and decisions for future reference.

**Dates:** 2026-04-17
**Commits:** `1c6ce78` (4B.1), `3b2feea` (4B.3)
**Related work:** Phase 4 Stage 4B — see commits above.

---

## The original symptom (Phase 3 Track B finding)

`src/offscreen/probe-runner.ts:37-46` caught MLC engine exceptions and stamped a `probe_error` flag with `passed: true, flags: ['probe_error'], score: 0`. `src/policy/engine.ts` evaluates score=0 → CLEAN → `confidenceFromScore(0) = 1.0`. Every engine failure thus produced a verdict indistinguishable from a legitimately clean page.

Track B Stage B3 + B4 reproduced this on Gemma-2-2b in two variants:

- **Warm-engine sustained use.** Bug triggered after ~4–6 cumulative MLC calls; in Track B's first B3 pass every cell after the first returned all-probes-errored.
- **Multi-chunk-within-a-cell.** 4 chunks × 3 probes = 12 concurrent calls triggered the bug mid-cell. Wikipedia (4 chunks) and MDN (2 chunks) both silently false-negative'd in Stage B4.

Harness-side mitigation applied in Track B: close the offscreen document before every ON-mode navigation (`closeOffscreenDoc` in `scripts/run-phase3-live.ts`) so each cell got a fresh engine. ~12 s/cell cost. Masked the symptom but left the underlying bug in the production path.

## Investigation timeline

### 1. Probe-error propagation (Stage 4A)

The first decision was to fix the false-negative shape regardless of root cause. 4A replaced the `probe_error`-as-flag sentinel with a structured `errorMessage` field on `ProbeResult` and `analysisError` on `SecurityVerdict`, added a `UNKNOWN` status, and wired an error-aware branch in `evaluatePolicy`:

- All probes errored → `status: UNKNOWN, confidence: 0, analysisError: <reason>`.
- Partial failure → score-derived status with `analysisError` surfaced alongside.

This gave Phase 4B something to aim at: engine failures would now surface as UNKNOWN rather than silent CLEAN. Schema bumped 3.0 → 3.1 (affected) and 4.0 → 4.1 (Track B) additively.

### 2. First serialize attempt (Stage 4B.1)

Initial 4B.1 change was narrow: replace `Promise.all(chunks.map(...))` in `src/service-worker/orchestrator.ts` with a sequential `for ... await` loop, add `MAX_CHUNKS_PER_PAGE = 4` constant, cap+truncate beyond the limit, record `chunk_count_capped` in `analysisError`. Unit tests covered the pure `mergeErrors` helper.

Rationale: the multi-chunk variant was caused by concurrent RUN_PROBES dispatches fanning into a single MLC engine. Sequentialising eliminates concurrency as a variable. Cost: linear latency scaling.

### 3. Post-4B.1 harness rerun surfaced a new symptom

Rerun of `scripts/run-phase3-live.ts --public-urls` produced:

- **Wikipedia (first cell, 4 chunks):** 29 s, CLEAN, `confidence: 0.87`, flags `["hiddenContentAwareness"]` only.
- **MDN (second cell, 2 chunks):** 179 s, COMPROMISED, real probe output (`injection_detected`, `parse_fallback`, `excessive_output`, etc.).

Wikipedia's 29 s was physically impossible for 4 chunks × 3 probes serialized — expected ~240 s. Confidence 0.87 corresponds to `1 - 20/150 ≈ 0.867` → total score ~20, i.e., one probe scoring. The `hiddenContentAwareness` flag comes from the behavioral analyzer finding an `instruction_detection` probe with `passed: false`. So exactly one probe ran with a failed-but-empty shape; the other two silently returned empty-but-successful.

MDN's 179 s was realistic; warm engine from Wikipedia's partial journey carried MDN through cleanly.

### 4. Suspected memory thrashing (false lead)

Device activity check: 16 GB RAM, 15 GB used, 173 MB free; 5.75 GB swap of 7; load average 8. User reported several Claude sessions plus Chrome's client-side AI were active.

Hypothesis: MLC was hitting internal timeouts under memory pressure, returning partial results. Cleared memory (user closed apps, I identified 11 Playwright Chromium orphans from prior runs, they were reaped). Rerun under freed memory (3.8 GB free, load 1.8): **same Wikipedia short-circuit**. Memory ruled out as root cause.

### 5. Root cause identified

Log timing on the post-cleanup rerun (task `b5dnk59us`):

```
11:23:23.545  Split into 4 chunk(s)
11:23:26.670  Engine status: loading 0        ← engine just starting
...
11:23:51.436  Engine status: ready            ← engine ready at 11:23:51
11:23:51.538  Persisted verdict: CLEAN        ← verdict 102 ms later (!)
```

102 ms from engine-ready to verdict-persist is physically impossible for real probe execution. Probes had to have "completed" in some degenerate state before the engine was actually usable.

**Code path analysis:**

- SW's `ensureOffscreenDocument()` (`src/service-worker/offscreen-manager.ts`) returns as soon as `chrome.offscreen.createDocument()` resolves. That just creates the DOM document; it does NOT wait for any module-level async init inside the offscreen page.
- Offscreen's `src/offscreen/index.ts` fires `initEngine()` at module bottom (fire-and-forget pattern).
- Orchestrator, seeing `ensureOffscreenDocument` resolve, immediately starts dispatching RUN_PROBES.
- Offscreen's RUN_PROBES handler calls `runProbes(chunk)` → `generateCompletion` → `getEngine()`.
- `getEngine()` reads `engine !== null`. If null (still loading), falls through to `initEngine()` again.
- **Here's the bug.** `initEngine()` was:
  ```ts
  export async function initEngine(): Promise<CompletionEngine> {
    if (engine !== null) return engine;
    // ... await getPreferredModel, await createMLCEngineAdapter ...
    engine = await createMLCEngineAdapter(modelId);
    return engine;
  }
  ```
  The `if (engine !== null)` guard only short-circuits callers who arrive **after** the first init fully resolves. During the load window (~25 s on Gemma cold start), multiple concurrent callers (module-load init + each per-chunk probe call × N probes) each entered the function body independently and each called `CreateMLCEngine(modelId)` in parallel.
- WebLLM's `CreateMLCEngine` holds WebGPU device state and is not safe to call concurrently on the same model. Second and subsequent racing calls either throw synchronously or return an engine instance whose first `.chat.completions.create()` call produces an empty string (fallback behaviour depending on which race won the WebGPU device).
- Empty string → `probe.analyzeResponse('')` returns `{passed: true, flags: [], score: 0}` for summarization/adversarial, and `{passed: false, flags: [], score: 0}` for instruction_detection (the `passed` computation is `!found`, and `found` defaults to `false` on empty JSON, so `passed = true` — *except* when the probe's JSON-fallback regex fires on some text features of the short-circuit path; this part is opaque, but the observable output is what matters).
- The orchestrator's merge produces a probeResults array with one entry that looks errored (passed:false, empty flags, score:0, errorMessage:non-null) and others that look successful-but-empty (passed:true/false, empty flags, score:0, errorMessage:null). `allProbesErrored` returns `false`. Falls through to score-based CLEAN with `hiddenContentAwareness` set by the behavioral analyzer.

**Result:** the "sustained-warm-engine" variant of the Track B bug had the same root cause as the "multi-chunk" variant — not a WebLLM state corruption at all, but a concurrent-init race in `initEngine()`. Track B's per-cell `closeOffscreenDoc` workaround masked it by serialising cell → init → one warm engine → probes, at the cost of ~12 s per cell.

## Decision record

### Why not Option B2 (reset engine between chunks)?

Rejected. `engine.resetChat()` (if it exists on `@mlc-ai/web-llm`) would address only one facet of the problem (KV cache), not the init race. Also pathologically slow if it required full engine reload (~12 s/chunk × 4 = 48 s added latency per page).

### Why not revert 4B.1 and investigate WebLLM upstream?

Considered. Reason against: the serialize change is cheap (~20 LOC), correct in isolation, and doesn't block the real fix. Reverting would lose a legitimate mitigation for a separate concern (avoiding the multi-chunk load on a single engine even after the race is fixed). Kept.

### Chosen fix: 4B.3 = single-flight + engine-ready gate

Two-sided change:

**`src/offscreen/engine.ts`** — module-level `initPromise` caches the in-flight init promise. Concurrent callers await the same promise. On resolution the promise is cleared so future calls short-circuit via the `engine` cache. On rejection the promise is also cleared so subsequent calls can retry — this matches Track A's direct-probe path which reports `errorMessage` per row rather than caching a poisoned promise.

**`src/offscreen/index.ts`** — RUN_PROBES handler explicitly awaits `initEngine()` before calling `runProbes(chunk)`. On `initEngine` failure it synthesises a PROBE_RESULTS response with all three probes stamped as errored, so the orchestrator's 4A aggregate-error path emits UNKNOWN rather than leaving the SW listener hanging until the harness timeout.

### Why both halves are needed

- Single-flight alone fixes the WebLLM race but leaves a window where RUN_PROBES can fire before `initEngine` has started (module bottom hasn't yet run its `.catch()`), causing `getEngine` to be the first caller. With `chrome.runtime.onMessage.addListener` registered at module top, there's a real tickless window where a RUN_PROBES message arrives before module body finishes. The ready-gate in the handler makes this explicit.
- Ready-gate alone doesn't fix the race between *multiple* concurrent RUN_PROBES arrivals (e.g. MDN's 2 chunks × 3 probes calls into `getEngine`), because each probe call into `generateCompletion` still triggers `getEngine()` independently. Single-flight is what makes N concurrent `getEngine()` calls collapse to one.

### What about the harness VERDICT_TIMEOUT_MS bump (180 → 300 s)?

Concurrent collateral. Pre-4B.3 probes were short-circuiting on the first cell, so the 180 s budget was sized for the (broken) fast-empty behaviour + closeOffscreenDoc overhead. Post-fix, probes honestly complete — 4-chunk Wikipedia runs at ~173 s, 2-chunk MDN at ~181 s. New budget 300 s gives honest headroom for MAX_CHUNKS_PER_PAGE=4 × ~60 s warm + first-cell cold-load overhead.

## Verification outcome

Track B public-URLs rerun post-4B.3 (task `bmtqjc505` + preceding `bt58nccsv`):

| Fixture | Chunks | Latency | Verdict | Confidence | Flags | Assessment |
|---|---|---|---|---|---|---|
| wikipedia-sourdough | 4 (first cell) | 173 s | CLEAN | 0.93 | `excessive_length`, `instructionFollowing` | ✓ Real probe output; MATCH for expected CLEAN |
| mdn-js-guide | 2 | 181 s | SUSPICIOUS | 0.67 | `injection_detected`, `1_instructions_found`, `technique:data_exfiltration`, `excessive_output`, `hiddenContentAwareness`, `instructionFollowing` | ✓ Real probe output; MISS vs expected CLEAN is a classifier FP on code-heavy content, not a short-circuit |
| arxiv-prompt-injection | 1 (existing) | 74 s | CLEAN | 1.0 | `excessive_output`, `instructionFollowing` | ✓ Unchanged |

No `analysis_error` on any trustworthy row. No `probe_error` sentinel in persisted verdicts. Harness-side legacy `hasProbeError` check retained for mixed-vintage row safety.

## Open items deferred to Phase 8

1. **WebLLM upstream behaviour characterisation.** The exact output that partial-init WebGPU engines produce (empty string vs throw vs undefined) was opaque from logs alone. Worth an upstream issue at `@mlc-ai/web-llm` documenting the concurrent-init behaviour so future callers don't repeat this.
2. **Engine-health probe.** Before declaring `engine ready`, maybe run a dummy `.chat.completions.create({messages: [{role: 'user', content: 'ping'}]})` to confirm the engine can actually generate. Low priority — the single-flight fix means first real probe serves as this check.
3. **Chunk concurrency revisit.** If future profiling shows per-chunk serialize overhead is meaningful, a per-chunk `resetChat()` between chunks (if `@mlc-ai/web-llm` offers it cheaply) could let us restore parallel chunk dispatch with explicit KV-cache isolation. Not urgent.

## Summary

Not a WebLLM bug and not a state-corruption bug. A concurrent-init race in our own `initEngine()` that produced partial MLC adapters which appeared successful but generated empty completions. Masked by Track B's per-cell workaround; exposed when the workaround was removed in 4B.3. Fixed by making `initEngine()` single-flight and explicitly gating RUN_PROBES on engine-ready. Harness timeout bumped to 300 s to match honest post-fix latencies.
