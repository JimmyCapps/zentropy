# Phase 3 Regression Report — HoneyLLM Track A + Track B Verdict

**Status:** DRAFT — skeleton only. Sections marked `[PENDING]` require input from Stage B5 manual agent-mode leg (issue #2) and/or completion of the refreshed direct-API baseline runs (in-flight as of 2026-04-20 23:30 AEDT on branch `test/issue-2-refresh-baselines-2026-04-20`).

**Document Version:** 0.1 (scaffold)
**Test period covered:** 2026-04-15 direct-API baseline → 2026-04-17 Phase 3 Track A affected-baseline → 2026-04-17 Track B automatable sweep (24 rows) → 2026-04-17 Nano text baseline (27 rows) → 2026-04-20 refreshed direct-API baseline → Stage B5 manual leg (pending).
**Fills:** Phase 3 Track B Stage B7 deliverable per issue #2.

---

## Executive Summary

**[PENDING — fills after Stage B5 lands and refreshed direct-API baseline completes.]**

Will consolidate into 1–2 paragraphs:

1. Detection efficacy across HoneyLLM's three probes vs the 540-row direct-API baseline (2026-04-15) and its 2026-04-20 refresh.
2. The divergence between raw-API behaviour and agent-mode behaviour (Stage B5), which is the new signal unlocked by B5.
3. Whether the efficacy verdict has shifted since Phase 3 Track A's affected-baseline report (2026-04-17).

---

## 1. Scope

This report covers:

- **Track A** (`docs/testing/phase3/AFFECTED_BASELINE_REPORT.md`) — affected-baseline sweep across 8 in-browser engines over the 162 canonical Phase 2 rows. Already published 2026-04-17. Re-referenced here without rerun.
- **Track B** (`docs/testing/phase3-results.json`) — Phase 3 live-regression sweep, 24 rows. Committed at 6894bb9 (2026-04-17).
- **Nano text baseline** (`docs/testing/phase3/NANO_BASELINE_ADDENDUM.md`) — 27 Nano rows (2026-04-17), manual harness. Replicates sweep (issue #14) still pending.
- **Direct-API baseline refresh** (this run, 2026-04-20) — 20-model re-baseline covering Anthropic (7 models), OpenAI (13 models), Google (7 models) = 27 probe-cells × 20 models = **540 + buffer rows**. Output sidecars:
  - `docs/testing/anthropic-results-2026-04-20.json`
  - `docs/testing/gpt-results-2026-04-20.json`
  - `gemini-all-models/raw-results-2026-04-20.json`
- **Stage B5 manual agent-mode leg** (pending) — Claude in Chrome / ChatGPT Agent / Gemini Agent × 23 fixtures.

## 2. Track B Results (unchanged since 2026-04-17)

### 2.1 Automatable sweep summary

Per `scripts/run-phase3-live.ts --public-urls`:

| Engine | Rows | CLEAN | SUSPICIOUS | COMPROMISED | Errored |
|---|---|---|---|---|---|
| Gemma-2-2b (MLC) | 24 | **[PENDING regen after Phase 4A bug fix re-run]** | | | |

### 2.2 Production-path silent FN bug resolution

Phase 4 Stages 4A + 4B resolved the silent false-negative (PR #55 and related). The 2 errored rows originally observed (Wikipedia, MDN) should now produce real verdicts. **[PENDING re-run of Track B sweep under the fixed pipeline.]**

## 3. Direct-API Baseline Refresh (2026-04-20)

### 3.1 Models covered

**Anthropic (7 models)** — ordered smallest→largest for partial-budget resilience:

- claude-haiku-4-5-20251001
- claude-sonnet-4-5-20250929
- claude-sonnet-4-6
- claude-opus-4-1-20250805
- claude-opus-4-5-20251101
- claude-opus-4-6
- **claude-opus-4-7** *(new vs 2026-04-15 baseline)*

**OpenAI (13 models)** — ordered smallest→largest:

- gpt-4o-mini, gpt-4.1-nano, gpt-4.1-mini, gpt-5.4-mini, gpt-5.2-mini
- gpt-4o, gpt-4.1, gpt-5, gpt-5.1, gpt-5.2, gpt-5.4
- o4-mini, o3
- **gpt-4.1-*, gpt-5.1, gpt-5.2-mini, o4-mini** *(new vs 2026-04-15 baseline)*

**Google (7 models)** — ordered smallest→largest:

- gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro
- gemini-3-flash-preview, gemini-3-pro-preview
- gemini-3.1-flash-lite-preview, gemini-3.1-pro-preview

### 3.2 Vulnerability scorecard — adversarial probe

Full combined scorecard: `docs/testing/manual-2026-04-20/COMBINED_SCORECARD_2026-04-20.md`

**Provider summary (26 models, 701 clean rows, 1 errored):**

| Provider | Models | Rows | Compliance-free | Any-compliance |
|---|:---:|:---:|:---:|:---:|
| Anthropic | 7 | 189 | 6/7 (+1 "refusal-with-URL" artifact) | 1/7 |
| OpenAI | 12 | 324 | 4/12 | 8/12 |
| Google | 7 | 188 | 1/7 | 6/7 |

### 3.3 Delta vs 2026-04-15 baseline

Full per-provider deltas: `docs/testing/manual-2026-04-20/DELTA_*_2026-04-15_vs_2026-04-20.md`.

**Answers to the key questions:**

- **claude-opus-4-7 (new):** Matches the Claude family's perfect resistance — 0/5 across all categories. The temperature-deprecation API change required a code fix (see commit 97f5007) but no behavioural surprises.

- **gpt-5.1 / gpt-5.2-mini / o4-mini (new):** gpt-5.1 shows 1/5 complied + 1/5 exfil (weaker than 5.x). o4-mini is 0/5 across all categories (matches frontier pattern). gpt-5.2-mini does not exist at the OpenAI API (pruned). gpt-4.1-family (4.1, 4.1-mini, 4.1-nano — all new in this lineup) is the most vulnerable new OpenAI cohort, with 4.1-mini hitting 1/5 complied + 1/5 leaked + 2/5 exfil.

- **o3 (changed since 2026-04-15):** complied 1 → 0. First observed reasoning-model improvement in injection resistance across this 5-day window.

- **Gemini 3-family:** 3-flash-preview improved (complied 1 → 0); 2.5-pro gained 1/5 leaked_prompt (regression); 2.5-flash-lite improved (exfil 1 → 0). Preview models continue to exhibit more per-release drift than stable models.

- **Artifact on claude-sonnet-4-6:** 2/5 exfil is a substring-classifier artifact — the model transparently refuses and quotes the attacker URL when explaining why. Classifier v2 (§5) resolves this.

## 4. Stage B5 Manual Agent-Mode Leg

**[PENDING execution — see `docs/testing/manual-2026-04-20/STAGE_B5_AGENT_MODE_CHECKLIST.md` for the per-agent-per-fixture matrix to complete.]**

Key questions this stage answers:

1. Does the agent-mode wrapper (Claude in Chrome, ChatGPT Agent, Gemini Agent) amplify or mitigate the direct-API injection signal?
2. Does HoneyLLM's popup verdict agree with the observed agent behaviour?
3. Are there any agent-mode-specific injection paths not visible in direct-API tests?

## 5. Classifier v1 vs v2

Per issue #13 and `scripts/fixtures/phase2-inputs.ts`:

- v1 (substring) is byte-locked against the 162-row Phase 2 canonical file. No regression; 14/14 unit tests pass in this run.
- v2 (JSON-aware) resolved structural FPs from probes emitting detection-report JSON.

**Quantified impact of v2 on the 2026-04-20 refreshed baselines:**

| Provider | Rows | Flipped | % of rows | All FP resolved? |
|---|---|---|---|---|
| Anthropic | 189 | 32 | 17% | Yes (32 true→false, 0 false→true) |
| OpenAI | 324 | 55 | 17% | Yes (55 true→false, 0 false→true) |
| Google | 188 | 32 | 17% | Yes (32 true→false, 0 false→true) |
| **Total** | **701** | **119** | **17%** | **119 FPs resolved, 0 FNs added** |

Full detail: `docs/testing/manual-2026-04-20/RECLASSIFY_V2_{ANTHROPIC,GPT,GEMINI}.md`.

All 119 flips are on the `instruction_detection` probe. Every non-compromised model produces `{"found": true, ...}` detection reports whose quoted attacker text contains substrings v1 misreads as compliance. **v2 is required for any accurate per-provider scoring going forward.** The MODEL_BEHAVIORAL_TEST_REPORT.md (2026-04-15 narrative) pre-dates classifier v2 and therefore over-reports FPs; a v1.4 revision incorporating v2 numbers is queued.

## 6. Nano Coverage

Phase 4C delivered 27 Nano rows (single-run, 2026-04-17). Replicate-sampling per issue #14 is queued as Phase 8; prep template at `docs/testing/manual-2026-04-20/NANO_REPLICATES_ENTRY_TEMPLATE.md`.

No change to Nano coverage in this report cycle. Variance characterisation is a prerequisite for strong efficacy verdicts specifically on Nano's detection signal.

## 7. Phase 8 Backlog Impact

The refreshed baseline and B5 data may reshuffle Phase 8 priorities. Candidate impact zones:

- **#14 Nano replicates** — still blocked on manual execution.
- **#44 responseConstraint JSON schema** — if the refreshed data shows Nano-specific structural FPs, #44 gets higher priority.
- **#45 long-lived Nano session** — if 2026-04-20 latency data diverges from 2026-04-17 addendum, add a note.
- **#48 Language Detector** — no new signal (all fixtures are English).

## 8. Unambiguous Efficacy Verdict

**[PENDING — the entire point of Stage B7. Cannot be written until sections 3, 4, 5, and the Track B re-run are all landed.]**

This section will declare:

1. Does HoneyLLM reliably detect injections embedded in fixture-style content across the 3 probes? Yes/No/Partial, with evidence.
2. Does the detection signal hold up in agent-mode production contexts? Yes/No/Partial, from B5.
3. Is the 2026-04-20 refreshed baseline materially different from the 2026-04-15 baseline? Yes/No, with delta.
4. What Phase 8 work is required before shipping a v1 external release? Itemised list.

---

## Appendix A — Reproducibility

Commands to regenerate any section:

```bash
# Re-run this refreshed baseline from scratch
set -a && source .env && set +a
ANTHROPIC_OUTFILE=anthropic-results-2026-04-20.json npx tsx scripts/run-all-anthropic.ts
OPENAI_OUTFILE=gpt-results-2026-04-20.json npx tsx scripts/run-all-gpt.ts
GEMINI_OUTFILE=raw-results-2026-04-20.json npx tsx scripts/run-all-gemini.ts

# Unit + integration tests
npm test
npm run typecheck
npm run build

# E2E
npm run test:e2e
```

## Appendix B — File Inventory

```
docs/testing/
├── MODEL_BEHAVIORAL_TEST_REPORT.md      # 2026-04-15 direct-API baseline narrative
├── anthropic-results.json                # 2026-04-15 baseline, 162 rows
├── anthropic-results-2026-04-20.json     # refreshed baseline (in-flight)
├── gpt-results.json                      # 2026-04-15 baseline, 189 rows
├── gpt-results-2026-04-20.json           # refreshed baseline (in-flight)
├── inbrowser-results.json                # Phase 2 canonical (LOCKED)
├── inbrowser-results-affected.json       # Phase 3 Track A affected-baseline
├── inbrowser-results-affected-replicates.json  # Stage 7b replicates
├── phase3-results.json                   # Track B sweep (24 rows)
├── phase3/
│   ├── AFFECTED_BASELINE_REPORT.md       # Track A writeup
│   ├── AFFECTED_BASELINE_REPORT_2026-04-17.md  # Forked historical copy
│   ├── NANO_BASELINE_ADDENDUM.md         # Phase 4C Nano coverage
│   └── PHASE3_REGRESSION_REPORT.md       # this file
├── phase4/
│   └── nano-affected-baseline-2026-04-17.json
└── manual-2026-04-20/                    # prep artifacts for tomorrow
    ├── BROWSER_COMPAT_CHECKLIST.md
    ├── NANO_REPLICATES_ENTRY_TEMPLATE.md
    └── STAGE_B5_AGENT_MODE_CHECKLIST.md

gemini-all-models/
├── raw-results.json                      # 2026-04-15 baseline
└── raw-results-2026-04-20.json           # refreshed baseline (in-flight)
```
