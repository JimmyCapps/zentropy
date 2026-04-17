# Phase 4 Enhancement Requests — Phase 8 Candidates

Two enhancement ideas captured during Phase 4 Stage 4D, not in scope for
Phase 4 but worth tracking for Phase 8 or dedicated follow-on work.

## 1. Delta-cache for page snapshots

**Date captured:** 2026-04-18 (Phase 4 Stage 4D.3 → 4D.4 transition)

**Origin:** User suggestion after the context-window overflow bug on Wikipedia
(`Prompt tokens exceed context window size: 4749 tokens; context window: 4096`).

### Idea

Cache a fingerprint of previously-analysed pages so that a revisit can skip
the full analysis pipeline when content is unchanged. Only re-analyse the
*delta* between the cached snapshot and the current one when drift is
detected.

### Why it's valuable

- **Speed.** A revisit of a known-clean page returns a cached verdict
  immediately rather than waiting ~20s for three probes on a warm Gemma
  engine.
- **Context-window relief.** When drift is narrow (a single paragraph
  added), only the delta needs to feed into the probes, bringing the
  effective prompt size well under the 4096-token Gemma ceiling. This is
  the angle that makes it Phase 8 relevant rather than optional.
- **Probe targeting.** `instruction_detection` could skip known-safe DOM
  subtrees and re-run only on changed sections, reducing both latency and
  the classifier FP surface.
- **Trust bootstrapping.** Pages manually triaged as false-positive
  survive across visits if their structure is unchanged.

### Existing Chrome mechanisms to leverage

| Mechanism | Fit |
|---|---|
| `chrome.storage.local` | What we already use for verdicts. Fine for small summaries. Scales poorly for full snapshot bodies. |
| **IndexedDB via offscreen document** | Best fit. Per-origin quota is generous; structured-clone supports our PageSnapshot shape directly; no JSON round-trip cost. |
| `caches.open()` Cache API | Works for whole-document HTTP responses. Mismatched shape for our snapshot abstraction (we're not caching HTTP responses, we're caching extracted text+DOM features). |
| `chrome.webRequest.onCompleted` with ETag/Last-Modified | Pre-navigation signal: if HTTP cache says "same" → skip snapshot extraction entirely. Cheapest tier of short-circuit. |
| `performance.getEntriesByType('navigation')` bfcache signal | Strongest "identical content" signal. Free, fast, reliable. |

### Proposed architecture sketch

1. **Pre-analysis fast path.** On `PAGE_SNAPSHOT` arrival, check bfcache
   signal and HTTP cache hit. If both indicate no change, retrieve last
   verdict from IndexedDB keyed on `(origin, url, content-sha)` and
   return instantly.
2. **Delta extraction.** If fingerprint differs, compute DOM diff between
   cached snapshot and current snapshot. Produce a minimal "changed
   regions" payload.
3. **Targeted probe.** Feed only the changed regions into the probes.
   Preserve the cached verdict's stable parts (e.g., if the instruction-
   detection probe was CLEAN on all unchanged sections, re-running it
   only on the delta is sound).
4. **Cache write.** On verdict generation, persist the full snapshot +
   verdict to IndexedDB. TTL via reverse-eviction (oldest entries first)
   to stay within a configurable memory budget.
5. **Privacy layer.** Opt-in via popup toggle. Per-origin deny list
   (auto-skip banking, health, auth-gated pages). User-visible "pages
   cached locally" counter in the popup for transparency.

### Trade-offs and risks

- **Privacy concerns.** Storing page contents across sessions raises
  obvious questions even locally. Needs clear opt-in, deny list, and
  cache-inspection UI.
- **Cache invalidation.** DOM structure can shift for purely cosmetic
  reasons (ads, timestamps, auto-refresh widgets). Hash granularity
  needs careful thought — section-level semantic hashes outperform
  full-page hashes but cost more CPU.
- **Staleness window.** If a previously-cached page becomes compromised
  but the cache still shows CLEAN, the user is exposed until drift is
  detected. Mitigation: bound cache freshness by TTL (e.g., 24h), force
  re-analysis on major version bumps of HoneyLLM itself.
- **Storage quota.** 60k chars × 1000 pages ≈ 60 MB. IndexedDB per-origin
  quota on Chrome is typically tens of GB so not a problem, but worth
  a quota check before write.

### Blocking dependencies

- None currently. Could land any time after Phase 4 completion.

### Estimated effort

Medium. ~200-400 LOC for the IndexedDB layer + snapshot diff algorithm,
plus UX work for the opt-in toggle and cache-inspection UI.

