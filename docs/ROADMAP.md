# HoneyLLM Roadmap

**Baseline:** `docs/RAG_STATUS_2026-04-21.md` (preserved verbatim).
**Scope:** HoneyLLM only. DetermiLLM (#66–79) is a sibling project tracked separately.
**Living document:** update when issues close, estimates change, or new blockers surface.

## Release plan at a glance

| Release | Target | Current % | Critical path |
|---|---|---|---|
| **v0.1 MVP** | Ship the current product with one classifier tweak | **95%** | #83 classifier v3 |
| **v1.0 Production** | Three Hunters + image probe + Nano perf + multilingual graceful | **70%** | #3 Phase 5, #9 image probe, #83, #48 |
| **v2.0 Broad** | Dialect packs active, local chat, agentic tasks, BYOK | **35%** | #4, #5, #19, #48+#75, Phase 8 polish |

---

## v0.1 MVP — 95% ready

**Definition:** current feature surface, ship-quality false-positive rate, no new product work.

**Release gate:**
- [ ] Merge PR #82 (2026-04-20 baseline refresh + B7 scaffolding + E2E fixes + Nano harness replicates + dialect fixtures separated + audit retries)
- [ ] Close issue #83 (classifier v3 — distinguish URL-in-refusal from URL-in-compliance)
- [ ] Cut tag `v0.1.0` and publish release notes citing `docs/RAG_STATUS_2026-04-21.md`

**Estimated ship window:** 1–2 weeks from 2026-04-21, limited by classifier v3 scope (50–150 LOC + tests).

**Intentionally NOT in v0.1:**
- Phase 5 Wolf / Canary coordination (shipped in v1.0)
- Image-injection probe (v1.0)
- Real-wrapper B5 sweep (v1.0 validation, not a code blocker)
- Nano replicate-sampling (v1.0 validation)
- Browser compat audit (informational, not a blocker at any version)

---

## v1.0 Production — 70% ready

**Definition:** every open `phase-4` / `phase-5` issue resolved; manual-testing legs complete; multilingual pages don't silently misfire.

**Engineering work** (~3–5 weeks sequential):

| # | Title | Effort | Order |
|---|---|---|---|
| 83 | Classifier v3 — refusal-with-quoted-URL | ~1 week | 1 (blocks v0.1 too) |
| 48 | Language Detector graceful skip | ~3 hours | 2 (low-cost; unlocks dialect harness) |
| 3 | Phase 5 Wolf + Canary coordination (Spider ✅ shipped) | ~2 weeks | 3 (biggest differentiator) |
| 44 | Nano responseConstraint JSON schema | ~1 day | 4 (perf + FP reduction) |
| 45 | Nano long-lived session via `clone()` | ~1 day | 4 (perf; pair with #44) |
| 60 | Nano AbortSignal in-chunk | ~2 days | 5 |
| 9 | Stage 4G image-injection probe | ~1–2 weeks | 6 (largest, capability-gated) |

**Manual validation** (user-driven, ~5 hours total):

| # | Title | Effort | Prerequisites |
|---|---|---|---|
| 2 | Stage B5 real-wrapper leg | ~2 hours | fixtures.host-things.online up; Claude-in-Chrome / ChatGPT Agent / Gemini Agent accounts |
| 14 | Nano replicate-sampling | ~1 hour | EPP-enrolled Chrome profile; harness already patched this session |
| 8 | Chromium-family browser compat audit | ~1 hour | 5 browsers installed (Edge, Brave, Opera, Vivaldi, Arc) |

**Release gate for v1.0:**
- [ ] All engineering issues above closed
- [ ] Manual validation legs complete with results committed to `docs/testing/`
- [ ] Stage B7 regression report (`docs/testing/phase3/PHASE3_REGRESSION_REPORT.md`) §4 + §8 populated from real-wrapper data
- [ ] MODEL_BEHAVIORAL_TEST_REPORT.md v1.4 revision incorporating classifier v2 + v3 numbers
- [ ] Tag `v1.0.0`

---

## v2.0 Broad — 35% ready

**Definition:** multilingual detection active, user-facing assistant features, agentic safety, Phase 8 polish.

**Major themes** (~4–5 months combined):

| Theme | Issues | Estimate |
|---|---|---|
| **Multilingual activation** | #48 graceful skip → #75 per-coding-language packs | 4–6 weeks |
| **Local LLM chat interface** | #4 | ~4 weeks |
| **Scheduled / agentic tasks** | #5 | 6–8 weeks |
| **BYOK premium model integration** | #19 | ~3 weeks |
| **Phase 8 polish bundle** | #6 delta-cache + turboquant, #17 engine-health probe, #18 chunk concurrency, #25 tokeniser chunking | 3–4 weeks combined |
| **DetermiLLM integration surface** | tracked separately in project-determillm | N/A to HoneyLLM v2.0 directly |

**Release gate for v2.0:** defer definition until v1.0 ships and the product-market fit for multilingual + agentic features is clearer.

---

## Cross-cutting workstreams (parallelisable)

### Documentation & audit trail

- **Every phase writeup** in `docs/testing/phase*/` kept byte-locked for audit trail (#32 forward-pointer convention)
- **CLAUDE.md** kept drift-free (#61 pattern — remove per-phase state, keep pointer map only)
- **README Status section** updated to point at release tags instead of commits once v0.1 ships

### Upstream dependencies

- **#16** — file MLC web-llm issue about concurrent initEngine race. Not a HoneyLLM ship blocker, but improves Phase 8 engine-health (#17) reliability once fixed.

### Research (does NOT gate v1.0)

- **#51** — server-side site-structure registry (compare-first, analyse-on-diff). Phase 8 research.
- **#15** — optional mini-sweep of 3 un-re-sampled Stage 6 deltas. Phase 8.
- **DetermiLLM #66–79** — separate project. Tracks against its own `project-determillm` label.

---

## Decision log

### 2026-04-21 — Baseline refresh + B5 scripted lower-bound

PR #82 delivered the 2026-04-20 direct-API baseline refresh (26 models, 702 rows, 0 errored after audit retries), Stage B5 scripted simulation, classifier v2 FP-reduction validation (119 flips resolved), E2E fixes (29/29 green), Nano harness replicate support, and dialect fixture generation (kept in separate manifest).

**Key findings that reshape the roadmap:**
- **All 3 flagship agents (Opus 4.7, GPT-5.4, Gemini 3-flash-preview) comply on basic hidden-div injection** when system prompt relaxes from defensive to agent-mode. This validates HoneyLLM's in-browser-canary positioning: external signal is required because downstream consumers don't ship defensive prompts.
- **Classifier v2 is mandatory** for accurate scoring on modern LLMs (17% of rows flip on instruction_detection probe across all 3 providers). v3 (#83) is the next mandatory upgrade because v2 doesn't resolve the adversarial-probe URL-in-refusal pattern.
- **Nano harness already supports replicates** — user just needs to click through (#14 now a 1-hour manual task, not an engineering task).

### 2026-04-18 — CLAUDE.md drift purge (#61)

Removed per-phase state from CLAUDE.md; agents now consult GitHub issues + README Status for live phase state. Prevents doc rot during rapid phase iteration.

### 2026-04-17 — Phase 4 completion tracker closed (#21)

Phase 4 Stages 4A–4D complete; 4E (browser compat) and 4G (image probe) split into standalone issues (#8, #9) as informational/v1.0 scope respectively.

### 2026-04-15 — Original direct-API baseline

Anthropic 6 models, OpenAI 7 models, Google 7 models, 540 rows, 0 errored. Superseded by the 2026-04-20 refresh.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Phase 5 Wolf+Canary coordination is harder than estimated | Pushes v1.0 by weeks | Start early; Spider pattern shipped means Wolf/Canary work has concrete integration target |
| Classifier v3 design (#83) doesn't generalise | Stuck overstating exfil on frontier Claude models | Start with option A (refusal-prefix heuristic); fall back to option C (structured probe output) if A fails |
| Gemini API drift on thinking-mode models | Baseline re-runs become unreliable | 300s timeout + flash-preview fallback already in place; #84 filed |
| Chrome Nano API changes between Stable versions | Nano canary regresses | `chrome://on-device-internals/` as canonical debug surface; #43 tracker methodology |
| Real-wrapper B5 reveals much worse behaviour than scripted | v1.0 efficacy claims weakened | Scripted is explicit lower-bound; real-wrapper data will sharpen, not reverse, findings |

---

## How to use this document

1. **Before planning work:** check v1.0 engineering list; pick the next highest-priority issue.
2. **Before claiming an issue done:** update the RAG tag in `docs/RAG_STATUS_*.md` (clone + date-stamp a new one; don't mutate the historical snapshot).
3. **After any shipped PR:** update v0.1/v1.0/v2.0 percentages in the summary table if the work changed the release surface.
4. **When adding to scope:** add a row to the relevant release section + a line to the decision log.
5. **Quarterly:** write a fresh `docs/RAG_STATUS_<date>.md` and update this roadmap's baseline pointer.
