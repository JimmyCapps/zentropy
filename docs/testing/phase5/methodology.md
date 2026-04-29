# HoneyLLM — Phase 5 Testing Methodology

**Document version:** 1.0
**Date:** 2026-04-29
**Status:** Authoritative testing reference for Phase 5 onward
**Issue:** [#123](https://github.com/JimmyCapps/zentropy/issues/123) (N10)
**Supersedes:** Phase 2/3 fixture-corpus track for new evaluations; historical Phase 2 (`docs/testing/inbrowser-results.json`) and Phase 3 reports (`docs/testing/phase3/`, `docs/testing/phase4/`) are preserved as frozen records.

---

## Executive summary

Phase 2 and Phase 3 evaluated HoneyLLM detection accuracy against a hand-curated synthetic-fixture corpus served from `test-pages/` and (later) `fixtures.host-things.online`. The fixture approach got us through SHIP/defer decisions for the canary (Gemma vs Nano) and the v1/v2 classifier split, but it accumulated three structural problems that no further code fixes can paper over: URL-slug contamination of the LLM input, free-chat portal hallucination from slugs alone, and Claude Code build-blocking on synthetic injection sites. The Phase 5 Hunters trio (Spider regex + Hawk dialect-classifier + tier-router) plus the in-extension primitives that landed alongside it — testing-mode A/B (#113), page-stamp signing (#117), evidence-packet probes (#118), pedagogical-FP corpus (#120) — provide enough orthogonal signal that the synthetic-fixture corpus is no longer the critical path.

This document defines the replacement: a five-layer eval pyramid that uses real-world content as the primary signal, retains curated honeypots only as a Hunter regression contract, validates mitigation efficacy through in-extension testing-mode A/B, and confirms the LLM-consumer actually read the mitigated page through page-stamp validation rather than slug inference. It also documents the disposition of the IndoorLife.store fixture-site track (paused) and reframes Phase 3 Track B's resumption plan (#2) to consume this methodology rather than the original B5/B7 stage plan.

The deliverable scope is detection-accuracy + mitigation-efficacy measurement against in-browser content. Provider-side moderation behaviour (covered separately by `MODEL_BEHAVIORAL_TEST_REPORT.md`) and agentic-mode tool-use measurement (deferred) are out of scope.

---

## Scope and limitations

**In scope:**

- Detection accuracy of the Hunters tier (Spider + Hawk) on real-world page content, measured deterministically.
- Detection accuracy of the LLM probe tier on UNCERTAIN/FLAGGED chunks routed by the tier-router.
- Mitigation efficacy in the user-visible LLM-consumer surface, measured as the behavioural delta between testing-mode-on (no mitigation dispatched) and "Rescan with prevention" (mitigation dispatched).
- False-positive guard against pedagogical content that *describes* attack techniques without *containing* them.
- Page-stamp validation as ground truth that the LLM-consumer read the mitigated page rather than hallucinating from a slug.

**Out of scope:**

- Provider-side direct-API behaviour. Covered separately by `docs/testing/MODEL_BEHAVIORAL_TEST_REPORT.md`. Different question, different harness.
- Agentic-mode tool-use measurement (Claude in Chrome, ChatGPT Agent Mode, Gemini Deep Research). Deferred until the Browse MCP server (#124), Agent SDK `wrapWebTool` (#125), or Local Proxy (#133) provides a controllable interception surface.
- Multimodal injection (image alt-text, OCR'd attack text in screenshots). Tracked separately under Phase 4G.
- Cross-origin or iframe-embedded LLM consumers. Trust-boundary concern documented in `docs/ARCHITECTURE.md` §"Trust Boundaries", not a methodology concern.

**Hard invariant:** `docs/testing/inbrowser-results.json` is the byte-locked Phase 2 baseline (per `CLAUDE.md` §"Phase 2 canonical file is locked"). Phase 5 methodology never produces inputs to or outputs from that file. The canonical Phase 2 row count, classifier-v1 byte-identity, and the cross-phase delta-comparison contract documented in `docs/testing/phase3/AFFECTED_BASELINE_REPORT.md` are preserved unchanged.

---

## Why the previous track was retired

### URL-slug contamination

Phase 3 Track B observations (#S935, #S938, #S939) recorded that probe inputs were routinely classified COMPROMISED *because the URL path itself encoded the attack technique*. Paths like `/injected/hidden-div-exfil`, `/injected/white-on-white`, and `/injected/alt-text-injection` leak the technique label to the LLM before any page content is read. A model that classifies the URL as suspicious without reading the body still scores as "detected", inflating recall numbers in a way that does not transfer to real pages where URLs do not announce their attack class.

The contamination is structural: synthetic-fixture URLs need to be human-readable and discoverable, and any descriptive slug ("clean", "borderline", "injected/...") tells the LLM what answer it is supposed to give. Renaming to opaque hashes would solve the leak but defeat the purpose of a curated reference set.

### Free-chat portal hallucination

Free-chat portal evaluations during Track B Stage B5 surfaced a worse failure mode: the portals (Claude.ai, ChatGPT, Gemini.google.com) cannot fetch `noindex`'d fixture pages. When asked "what does this page say about X", they hallucinate from the URL slug alone. A fixture at `/injected/hidden-div-basic` produces a confident "the page contains a hidden injection in a div" answer with zero page bytes read. This makes free-chat portals unusable as ground-truth measurers of mitigation efficacy on synthetic fixtures.

Page-stamp validation (#117) directly addresses this — a stamp the consumer has to echo back proves the page was actually fetched — but the stamp signal only adds value on top of inputs the consumer can fetch. Real-world URLs solve both problems at once: they have no contamination AND consumers can reach them.

### Claude Code build-blocking on synthetic injection sites

The IndoorLife.store track (Astro e-commerce fixture, Phase A clean build + Phase B injection embedding) repeatedly tripped Claude Code safety guardrails when asked to generate the Phase B payloads. Compounding this: the Phase A/B split landed only partially before the friction made further Phase B work uneconomical. Continuing to push the synthetic-fixture track therefore costs scarce agent-session time without buying signal that real-world content does not already provide.

### Phase A/B split partial landing

The clean Phase A build of IndoorLife.store remains usable as a hosting target if ad-hoc honeypot hosting is ever needed, but it is no longer on the critical path. See "IndoorLife.store track — disposition" below.

---

## The new eval pyramid

Five layers, ordered by primary-eval weight. Layers 1–3 measure detection; Layer 4 measures mitigation efficacy; Layer 5 is the ground-truth-of-read mechanism that makes Layer 4 meaningful.

### Layer 1 — Real-world content as primary detection eval

**Inputs:** Wikipedia articles, news sites (Reuters, AP, BBC), e-commerce product pages (Amazon, indie Shopify stores), forums (Reddit, Hacker News, Stack Overflow), code-hosting README pages (GitHub, GitLab).

**Why this is now possible:**

- URL-slug contamination is impossible — the slugs are real and uncorrelated with attack class.
- Hunters score deterministically per-chunk and emit BENIGN / UNCERTAIN / FLAGGED via `routeChunk` (`src/service-worker/tier-router.ts:22`). The TierDecision union is `'BENIGN' | 'UNCERTAIN' | 'FLAGGED'` (`src/types/verdict.ts:28`); there is no separate "Tier-2" formal type, and the methodology should not pretend otherwise.
- LLM probes only run on UNCERTAIN/FLAGGED chunks (cf. `src/service-worker/orchestrator.ts:248`). This makes a real-world sweep cheap enough to run continuously rather than as a discrete phase.
- Per-chunk routing decisions are published on `SecurityVerdict.perChunkAnalysis` (`src/types/verdict.ts:94`), giving a stable data shape for cross-page aggregation.

**Sampling strategy:**

- Domain diversity — at least 20 distinct top-level domains per evaluation pass.
- Language diversity — English, Spanish, German, Mandarin, Japanese, Arabic. Hawk's dialect-classifier behaviour is the bottleneck; once #121 (dialect-aware boundary detection, consumes #119's `detectLanguage`) ships, sampling can extend to additional CJK/RTL languages without artefact.
- Content shape — long-form prose, structured listings, code-heavy pages, threaded discussions, mixed-language pages.
- Adversarial inclusion — the corpus deliberately *does not* exclude pages that discuss prompt injection (security blogs, CVE writeups, the OWASP LLM top 10). Those pages are the pedagogical-FP layer; their job is to confirm that detection does not fire on the *description* of an attack.

**Measurement:**

- Hunter recall is measured against a small label-budget (a few dozen confirmed-positive real-world examples held back from the sweep).
- Hunter false-positive rate is measured as the fraction of clean real-world chunks routed UNCERTAIN or FLAGGED. Target: <2% per chunk, <10% per page.
- LLM-probe routing efficiency is measured as the fraction of total chunks that ever reach the probe stack. Per Gate C estimate in `docs/ARCHITECTURE.md` §"Layered Detection", target is 5–12% (88–95% pruned by Hunters).
- Output: a sweep report under `docs/testing/phase5/real-world-sweep-{date}.md`, mirroring the structure of `docs/testing/phase3/AFFECTED_BASELINE_REPORT.md` (what changed, source files, FP curation totals, per-probe distribution).

### Layer 2 — Curated honeypots as adversarial regression eval

**Inputs:** the existing `test-pages/` ~23-page benchmark, plus the deferred DM-4 1250-fixture dialect corpus (DetermiLLM-side, not yet enabled here).

**Role:** Hunter regression contract, *not* an LLM eval.

**Invariant:** This corpus is the only place URL-slug-contaminated fixtures are tolerated. They exist to lock in deterministic Hunter behaviour against a known set of attack shapes. A synthetic fixture's value here is "Spider's regex catalog still matches `__AI_SITE_STATUS__`-shaped strings", not "the LLM detects this attack". The slug contamination problem is irrelevant when the LLM tier is not the measured surface.

**Measurement:**

- Hunter outputs are compared against an expected-result table per fixture. Any divergence is a regression.
- Recall is binary per fixture (does the Hunter slate catch it or not). Aggregate recall on the 23-page slate is the headline metric.
- LLM probe behaviour on these fixtures is *recorded* but not used for headline numbers because of slug contamination.

### Layer 3 — Pedagogical corpus

**Inputs:** the false-positive guard corpus produced by #120 (N15). Forward link: [`docs/testing/phase5/PEDAGOGICAL_BASELINE.md`](./PEDAGOGICAL_BASELINE.md) — created by N15 (#120, not yet shipped at time of writing).

**Purpose:** distinguish "page contains an attack technique" from "page describes an attack technique". The 2026-04-29 Hunter-pivot evidence-review probe (#118) added a pedagogical rule into its prompt; this layer is the corresponding measurement surface.

**Measurement:**

- FP rate against pedagogical-FP corpus is computed per probe and per Hunter. Baseline numbers belong in `PEDAGOGICAL_BASELINE.md` once N15 lands.
- Methodology assumption: pages that *describe* injections (security blogs, CVE explainers, OWASP write-ups) should never produce a COMPROMISED verdict. SUSPICIOUS is acceptable for pages that quote attacker text verbatim; CLEAN is preferred.

### Layer 4 — Testing-mode A/B as in-extension efficacy eval

**Inputs:** any URL the user can navigate to (real-world from Layer 1 or curated from Layer 2 — both work).

**Mechanism:**

- Testing-mode flag (`src/shared/testing-mode.ts:16,27` — `isTestingModeEnabled` / `setTestingMode`). When ON, detection runs unchanged but `dispatchVerdictMessages` skips `APPLY_MITIGATION`. This is the unmitigated baseline.
- "Rescan with prevention" handler (`src/service-worker/index.ts:103` — `case 'RESCAN_PAGE':`) re-runs the pipeline with mitigation dispatched. This is the mitigated comparison.
- The popup presents the verdict, the per-chunk routing breakdown (#144 accordion render at `src/popup/popup.html:428` / `src/popup/hunter-findings.ts:25`), and the rescan button.

**Measurement:**

- Behavioural delta in the LLM-consumer between unmitigated and mitigated reads. This is the user-facing efficacy claim: "with HoneyLLM mitigation on, the consumer's downstream LLM does X% less of the prompted bad behaviour".
- The delta is measured per attack-class × per consumer-surface. Consumer surfaces are listed in `docs/ARCHITECTURE.md` §"Defended-vs-Not-Defended Coverage"; only the in-page surface is currently shipped, so Layer 4 measurements are confined to that surface until #124 / #125 / #133 ship.
- Layer 4 is the only methodology layer that produces a "mitigation efficacy" headline number. Layers 1–3 only produce detection numbers.

### Layer 5 — Page-stamp validation

**Inputs:** any LLM-consumer that can be asked to echo back a marker visible in the page.

**Mechanism:**

- Page-stamp signing per install secret with HMAC-SHA256 (cf. `docs/ARCHITECTURE.md` §"Trust Boundaries").
- Embed: `embedStamp` at `src/content/signaling/page-stamp-embed.ts:99`. Observers: `installStampObservers` at `src/content/signaling/page-stamp-embed.ts:110`.
- Verification: `verifyStamp` at `src/service-worker/stamp.ts:158`, dispatched from `VERIFY_STAMP` handler at `src/service-worker/index.ts:108`.
- The consumer is asked to include the page stamp in its summary or tool-call payload. The service worker verifies the stamp's HMAC.

**Why this matters:** before the stamp existed, "did the consumer actually read the mitigated page" was inferred from URL slugs and page-summary content — both hallucinable. The stamp turns this into a binary cryptographic check. A consumer that returns a valid stamp demonstrably read the mitigated page; a consumer that returns the wrong stamp, no stamp, or a slug-summarised hallucination is filtered out of the Layer 4 efficacy numbers.

**Measurement:**

- Stamp-verification rate per consumer-surface × per attack-class. Failures are bucketed: missing-stamp (consumer cannot fetch / hallucinates from URL), wrong-stamp (consumer fetched a different version of the page), invalid-stamp (consumer or attacker forged a stamp).
- Layer 4 efficacy numbers are computed only over rows where Layer 5 returned a valid stamp. Any other row is "not actually a measurement of the mitigated page".

---

## IndoorLife.store track — disposition

**History:**

- Astro-based synthetic e-commerce fixture site, hosted at `indoorlife.store` (Cloudflare Pages).
- Phase A: clean build, byte-identical product pages, no injections. Landed and verified.
- Phase B: synthetic-injection embedding across product descriptions, alt-text, hidden divs, and order-confirmation flows. Partially started; hit Claude Code safety guardrails repeatedly when generating Phase B payloads.

**Decision:** pause Phase B injection embedding indefinitely. Keep the Phase A clean build for honeypot-hosting use cases if ad-hoc fixture hosting becomes useful again.

**Rationale:**

- Layer 1 (real-world e-commerce) covers the cells Phase B was meant to fill — Amazon product pages, indie Shopify stores, eBay listings — without contamination.
- Layer 2 (`test-pages/` curated honeypots) covers the deterministic Hunter-regression cells.
- Phase B's URL-slug contamination problem is unsolvable on a synthetic site: the URLs need to be human-readable to be useful as fixtures, and human-readable fixture URLs leak the technique to the LLM. The same problem the broader fixture-corpus track has, scoped to a single site.
- The agent-session cost of negotiating Claude Code safety guardrails for synthetic injection generation is not amortised by enough additional signal to be worth resuming.

**Status:** not on critical path. No further work scheduled. Phase A artifacts retained.

---

## Phase 3 Track B (#2) reframe

#2's original resumption plan (B5 manual production-LLM leg + B7 regression-report deliverable) is superseded by this methodology. The B7 *deliverable* is preserved as the closing artifact, but generated via the new methodology rather than the original synthetic-fixture sweep.

**New resumption path:**

- Replace synthetic fixtures with real-world (Layer 1) + curated honeypots (Layer 2).
- Replace slug-based detection inference with page-stamp validation (Layer 5).
- Replace direct-API B5 sweep with testing-mode A/B (Layer 4) executed in-browser.
- Stage B7 deliverable (final efficacy verdict) is generated against Layer 4 numbers filtered through Layer 5 stamp-validation.

**Stale blockers in the original #2 body** (already resolved or no longer relevant):

- Cloudflare tunnel for fixture hosting — provisioned (long-standing per project memory).
- ~$20 AUD budget for B5 testing — allocated.
- Phase 4 Stage 4A (probe-error propagation) — shipped at `5721fbf`.
- Phase 4 Stage 4B (chunk concurrency fix) — shipped at `1c6ce78` + `3b2feea`.
- #13 schema-strict classifier — shipped at `b2aae63` (closed 2026-04-18).
- #10 Gemma context-window overflow — shipped at `bd72857` (closed 2026-04-18).

#2 stays open as the Phase 3 Track B umbrella; resumption executes against this methodology, not the original B5/B7 stage plan.

---

## Phase 2 byte-locked baseline preservation

`docs/testing/inbrowser-results.json` is the canonical Phase 2 baseline. Per the `CLAUDE.md` invariant ("Phase 2 canonical file is locked"), it is byte-locked and not to be modified without a deliberate "re-baseline" decision. The classifier-v1 byte-identity test at `phase2-inputs.test.ts:57` enforces this.

Phase 5 methodology never produces inputs to or outputs from this file. Migration scripts for the Phase 3 affected-baseline (`scripts/restamp-affected-v2.ts` and similar) operate on `inbrowser-results-affected.json` and `inbrowser-results-affected-replicates.json` — the affected sidecars — not the canonical file.

---

## Phase 5 feature anchors

For implementers reading this doc and looking for the canonical entry points referenced above:

| Feature | Issue / PR | Anchor |
|---|---|---|
| Hunters runner | [#3](https://github.com/JimmyCapps/zentropy/issues/3) | `src/hunters/hunt-runner.ts:55` (`runHunters`) |
| Tier-router | [#112](https://github.com/JimmyCapps/zentropy/issues/112) / PR [#143](https://github.com/JimmyCapps/zentropy/pull/143) | `src/service-worker/tier-router.ts:22` (`routeChunk`) |
| Orchestrator wiring | [#3](https://github.com/JimmyCapps/zentropy/issues/3) | `src/service-worker/orchestrator.ts:248` |
| Page-level early-exit | [#145](https://github.com/JimmyCapps/zentropy/issues/145) / PR [#149](https://github.com/JimmyCapps/zentropy/pull/149) | `src/service-worker/orchestrator.ts:226` (`earlyExited`) |
| Testing-mode flag (Layer 4) | [#113](https://github.com/JimmyCapps/zentropy/issues/113) / PR [#140](https://github.com/JimmyCapps/zentropy/pull/140) | `src/shared/testing-mode.ts:16,27` |
| RESCAN_PAGE handler (Layer 4) | [#114](https://github.com/JimmyCapps/zentropy/issues/114) / PR [#141](https://github.com/JimmyCapps/zentropy/pull/141) | `src/service-worker/index.ts:103` |
| Page-stamp embed (Layer 5) | [#117](https://github.com/JimmyCapps/zentropy/issues/117) / PR [#139](https://github.com/JimmyCapps/zentropy/pull/139) | `src/content/signaling/page-stamp-embed.ts:99` |
| Page-stamp verify (Layer 5) | [#117](https://github.com/JimmyCapps/zentropy/issues/117) | `src/service-worker/stamp.ts:158` (`verifyStamp`) |
| VERIFY_STAMP handler | [#117](https://github.com/JimmyCapps/zentropy/issues/117) | `src/service-worker/index.ts:108` |
| Evidence-packet probe | [#118](https://github.com/JimmyCapps/zentropy/issues/118) / PR [#148](https://github.com/JimmyCapps/zentropy/pull/148) | `src/probes/evidence-review.ts:34` |
| Popup Hunter findings (verification UI) | [#144](https://github.com/JimmyCapps/zentropy/issues/144) / PR [#146](https://github.com/JimmyCapps/zentropy/pull/146) | `src/popup/hunter-findings.ts:25` |
| Chunker | [#115](https://github.com/JimmyCapps/zentropy/issues/115) / PR [#136](https://github.com/JimmyCapps/zentropy/pull/136) | `src/hunters/hawk/chunking.ts:103` (`chunkText`) |
| Language router (Layer 1 sampling) | [#119](https://github.com/JimmyCapps/zentropy/issues/119) / PR [#150](https://github.com/JimmyCapps/zentropy/pull/150) | `src/hunters/hawk/language-router.ts:33` (`detectLanguage`) |
| `TierDecision` union | — | `src/types/verdict.ts:28` |
| `SecurityVerdict.perChunkAnalysis` | [#112](https://github.com/JimmyCapps/zentropy/issues/112) | `src/types/verdict.ts:94` |

---

## Cross-references

- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) §"Layered Detection (Hunters → Probes)" — execution-context map for the tier-router and probe pipeline.
- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) §"Detection vs Mitigation" — testing-mode semantics that Layer 4 depends on.
- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) §"Trust Boundaries" — page-stamp HMAC trust model that Layer 5 depends on.
- [`docs/testing/MODEL_BEHAVIORAL_TEST_REPORT.md`](../MODEL_BEHAVIORAL_TEST_REPORT.md) — provider-side direct-API baseline. Different scope; this methodology does not subsume it.
- [`docs/testing/phase3/AFFECTED_BASELINE_REPORT.md`](../phase3/AFFECTED_BASELINE_REPORT.md) — historical Phase 3 Track A record. Frozen.
- [`docs/testing/phase3/STAGE_B5_RESULTS.md`](../phase3/STAGE_B5_RESULTS.md) — historical Phase 3 Track B scripted-simulation output. Frozen; superseded by Layer 4 + Layer 5 in this document.
- [`docs/testing/phase4/FIXTURE_HOSTING_VERIFIED.md`](../phase4/FIXTURE_HOSTING_VERIFIED.md) — historical fixture-host verification. Hosting infrastructure remains usable for Layer 2 honeypot delivery if needed.
- [`docs/testing/phase5/PEDAGOGICAL_BASELINE.md`](./PEDAGOGICAL_BASELINE.md) — Layer 3 baseline numbers. Created by [#120](https://github.com/JimmyCapps/zentropy/issues/120) (N15); forward link, not yet shipped at time of writing.
- [`README.md`](../../../README.md) §Status — short pointer to this methodology document.