## 2. Turboquant for smaller model footprint + bigger KV cache

**Date captured:** 2026-04-18 (Phase 4 Stage 4D.4)

**Origin:** User feature request after seeing the context-window overflow
and the ~1.5 GB Gemma-2-2b RAM footprint in production use.

### Idea

Adopt **turboquant** (sub-4-bit LLM weight quantization technique, published
early 2026) within our WebGPU/Chrome inference path to load the same models
with a smaller memory footprint and trade the freed memory for a larger KV
cache (i.e., a larger effective context window).

### Why it's valuable

- **Context overflow relief.** Today's hard ceiling is 4096 tokens on
  Gemma-2-2b-q4f16_1. Wikipedia (4749 tokens) and any reasonably long
  article overflow. A larger KV cache directly lifts this ceiling.
- **Lower memory footprint.** ~800 MB-1.2 GB for Gemma-2-2b under
  turboquant vs. ~1.5 GB today. Lets the extension run on lower-end
  devices and leaves more headroom when Chrome is memory-pressured.
- **Model quality preserved.** Turboquant's reported perplexity delta
  vs 4-bit quantisation is small (paper claims <1% degradation on
  benchmarks). For our detection-probe use case this matters less than
  for generation, because we're classifying structured outputs.
- **Opens door to larger models.** Gemma-2-9b under turboquant fits in
  the same footprint as Gemma-2-2b under q4f16_1. Opens the tradeoff
  of "smaller model + bigger context" vs "bigger model + current
  context."

### Current state of turboquant + WebGPU (early 2026)

- `@mlc-ai/web-llm` (our current transport) has not shipped turboquant
  kernels as of the Phase 4 writeup date. Their quantisation toolchain
  supports q4f16_1 and q4f32_1 only.
- The turboquant paper provides kernels for CUDA / Metal directly. WGSL
  (WebGPU Shading Language) ports are not yet public.
- Chrome's built-in Gemini Nano likely uses a proprietary quantisation
  but is not documented. Google has coauthored the turboquant paper so
  Nano's compression scheme may evolve in this direction.

### Paths to adopt

1. **Wait for upstream MLC-LLM support.** Simplest. Timeline unclear; no
   public roadmap signal as of 2026-04.
2. **Fork and add turboquant WGSL kernels.** Significant WebGPU + WGSL
   expertise needed. Out of scope for a standalone detection extension.
3. **Transport swap to ONNX Runtime Web.** ORT Web has broader
   quantisation support and is actively developed. Would require
   rewriting `src/offscreen/engine.ts` with an ORT adapter alongside
   the MLC one. Similar to the dual-path work we just did for Nano.
4. **Wait for Chrome Nano with turboquant.** If Google ships a
   turboquant-compressed Nano, we get the benefit "for free" via the
   existing Phase 4D Nano adapter.

### Blocking dependencies

- Phase 4 complete.
- Upstream support in at least one of: `@mlc-ai/web-llm`, ONNX Runtime
  Web, or Chrome Prompt API.

### Estimated effort

- Path 1 (wait): 0 work, unknown timeline.
- Path 2 (fork): 4-6 weeks of WebGPU/WGSL work, unlikely this phase of
  the project.
- Path 3 (ORT swap): 1-2 weeks for the adapter + validation. Plus
  probe-behavior regression testing since ORT's output distribution
  may differ from MLC's.
- Path 4 (wait for Nano): 0 work, we benefit automatically if Google
  ships it.

### Recommendation

**Pursue Path 1 + Path 4 passively** — check upstream MLC releases
quarterly; enable automatically in the canary catalog once a
turboquant model ID becomes available. Path 3 (ORT swap) is viable
but carries significant regression risk and should only be taken if
upstream MLC stalls for 6+ months.

## Linking these to the Phase 4 work

Both requests intersect with known Phase 4 limitations:

- **Context-overflow bug** observed in today's Stage 4D.1 spike run
  (`Prompt tokens exceed context window size: 4749 tokens; context
  window: 4096`). Delta-cache partially addresses by chunking only
  the changed region. Turboquant more fundamentally addresses by
  enlarging the window.
- **Gemma's ~1.5 GB footprint** that motivates the Chrome memory-
  pressure precautions we took in Stage 4B/4C. Turboquant directly
  reduces this.
- **Repeated-visit cost** that today triggers a full 120s analysis
  on every Wikipedia reload. Delta-cache is the clean fix.

Neither enhancement blocks Phase 4 completion. Both are tracked here
for post-Phase-4 planning.
