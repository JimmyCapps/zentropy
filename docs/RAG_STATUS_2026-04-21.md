# HoneyLLM Release Readiness — RAG Status (2026-04-21)

> **Preserved verbatim** from the 2026-04-21 session response. This is a
> point-in-time snapshot; see `docs/ROADMAP.md` for the living roadmap that
> evolves from this baseline.

**Scope:** HoneyLLM-only (DetermiLLM issues #66–79 are a separate research project, excluded from release %).

**Issue inventory (HoneyLLM):** 37 closed, 24 open = 61 total. DetermiLLM: 14 open (excluded).

---

### 🟢 GREEN — Closed or Done (25)

| # | Title | Note |
|---|---|---|
| 10 | Gemma 4096-token context overflow | Closed (Phase 8 backlog — workaround via chunking) |
| 11 | Repeated PAGE_SNAPSHOT on Wikipedia | Fixed in PR #55 |
| 12 | Gmail keepalive triggers analysis | Investigated, closed |
| 13 | instruction_detection classifier v2 | **Validated this session — 119 FPs resolved** |
| 20 | Per-origin deny-list UX | Fixed in PR #40 |
| 21 | Phase 4 completion tracker | Closed |
| 22 | Toolbar icon contrast | Fixed |
| 23 | SW console log ordering | Closed |
| 24 | 'Already analyzed' notice during live scan | Closed |
| 26, 28, 30, 31, 32, 33, 34, 61 | Docs/workflow cleanup | All merged |
| 41, 46, 47, 49, 50, 59 | Phase 4 Nano fixes | All merged |
| 43 | Phase 4 research tracker | Closed |
| 52 | Dialect detection research | Closed (gates 0–7 shipped) |

---

### 🟡 AMBER — In flight / partial (11)

| # | Title | RAG rationale |
|---|---|---|
| **2** | **Phase 3 Track B Stages B5–B7** | **🟡** — Direct-API baselines refreshed, scripted B5 done, B7 report 80% populated, **only real-wrapper B5 leg pending** (your action) |
| **3** | **Phase 5 Three Hunters (Spider+Wolf+Canary)** | **🟡** — Spider 5A shipped (PR #80), Wolf + Canary coordination not started |
| **8** | Stage 4E Chromium compat audit | 🟡 — **informational-only**, not a ship blocker; your manual action required |
| **9** | Stage 4G image-injection probe | 🟡 — design complete, implementation not started |
| **14** | Nano replicate-sampling | 🟡 — **harness patched this session**, awaiting your ~10min click-through |
| **44** | Nano responseConstraint JSON schema | 🟡 — design clear, ~30 LOC patch not yet done |
| **45** | Nano long-lived session via clone() | 🟡 — significant perf improvement, design clear, not implemented |
| **48** | Language Detector API (non-English graceful skip) | 🟡 — directly relevant given the dialect fixtures added this session; blocks dialect harness activation |
| **51** | Server-side site-structure registry | 🟡 — Phase 8 research, not a ship blocker |
| **60** | Nano AbortSignal in-chunk abort | 🟡 — between-chunk abort works; in-chunk is follow-up |
| **75** | Per-coding-language dialect packs | 🟡 — research project, #52 derivative |

---

### 🔴 RED — Known unresolved (0 actual blockers for v1)

**Zero red issues** in the strict "ship blocker" sense. Everything open is either:
- A known Phase 8 backlog item (deliberately deferred)
- A research direction (DetermiLLM, dialect packs)
- An informational audit (browser compat)
- An enhancement (AbortSignal, long-lived session)

The closest-to-red is the **"refusal-with-quoted-URL" classifier artifact** discovered this session on Sonnet 4.6 and Opus 4.7 — filed as **#83** (classifier v3).

Also filed: **#84** (gemini-3.1-pro-preview agent-mode API timeouts on large HTML prompts).

---

## % to Release Estimate

I'll define "release" three ways because the answer depends on which release:

### 🚀 **v0.1 minimum viable (already ready)** — **~95%**

**What works today:**
- Extension loads, content script runs, 3 probes execute, verdict populates window globals + `<meta>` tag
- 362 unit tests green, full 29 E2E tests green, Phase 2 byte-lock invariant holds
- MLC WebLLM canary on WebGPU + Chrome built-in Nano canary both work
- Detection on 8 of ~24 technique categories at 100% accuracy
- Classifier v2 resolves structural FPs
- Offscreen lazy-load + service-worker orchestration stable

**What's needed for v0.1:**
- 5% gap: the "refusal-with-quoted-URL" artifact (#83) overstates exfil flag rate on frontier Claude models. Cosmetic, not a functional break.

### 📦 **v1.0 production-quality** — **~70%**

**Additional work needed for v1.0:**
- Phase 5 full Three-Hunters coordination (#3) — Spider shipped, Wolf + Canary coordination ~2 weeks
- Classifier v3 (#83) — ~1 week
- Language Detector graceful skip (#48) — ~3 hours (low effort, unlocks dialect fixtures)
- Nano responseConstraint + long-lived session (#44, #45) — ~2 days combined, significant perf
- Image-injection probe (#9) — ~1-2 weeks
- AbortSignal in-chunk (#60) — ~2 days
- Real-wrapper B5 manual leg (your action, ~2hr)
- Nano replicate sampling (your action, ~1hr)
- Browser compat audit (#8, informational, your action, ~1hr)

**Estimate:** ~3-5 weeks engineering + ~5hr your manual testing = v1.0 ready.

### 🌐 **v2.0 broad-scope (multilingual + coding packs + agentic)** — **~35%**

**Additional work for v2.0:**
- Per-language dialect packs activated (#48 prerequisite, #75 for coding languages) — ~4-6 weeks
- Local LLM chat interface (#4) — ~4 weeks
- Scheduled/agentic tasks with security constraints (#5) — ~6-8 weeks
- BYOK premium model integration (#19) — ~3 weeks
- Phase 8 polish: tokeniser-aware chunking (#25), delta-cache + turboquant (#6), engine-health probe (#17), chunk concurrency revisit (#18) — ~3-4 weeks combined

**Estimate:** ~4-5 months to v2.0.

---

## Summary table

| Release | Scope | % Ready | Gap |
|---|---|---|---|
| **v0.1 MVP** | Current feature set, acceptable FP rate | **95%** | Classifier v3 for Sonnet 4.6 refusal-URL artifact (#83) |
| **v1.0 Production** | Three Hunters, image probe, Nano perf, multilingual graceful, polished | **70%** | ~3-5 weeks eng + ~5hr your manual |
| **v2.0 Broad** | Dialect packs active, local chat, agentic tasks, BYOK, Phase 8 polish | **35%** | ~4-5 months total |

## Honest assessment

**v0.1 is essentially ready to ship** — one classifier tweak from complete. The "702 rows clean, 0 errored" data + 362 unit tests + 29 E2E tests + `FIXTURE_HOSTING_VERIFIED` all say the product works.

**v1.0 is the realistic release target** — needs Phase 5 Wolf/Canary coordination (the key differentiator of HoneyLLM's Three-Hunters pitch), classifier v3, and your ~5hr manual testing leg (B5 real-wrapper + Nano replicates + browser compat).

**The session's work moved us from "baseline 5 days stale, 0% B7 populated" to "baseline fresh, B7 scaffolded with real data, E2E green, B5 scripted lower-bound complete."** That's meaningful progress toward v1.0.
