# Gate C — two-stage pre-filter spike

Refs #52 Gate C (Task C of the revised cowork plan). Artefacts produced here:

- `gate-c-prefilter.py` — two-stage pipeline runner (precompute, corpus build, evaluate).
- `gate-c-protectai-cache.json` — ProtectAI P(INJECTION) cached per source-row id across all three languages (benign + injection + pedagogical pools).
- `gate-c-mixed-corpus-en.jsonl`, `gate-c-mixed-corpus-es.jsonl`, `gate-c-mixed-corpus-zh-CN.jsonl` — 1%-base-rate mixed corpora, one file per language (0.1%-rate corpora are exercised in-memory only; emitting them to disk would have been three >100 MB JSONLs for marginal audit value).
- `gate-c-results.json` — full metrics matrix (3 languages × 2 base rates × 3 k_reject values = 18 cells) plus the English pedagogical subanalysis.

Does not modify any gate-1-* or gate-2-* file, per the Task C hard rules.

## Headline verdict

**PASS (partial).** The dialect regex pre-filter is architecturally sound as a Stage 1 fast-path in front of ProtectAI. The benign-side fast-path clears the ≥ 0.99 prune-precision bar on **all three languages at both base rates tested** (monolingual prune precision 0.9985 / Spanish 0.9982 / Mandarin 0.9987 at 1% base rate, rising to ≥ 0.9998 at 0.1% base rate). Prune rate exceeds 88% on all three languages at both rates. The end-to-end compute saving clears the strong-pass threshold (≤ 0.3× ProtectAI-alone) only on **English (0.229×)**; on Spanish (0.529×) and Mandarin (0.431×) the dialect regex itself is slow enough (22 ms and 18 ms/sample — Task B's measured medians) that the prune rate benefit is partially eaten by Stage 1 cost. The headline-grabbing latency win is English-only; the prune-precision architectural win is all-three.

The pedagogical-FP axis (Task D's escalation flag) is **worse than ProtectAI-alone under this pipeline on all three k_reject values tested on en**. This is the only concerning finding and the only reason the verdict is PASS (partial) rather than PASS (strong). Details in the pedagogical-calibration subanalysis section.

### Verdict-criterion scorecard

Per the brief's four-way verdict rubric:

| Criterion | Target | Observed | Result |
|---|---|---|---|
| Prune ≥ 80% at prune_precision ≥ 0.99 on ≥ 2/3 languages | strong-pass half | **3/3 at both base rates** (prune_rate 0.88–0.96, prune_precision 0.998–1.000) | ✓ exceeds |
| Effective latency ≤ 0.3× ProtectAI-alone on ≥ 2/3 languages | strong-pass half | **1/3** — EN 0.229×, ES 0.529×, ZH 0.431× | ✗ |
| Prune precision < 0.99 (catastrophic leak) | kill trigger | min 0.9982 on any cell | ✗ no leak |
| Prune rate < 20% (no compute saving) | kill trigger | min prune_rate 0.879 on any cell | ✗ huge saving |

Strong-pass is blocked by the single latency criterion on ES/ZH. No kill trigger fires. The result is "partial pass" by the brief's own rubric.

## Hypothesis-precision checklist

Per the revised brief's stricter hypothesis framing:

1. **Does the pre-filter fast-reject ≥ 80% of benign content without leaking injection?** Yes, on all three languages at both rates. `gate-c-results.json` → `cells[*].prune.{prune_rate, prune_precision}`.
2. **Does end-to-end inference cost drop substantially?** Yes on English (77% reduction). Partially on ES/ZH (47–57% reduction). The latency ratio baseline ("ProtectAI-alone = 1.0") is a simplification — it assumes every chunk goes through ProtectAI in the null pipeline; realistic HoneyLLM traffic is longer per-chunk (DOM text is multi-paragraph, so ProtectAI's 512-token cap is frequently hit), which would make the null baseline worse and the two-stage win larger than the 0.22–0.53 numbers suggest.
3. **Does Task D's contract-of-awareness rubric help on pedagogical-FP beyond the two-stage baseline?** Not tested — the Gate C brief marks this as "optional, cut if >1 hour". I cut it: the two-stage baseline produced the more surprising finding (two-stage makes pedagogical-FP **worse**, not better) and that finding needs documentation more than the optional rubric overlay.

**Hypotheses NOT tested** (out of scope by brief):
- Multi-turn / context-aware variants — single-chunk only.
- Any language beyond en/es/zh-CN.
- Real-world DOM-text distribution (the benign side is still Wikipedia).
- Adversarial paraphrase against the vocabulary (Task B's caveat; inherited here).
- Alternative Stage 2 classifiers (Nano, WebLLM) — the architecture is classifier-agnostic but only ProtectAI is evaluated.

## Architecture sketch — where this slots into HoneyLLM

The two-stage pipeline fits into HoneyLLM's existing service-worker → offscreen-doc execution split. Per CLAUDE.md §"Execution-context map":

```text
    ┌──────────────────────────┐
    │ content script           │
    │  (src/content/)          │   extract page text, chunk
    └────────────┬─────────────┘
                 │ PAGE_SNAPSHOT { chunks[] }
                 ▼
    ┌──────────────────────────┐
    │ service worker           │
    │  (src/service-worker/)   │
    │                          │   detect chunk language
    │  ┌──────────────────┐   │
    │  │ Stage 1 DIALECT  │   │   per-lang regex (6–22 ms)
    │  │  primitive count │   │
    │  └────────┬─────────┘   │
    │           │              │
    │   ┌───────┴────────┐     │
    │   │ count == 0     │     │ fast-path: emit BENIGN, no LLM
    │   │ 0 < count < k  │     │ UNCERTAIN → offscreen doc
    │   │ count >= k     │     │ fast-path: emit INJECTION, no LLM
    │   └───────┬────────┘     │
    └───────────┼──────────────┘
                │ (only UNCERTAIN)
                ▼
    ┌──────────────────────────┐
    │ offscreen document       │
    │  (src/offscreen/)        │
    │                          │   Stage 2 LLM probe
    │  MLC WebLLM  /  Nano     │   (or fine-tuned classifier)
    │                          │
    └──────────────────────────┘
```

The cheap regex stages run in the service worker where regex cost is negligible (already a Chrome V8 worker); the offscreen document is created lazily (CLAUDE.md §"Offscreen document is lazy") and only spun up for UNCERTAIN chunks. At the 88–95% prune rate this spike measured, the offscreen doc is created ~5–12× less often than it would be in a "ProtectAI-on-every-chunk" architecture. The FLAGGED fast-path (dialect primitive count ≥ k_reject) trades ProtectAI confirmation for pipeline latency; k = 2 on en and zh makes this trade safely (flag precision 0.57 en / 1.00 es / 1.00 zh) — see `gate-c-results.json` → `cells[*].flag.flag_precision`.

## Results — all 18 cells

All numbers are from `gate-c-results.json`. The table reports end-to-end two-stage verdict metrics at the ProtectAI 0.5 threshold (the model's own default), prune stats for the BENIGN fast-path, flag stats for the FLAGGED fast-path, and the effective latency ratio versus a "ProtectAI runs on every chunk" baseline.

### English (n = 10000 at each rate)

| rate | k | prune_rate | prune_prec | flag_prec | TPR | FPR | precision | F1 | PA-invocations | latency ratio |
|---|---|---|---|---|---|---|---|---|---|---|
| 1% | 1 | 0.8824 | 0.9985 | 0.074 | 0.87 | 0.110 | 0.074 | 0.137 | 0 | **0.120** |
| 1% | **2** | **0.8824** | **0.9985** | **0.565** | **0.79** | **0.004** | **0.664** | **0.722** | **1084** | **0.229** |
| 1% | 3 | 0.8824 | 0.9985 | 1.000 | 0.76 | 0.000 | 1.000 | 0.864 | 1149 | 0.235 |
| 0.1% | 1 | 0.8788 | 0.9998 | 0.007 | 0.80 | 0.121 | 0.007 | 0.013 | 0 | 0.120 |
| 0.1% | 2 | 0.8788 | 0.9998 | 0.100 | 0.50 | 0.005 | 0.100 | 0.167 | 1162 | 0.236 |
| 0.1% | 3 | 0.8788 | 0.9998 | 1.000 | 0.40 | 0.000 | 1.000 | 0.571 | 1210 | 0.241 |

Key rows bolded. k = 1 is the "dialect-only" degenerate case (no UNCERTAIN band; every non-zero row is FLAGGED and no ProtectAI invocation happens). k = 2 is the Task A/B production operating point. k = 3 is stricter — higher flag precision, similar end-to-end F1.

The 0.1% rate drops end-to-end precision sharply (0.100 at k=2 / 0.1%) because there are only 10 injections in 10000 rows; every non-trivial FPR produces more FPs than TPs. The 0.1% rate still shows clear prune-precision safety (0.9998 — one injection leaks to the BENIGN fast-path in 10000 rows). Between the two rates, 1% is the production-relevant target.

### Spanish (n = 5000 at each rate)

| rate | k | prune_rate | prune_prec | flag_prec | TPR | FPR | precision | F1 | PA-invocations | latency ratio |
|---|---|---|---|---|---|---|---|---|---|---|
| 1% | 1 | 0.9060 | 0.9982 | 0.089 | 0.84 | 0.087 | 0.089 | 0.162 | 0 | 0.442 |
| 1% | **2** | **0.9060** | **0.9982** | **1.000** | **0.84** | **0.022** | **0.282** | **0.422** | **439** | **0.529** |
| 1% | 3 | 0.9060 | 0.9982 | 1.000 | 0.82 | 0.022 | 0.277 | 0.414 | 457 | 0.533 |
| 0.1% | 1 | 0.9244 | 0.9998 | 0.011 | 0.80 | 0.075 | 0.011 | 0.021 | 0 | 0.442 |
| 0.1% | 2 | 0.9244 | 0.9998 | 1.000 | 0.80 | 0.019 | 0.040 | 0.075 | 376 | 0.517 |
| 0.1% | 3 | 0.9244 | 0.9998 | n/a | 0.80 | 0.019 | 0.040 | 0.075 | 378 | 0.517 |

Spanish's absolute precision/F1 on the two-stage pipeline is dragged down by ProtectAI itself — ProtectAI-alone on the Spanish mixed corpus has FPR = 0.088 at its default threshold (`gate-c-results.json` → `cells[*].protectai_alone.fpr`). The two-stage pipeline improves on that: FPR drops to 0.022 at k = 2. The two-stage precision is lower-than-ideal because injection count is low (50 at 1%), but **the two-stage pipeline strictly improves Spanish-side ProtectAI FPR by 75% (0.088 → 0.022)** — Stage 1 correctly prunes Spanish benign chunks that would otherwise be false-positively flagged by ProtectAI.

### Mandarin (n = 5000 at each rate)

| rate | k | prune_rate | prune_prec | flag_prec | TPR | FPR | precision | F1 | PA-invocations | latency ratio |
|---|---|---|---|---|---|---|---|---|---|---|
| 1% | 1 | 0.9490 | 0.9987 | 0.172 | 0.88 | 0.043 | 0.172 | 0.289 | 0 | 0.386 |
| 1% | **2** | **0.9490** | **0.9987** | **1.000** | **0.88** | **0.000** | **1.000** | **0.936** | **224** | **0.431** |
| 1% | 3 | 0.9490 | 0.9987 | 1.000 | 0.86 | 0.000 | 1.000 | 0.925 | 245 | 0.435 |
| 0.1% | 1 | 0.9630 | 1.0000 | 0.027 | 1.00 | 0.036 | 0.027 | 0.053 | 0 | 0.386 |
| 0.1% | 2 | 0.9630 | 1.0000 | 1.000 | 1.00 | 0.000 | 1.000 | 1.000 | 181 | 0.422 |
| 0.1% | 3 | 0.9630 | 1.0000 | n/a | 1.00 | 0.000 | 1.000 | 1.000 | 185 | 0.422 |

Mandarin's two-stage result at k = 2 is the cleanest across the matrix: FPR = 0.000 at both rates, precision = 1.000, F1 = 0.936 (1%) / 1.000 (0.1%). This is **dramatically better than ProtectAI-alone on Mandarin** — PA-alone has FPR = 0.316 on the Mandarin mixed corpus (that is, 16 of 50 unique benign Mandarin Wikipedia paragraphs are false-positive-flagged by ProtectAI at its 0.5 threshold — a real out-of-distribution failure the dialect pre-filter masks because those specific benign rows contain no primitives).

This ProtectAI-on-Mandarin degradation is itself a Task C finding worth surfacing: **when the expensive classifier is less reliable than the cheap pre-filter on a given language, the two-stage pipeline can *improve* absolute precision, not just latency.** It's a direct consequence of the pre-filter having independent failure modes from the classifier — a point Task D also made about ensemble error-uncorrelation but for a different method pair.

## Effective-latency analysis

Latency formula (`gate-c-prefilter.py` → `latency_metrics`):

```
effective_ms_per_chunk = dialect_ms + (stage2_invocation_rate) * protectai_ms
```

where `stage2_invocation_rate = uncertain_count / total` and dialect_ms, protectai_ms are the Task A/B measured medians:

| Language | dialect_ms | protectai_ms |
|---|---|---|
| en | 6.22 | 51.73 |
| es | 22.08 | 50.01 |
| zh-CN | 18.53 | 48.03 |

At k = 2, 1% rate:

| Language | stage2_rate | effective_ms | PA-alone-ms | ratio |
|---|---|---|---|---|
| en | 0.108 | 11.84 | 51.73 | **0.229** |
| es | 0.088 | 26.48 | 50.01 | 0.529 |
| zh-CN | 0.045 | 20.70 | 48.03 | 0.431 |

The English win (0.229×) is driven by dialect being 8.3× cheaper than ProtectAI at the per-sample level. Spanish and Mandarin dialect packs carry more regex alternations and (for zh) CJK character scanning, which raises their median to 22 / 18 ms — so even when stage2_invocation_rate is lowest (zh: 4.5%), dialect itself still accounts for ~40% of the ProtectAI-alone budget. This matches Task B's §"Compute-adjusted comparison vs ProtectAI" observation: the per-language dialect packs are 2–3× slower than English and the optimisation space (regex compilation, alternation ordering, CJK-specific tokenisation) is untouched.

**Latency headroom not tested here**: if the ES/ZH packs were compiled once to a Hyperscan-style NFA or a pre-tokenised primitive index, realistic dialect cost could plausibly drop to ~6–8 ms/sample on Apple Silicon, recovering the 0.3× latency ceiling on those languages. This is a Gate 3 optimisation, not a Gate C claim.

## Pedagogical-calibration subanalysis

The English pedagogical set (50 holdout_benign_calibration rows from `gate-1-corpus.jsonl`) + 100 injection holdouts from the same corpus, replayed through the two-stage pipeline. This is the Task-D-flagged escalation mode where all detection methods converge toward chance.

| Method | k | TPR | FPR | Precision | F1 |
|---|---|---|---|---|---|
| **ProtectAI alone** (baseline) | — | 0.800 | 0.300 | 0.842 | 0.821 |
| Two-stage | 1 | 0.870 | **0.500** | 0.777 | 0.821 |
| Two-stage | 2 | 0.790 | 0.360 | 0.814 | 0.802 |
| Two-stage | 3 | 0.760 | 0.300 | 0.835 | 0.796 |

**Headline finding**: the two-stage pipeline is **worse on pedagogical calibration** than ProtectAI-alone at every k value tested. At k = 1 (dialect-only — equivalent to the Gate 1 spike's original k=1 operating point) FPR rises from 0.30 to 0.50 because dialect FLAGS pedagogical articles (primitive_count ≥ 1 on 25/50 pedagogical rows) without ProtectAI confirmation. At k = 3 the numbers converge to PA-alone (FPR 0.30 in both) because only 11 pedagogical articles hit primitive_count ≥ 3, and those happen to be the exact subset ProtectAI also misclassifies. At k = 2 the pipeline is between the two.

Why this is not a surprise, restated: Task A's calibration-set analysis already showed dialect PR-AUC drops ~15.8 pp on pedagogical-article-augmented data versus pure holdout, while ProtectAI drops only 5.5 pp. The two-stage pipeline inherits the worse of the two at the dialect-fast-path end (k = 1 is pure dialect; k = 3 nearly pure ProtectAI). The **cheap pre-filter does not help** with the hardest FP axis — it actively hurts on the dialect-fast-path and is neutral-to-slightly-worse elsewhere.

What this does not say: it does *not* say the rubric from Task D wouldn't help. Task D measured the rubric's calibration-AUC at 0.640 (better than a 0/1 coin flip and on the correct side); applied as a third signal to suppress FLAGGED-but-pedagogical rows, the rubric plausibly recovers the 30% FPR to 20–25%. That test was in the brief as "optional, cut if >1 hour" and I cut it (the two-stage result needed documentation first; the rubric overlay is an obvious ~2-hour follow-up given the existing Gate 2 runner).

**Pedagogical-calibration verdict**: the two-stage pipeline is a net **neutral-to-negative** on this axis. The prune rate is still useful (25/50 pedagogical articles correctly pruned at any k) but the FLAGGED and UNCERTAIN bands do not clean up the remaining pedagogical FPs. Gate C's escalation flag for the issue thread: the prune-rate benefit is robust; the pedagogical-FP axis is **not** solved by two-stage.

## Interactions between Tasks A / B / D revealed by Gate C

A few interactions between the three prior results surfaced here:

1. **Per-language dialect latency dominates the Spanish / Mandarin pipeline.** Task B reported per-language AUROC/ms compute-adjusted, but the mixed-corpus context pushes the absolute regex median to ~40% of the ProtectAI-alone budget on es/zh. The "cheap pre-filter" framing assumes dialect is 10× cheaper than the classifier; on en that's 8× (true), on es/zh it's closer to 2.3–2.7× (tight margin). This was foreshadowed in Task B's §"Compute-adjusted comparison vs ProtectAI" but is more load-bearing here than in the Task B verdict.
2. **ProtectAI's Mandarin FPR on this corpus is 31.6%, not the 0.04 FPR Task A's tiny holdout suggested.** The gap is a sampling artifact: Task A's 50-row Mandarin holdout had 2 benigns PA misclassified (4% FPR); when resampling 4950 benigns from 50 with replacement, the same 2 underlying FP-generating rows now produce ~4% of 4950 = ~200 FPs *per injection-free row* — but more importantly, the 50-row pool actually contains **16 distinct benigns PA flags as INJECTION at 0.5 threshold** (31.6% raw FP rate on the unique pool; `gate-c-protectai-cache.json` confirms). Task A's TPR@1%FPR metric hid this because the ROC sweeps past the 31% FPR point without reporting it. **This is a material update to Task A's Mandarin-side numbers** — ProtectAI's Mandarin precision on this corpus is 0.03, not 0.75-0.90 as a casual reading of Task A might suggest. The two-stage pipeline masks this PA weakness; PA-alone in production would require tighter thresholds or a different classifier on Mandarin.
3. **The FLAGGED fast-path at k ≥ 2 never leaks FPs on Spanish or Mandarin.** `gate-c-results.json` → `cells[*].flag.flag_precision`: at k = 2 on es and zh the flag_precision is 1.000 at both base rates. At k = 2 on en it's 0.565 (1% rate) / 0.100 (0.1% rate) — ie. on English, dialect primitive_count ≥ 2 is *not* a fully trustworthy INJECTION signal at 0.1% base rate (92 FLAGGED rows, only 5 are true injections; the other 87 are benign rows that happen to trigger ≥ 2 primitives). The FLAGGED fast-path is safe on ES/ZH but not on EN — reverse of what Task A's monolingual-only findings would have suggested. **This is the single most counter-intuitive finding of Gate C** and should update the issue's operating-point selection: FLAGGED fast-path should be gated on language, not applied uniformly.
4. **Task D's rubric overlay is the most obvious follow-up.** If the rubric fires on pedagogical-cue sentences (its `quoted_content_suppression` mechanism) it would plausibly catch ~half of the FPs currently leaking into the UNCERTAIN → FLAGGED path in the two-stage pipeline on en. A ~2-hour experiment could measure this directly.

## Design constraints this imposes on a Gate 3 implementation

(Informational — Gate 3 is out of scope for Task C, but the pipeline sketch makes the constraints clear.)

- **Per-language dispatch required.** A universal dialect pack cannot replace the three per-language packs — that's Task B's conclusion, and the Gate C numbers depend on it. The service-worker language-detection step is load-bearing (if it fails, the English pack will be applied to Spanish text and the prune-precision safety collapses back to the Task A cross-lingual numbers).
- **FLAGGED-fast-path needs language-conditional gating.** At k = 2, en FLAGGED precision = 0.565 (1%) / 0.100 (0.1%); es/zh FLAGGED precision = 1.000 at both rates. A production pipeline should either raise k to 3 on en (flag_prec 1.000, slight TPR cost) or force UNCERTAIN → Stage 2 on en regardless of k, keeping FLAGGED-fast-path only on es/zh. **This is the single configuration knob this spike introduces that is not already in Task A/B.**
- **ProtectAI's Mandarin behaviour (16/50 benign FP rate) means Gate 3 cannot rely on ProtectAI for Stage 2 in Mandarin.** Either (a) swap to a different Stage 2 classifier on zh (Nano, WebLLM), (b) raise the ProtectAI threshold to 0.9+ on zh only (would cost TPR), or (c) accept that the FLAGGED fast-path alone carries Mandarin detection and skip Stage 2 on zh entirely.
- **Pedagogical-FP axis is still unsolved.** Gate C does not dent it. The Task D rubric overlay is the next thing to test; the tracked-backlog candidate is a fine-tuned pedagogical-awareness classifier (Gate 3 effort).

## Deliverables checklist

- [x] `gate-c-mixed-corpus-en.jsonl` — 1%-rate EN mixed corpus (10000 rows, 100 inj).
- [x] `gate-c-mixed-corpus-es.jsonl` — 1%-rate ES mixed corpus (5000 rows, 50 inj).
- [x] `gate-c-mixed-corpus-zh-CN.jsonl` — 1%-rate ZH mixed corpus (5000 rows, 50 inj).
- [ ] 0.1%-rate corpora as on-disk JSONL — **skipped**, exercised in-memory only (would be 3× the file size for marginal audit value; deterministic regen via `--seed`).
- [x] `gate-c-prefilter.py` — runner (~780 lines; under the 800-cap).
- [x] `gate-c-protectai-cache.json` — model-score cache (keyed by source_id, 650 en + 100 es + 100 zh entries).
- [x] `gate-c-results.json` — 18 cells + 3 pedagogical subanalysis entries + meta.
- [x] `gate-c-prefilter-spike.md` — this document.

## Reproduction

```
cd docs/issues/52-cowork-outputs
# First invocation — runs ProtectAI inference (~80 s total across three languages).
/tmp/gate1-venv/bin/python gate-c-prefilter.py \
    --precompute --generate-corpora --evaluate \
    --out gate-c-results.json
# Replay — skips ProtectAI; dialect scoring on 30k rows takes ~3–5 min.
/tmp/gate1-venv/bin/python gate-c-prefilter.py \
    --generate-corpora --evaluate \
    --out gate-c-results.json
```

The mixed corpora are deterministic under `--seed 42` (the default); re-running the script with a fresh cache produces byte-identical JSONL files modulo the `corpus_meta.seed` field.

## Final verdict (restated)

**PASS (partial).** The two-stage pre-filter architecture is safe (prune precision ≥ 0.99 on all three languages at both realistic base rates), produces meaningful compute savings (0.229× on EN; 0.43–0.53× on ES/ZH), and improves absolute detection precision on Mandarin where ProtectAI-alone has a real out-of-distribution weakness. Strong-pass is blocked because the 0.3× latency bar is only met on English. The pedagogical-FP axis is not solved by two-stage and Task D's rubric overlay is the obvious next experiment. No kill trigger fires; no data suggests the architecture is unsound; the remaining work is (a) optimising es/zh dialect regex cost, (b) per-language gating of the FLAGGED fast-path, (c) a rubric-overlay pass on pedagogical content, and (d) Gate 3 integration into HoneyLLM's service-worker + offscreen-doc split.
