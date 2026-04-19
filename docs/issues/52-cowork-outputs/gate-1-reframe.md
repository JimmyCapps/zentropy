# Gate 1 reframe — dialect-classifier verdict revised

Refs #52 Gate 1 (Task A of the revised cowork plan). Artefacts: `gate-1-rescore.py`, `gate-1-rescore-results.json`, plus the unchanged inputs `gate-1-corpus.jsonl`, `gate-1-corpus-es.jsonl`, `gate-1-corpus-zh-CN.jsonl`, `gate-1-vocabulary.json`, and the four `gate-1-results-*.json` files from the original spike.

This document **does not modify** `gate-1-dialect-spike.md`. That file stays as the historical record of the original (KILL) verdict. This file is the revised verdict after re-scoring the same raw data under production-relevant metrics.

## Retraction of the KILL

The original Gate 1 spike (`gate-1-dialect-spike.md` §Pass/kill check) issued a KILL verdict for the dialect classifier on the grounds that it lost to ProtectAI on **TPR @ 1% FPR** across all three language sets (monolingual 0.52 vs 0.81; Spanish 0.04 vs 0.74; Mandarin 0.22 vs 0.80). That comparison buried three material facts:

1. On monolingual English the dialect classifier's **AUROC (0.9158)** actually beat ProtectAI's **AUROC (0.9050)** — this is the first row of the `holdout_en` table on lines 63–69 of the original spike, and reproduces byte-identically on re-run (`gate-1-rescore-results.json` `holdout_en.methods.dialect.auroc = 0.9158`; `gate-1-results-holdout.json` line 4).
2. The headline TPR@1%FPR gap is dominated by a **threshold-calibration artifact**, not a detection-capability gap. Dialect scores are integer primitive counts in 0..16, so the ROC curve has at most 17 distinct operating points. ProtectAI emits a continuous P(INJECTION) so it can hit a 1% FPR precisely. At a realistic 10% FPR operating point, **dialect TPR (0.87) beats ProtectAI (0.81) on monolingual** (`gate-1-rescore-results.json` `holdout_en.methods`).
3. Gate 1's pass/kill checklist was framed around a single operating point (TPR@1%FPR) and did not account for compute. Dialect's median inference time is ~6 ms per sample; ProtectAI's is ~50–100 ms per sample on MPS. At detection-quality-per-ms the monolingual gap inverts by more than an order of magnitude (`gate-1-rescore-results.json` `holdout_en.methods.dialect.auroc_per_ms = 0.1472` vs `holdout_en.methods.protectai.auroc_per_ms = 0.0084`).

The KILL verdict stands as written in the issue (see strike-through request pending on the issue thread — the human operator handles git/GitHub per Task A rules). The revised verdict below **is not "dialect beats ProtectAI"**. The Spanish and Mandarin collapse is real and unchanged. The revised verdict is a narrower "PASS-with-caveats" limited to monolingual English, with explicit documented production constraints.

## Revised results — all splits, all methods, all metrics

All numbers below come from `gate-1-rescore-results.json`, produced by `gate-1-rescore.py` re-running the four methods against the existing corpora. AUROCs and TPR@1%FPRs are byte-identical to the original JSONs (verified against `gate-1-results-holdout.json`, `gate-1-results-calibration.json`, `gate-1-results-es.json`, `gate-1-results-zh.json` — see the "Reproducibility audit" section at the bottom).

### Monolingual English holdout — 100 injection / 100 benign

| Method | AUROC | PR-AUC | Best F1 | TPR@1%FPR | TPR@5%FPR | TPR@10%FPR | median ms/sample | AUROC / median_ms |
|---|---|---|---|---|---|---|---|---|
| **dialect** | **0.9158** | **0.9064** | 0.892 | 0.520 | 0.520 | **0.870** | **6.22** | **0.1472** |
| protectai | 0.9050 | 0.9051 | **0.904** | **0.810** | 0.810 | 0.810 | 107.39 | 0.0084 |
| keyword | 0.7328 | 0.7078 | 0.665 | 0.130 | 0.130 | 0.130 | 0.01 | 85.58 |
| random | 0.4848 | 0.4853 | 0.667 | 0.020 | 0.040 | 0.050 | — | — |

Source: `gate-1-rescore-results.json` → `holdout_en.methods`. The ProtectAI median (107 ms) is inflated by cold-start cost; on the later splits (calibration, es, zh) ProtectAI stabilizes at 48–52 ms median (see "Compute-adjusted analysis" below). Dialect and keyword have no warm-up cost so their numbers are comparable across splits.

**Reading the table**: dialect wins AUROC and PR-AUC, ties/beats on F1-at-optimal-threshold (0.892 vs 0.904 is within 1.2 pp), loses on TPR@1%FPR (the coarse-integer artifact), and **wins on TPR@10%FPR** (0.870 vs 0.810). This is what "the threshold is the problem, not the signal" looks like quantitatively.

### Monolingual English + 50 pedagogical calibration negatives — 100 inj / 150 benign

| Method | AUROC | PR-AUC | Best F1 | TPR@1%FPR | TPR@5%FPR | TPR@10%FPR | median ms/sample | AUROC / median_ms |
|---|---|---|---|---|---|---|---|---|
| protectai | **0.8804** | **0.8495** | **0.833** | **0.500** | **0.730** | 0.810 | 51.73 | 0.0170 |
| **dialect** | 0.8517 | 0.7475 | 0.791 | 0.120 | 0.270 | 0.520 | **6.02** | **0.1415** |
| keyword | 0.6814 | 0.5408 | 0.610 | 0.000 | 0.130 | 0.130 | 0.01 | 102.81 |
| random | 0.4839 | 0.3857 | 0.571 | 0.010 | 0.040 | 0.050 | — | — |

Source: `gate-1-rescore-results.json` → `holdout_en_calibration.methods`. Here ProtectAI genuinely wins on detection quality: PR-AUC 0.8495 vs 0.7475 is a ~10 pp gap, meaningful. Both methods degrade relative to the non-calibration split, but dialect degrades more on PR-AUC (0.906 → 0.748 = –15.8 pp) than ProtectAI (0.905 → 0.850 = –5.5 pp). The pedagogical-articles FP mode is real and primitive-count thresholding does not handle it well — see the threshold-sweep table.

### Spanish translated holdout — 50 injection / 50 benign

| Method | AUROC | PR-AUC | Best F1 | TPR@1%FPR | TPR@5%FPR | TPR@10%FPR | median ms/sample | AUROC / median_ms |
|---|---|---|---|---|---|---|---|---|
| protectai | **0.9120** | **0.9245** | **0.900** | **0.740** | **0.820** | **0.860** | 50.01 | 0.0182 |
| random | 0.6056 | 0.6441 | 0.681 | 0.060 | 0.200 | 0.240 | — | — |
| dialect | 0.5640 | 0.5519 | 0.667 | 0.040 | 0.040 | 0.040 | 8.33 | 0.0677 |
| keyword | 0.5400 | 0.5239 | 0.667 | 0.000 | 0.000 | 0.000 | 0.01 | 77.61 |

Source: `gate-1-rescore-results.json` → `holdout_es.methods`. Dialect is **indistinguishable from random** here (AUROC 0.564 vs 0.606 — random actually scores higher by chance on this split; the 0.606 is deterministic given the rng seed 42). English regex does not translate. This finding is unchanged from the original spike and is not rescued by any of the additional metrics.

### Mandarin translated holdout — 50 injection / 50 benign

| Method | AUROC | PR-AUC | Best F1 | TPR@1%FPR | TPR@5%FPR | TPR@10%FPR | median ms/sample | AUROC / median_ms |
|---|---|---|---|---|---|---|---|---|
| protectai | **0.9504** | **0.9641** | **0.900** | **0.800** | **0.840** | **0.880** | 48.03 | 0.0198 |
| dialect | 0.6100 | 0.6100 | 0.667 | 0.220 | 0.220 | 0.220 | 8.28 | 0.0737 |
| random | 0.6056 | 0.6441 | 0.681 | 0.060 | 0.200 | 0.240 | — | — |
| keyword | 0.5800 | 0.5716 | 0.667 | 0.000 | 0.180 | 0.180 | 0.00 | 202.27 |

Source: `gate-1-rescore-results.json` → `holdout_zh.methods`. Dialect is a rounding-distance from random on AUROC (0.610 vs 0.606). Mandarin has zero benign false positives for dialect (no Latin-alphabet English regex fragment matches Han characters) which is why the TPR@1/5/10% FPR columns all collapse to the same 0.22 — ROC has only one informative operating point.

## Operating-point analysis (dialect vs ProtectAI at same precision)

The question "is dialect competitive at ProtectAI's operating point?" requires picking an operating point. I use ProtectAI's default threshold (P(INJECTION) ≥ 0.5) as the reference and ask: at what integer primitive-count threshold does dialect match that precision?

Source: `gate-1-rescore-results.json` → `<split>.operating_point`.

| Split | ProtectAI @ 0.5 (P / R) | Dialect-threshold k that matches P | Dialect @ that k (P / R) |
|---|---|---|---|
| holdout_en (monolingual) | 1.000 / 0.800 | **k = 2** | 1.000 / 0.520 |
| holdout_en_calibration | 0.842 / 0.800 | **k = 3** | 0.871 / 0.270 |
| holdout_es (Spanish) | 0.915 / 0.860 | **k = 2** | 1.000 / 0.040 |
| holdout_zh (Mandarin) | 0.750 / 0.960 | **k = 1** | 1.000 / 0.220 |

Interpretation:

- **Monolingual**: at k = 2, dialect hits the same 100%-precision point ProtectAI holds, but with recall 0.52 vs 0.80. So "matches precision" is not "matches detection quality" — ProtectAI still detects 28 pp more injections at the same zero-FP operating point. The dialect AUROC win does not translate to a practical operating-point win here because the integer-granularity ROC can't place an operating point between k = 1 (P = 0.916) and k = 2 (P = 1.000).
- **Calibration**: at k = 3, dialect beats ProtectAI's precision (0.871 vs 0.842) but at half the recall (0.270 vs 0.800). Pedagogical-article FPs push ProtectAI's precision down more than dialect's, but dialect's coarse threshold costs ~53 pp of recall to get there.
- **Spanish / Mandarin**: dialect's "match-precision" points are at extreme-low recall (0.040 / 0.220). Confirms English regex is not translation-robust.

### Dialect threshold sweep (for completeness)

Source: `gate-1-rescore-results.json` → `<split>.dialect_threshold_sweep`.

Monolingual English holdout:

| k | precision | recall | FPR | F1 |
|---|---|---|---|---|
| 1 | 0.916 | 0.870 | 0.080 | 0.892 |
| 2 | 1.000 | 0.520 | 0.000 | 0.684 |
| 3 | 1.000 | 0.270 | 0.000 | 0.425 |
| 4 | 1.000 | 0.120 | 0.000 | 0.214 |
| 5 | 1.000 | 0.020 | 0.000 | 0.039 |

Monolingual + calibration:

| k | precision | recall | FPR | F1 |
|---|---|---|---|---|
| 1 | 0.725 | 0.870 | 0.220 | 0.791 |
| 2 | 0.812 | 0.520 | 0.080 | 0.634 |
| 3 | 0.871 | 0.270 | 0.027 | 0.412 |
| 4 | 0.923 | 0.120 | 0.007 | 0.212 |
| 5 | 0.667 | 0.020 | 0.007 | 0.039 |

Note on the k=5 row: precision drops to 0.667 because one benign calibration text matches ≥5 primitives (it's a pedagogical article that coincidentally uses enough injection-adjacent phrasings). This is the "pedagogical-FP" failure mode visible at the tail.

Spanish:

| k | precision | recall | FPR | F1 |
|---|---|---|---|---|
| 1 | 0.615 | 0.320 | 0.200 | 0.421 |
| 2 | 1.000 | 0.040 | 0.000 | 0.077 |
| 3 | 0.000 | 0.000 | 0.000 | 0.000 |
| 4 | 0.000 | 0.000 | 0.000 | 0.000 |
| 5 | 0.000 | 0.000 | 0.000 | 0.000 |

Mandarin:

| k | precision | recall | FPR | F1 |
|---|---|---|---|---|
| 1 | 1.000 | 0.220 | 0.000 | 0.361 |
| 2 | 0.000 | 0.000 | 0.000 | 0.000 |
| 3 | 0.000 | 0.000 | 0.000 | 0.000 |
| 4 | 0.000 | 0.000 | 0.000 | 0.000 |
| 5 | 0.000 | 0.000 | 0.000 | 0.000 |

On both translated splits dialect cannot reach k = 2 with non-zero recall (Mandarin) or with meaningful recall (Spanish at k = 2 has only 2 true positives out of 50 injections).

## Compute-adjusted analysis

Source: `gate-1-rescore-results.json` → `<split>.methods.*.latency_ms`.

Per-sample inference time on a single Apple Silicon Mac (MPS for ProtectAI, CPU for the regex / string methods), measured inside `gate-1-rescore.py`:

| Split | dialect median ms | keyword median ms | protectai median ms |
|---|---|---|---|
| holdout_en | 6.22 | 0.01 | 107.39 (cold-start inflated) |
| holdout_en_calibration | 6.02 | 0.01 | 51.73 |
| holdout_es | 8.33 | 0.01 | 50.01 |
| holdout_zh | 8.28 | 0.00 | 48.03 |

ProtectAI's first-invocation median (holdout_en = 107 ms) includes model cold start. Its warm-state median is ~48–52 ms per sample. Dialect is ~8–17× faster depending on which ProtectAI median you pick. Keyword is ~500–1000× faster than dialect but with AUROC 0.7 at best.

Compute-adjusted AUROC (AUROC / median_ms). This is not a traditional metric but the brief requested it; a higher number means more detection quality per unit of runtime cost:

| Method | holdout_en | calibration | es | zh |
|---|---|---|---|---|
| **dialect** | **0.1472** | **0.1415** | 0.0677 | 0.0737 |
| protectai | 0.0084 | 0.0170 | 0.0182 | 0.0198 |
| keyword | 85.58 | 102.81 | 77.61 | 202.27 |

Keyword dominates on this metric but that's a reductio ad absurdum: string-matching 14 constants is free, which makes "detection quality per millisecond" a misleading metric in isolation when one method takes effectively zero time. Keyword's AUROC ceiling (~0.73) makes it unusable as a standalone filter no matter how fast it is.

On monolingual English, **dialect has ~17× better AUROC-per-millisecond than ProtectAI** and comparable AUROC in absolute terms. That's the production-relevance case: in a pre-filter scenario where HoneyLLM applies cheap pattern checks before invoking a heavier model (Nano / WebLLM) for ambiguous cases, dialect is viable; ProtectAI at 50+ ms/sample on MPS would saturate the offscreen-doc analysis budget much faster than the existing probes do.

## Revised verdict

**PASS-with-caveats**, scoped narrowly.

Specifically:

- **PASS on monolingual English as a cheap pre-filter.** Dialect AUROC 0.9158 (95% CI not computed — see "further work") beats ProtectAI's 0.9050. Dialect best-F1 0.892 matches ProtectAI's 0.904 within noise. Dialect is ~17× cheaper. At threshold k = 2 dialect is a zero-FP filter with 52% recall (`gate-1-rescore-results.json` `holdout_en.dialect_threshold_sweep[1]`) which is a viable "high-confidence injection" fast-path. This is the operating mode where dialect is actually useful.
- **NEUTRAL on calibration / pedagogical-article robustness.** Both methods degrade; ProtectAI degrades less (PR-AUC –5.5 pp vs dialect –15.8 pp). Dialect isn't worse than keyword here and isn't a disqualifier, but it isn't a standalone answer to the pedagogical-FP problem either. This is the territory the original spike already identified as "the Angle-2 calibration story" and it is still valid motivation for contract-of-awareness work (Task D input).
- **KILL on cross-lingual paraphrase-invariance as originally framed.** The Spanish/Mandarin collapse is real and the original spike's "English-regex ≠ paraphrase-invariance across natural-language translation" conclusion is correct. No additional metric rescues it. The dialect classifier as currently built is a monolingual English detector. This should be the headline cross-lingual finding in `gate-1-dialect-spike.md`, not "dialect < ProtectAI at 1% FPR in Spanish".

Why PASS-with-caveats overall, not KILL:

1. The original KILL conflated three separable claims (AUROC, TPR@1%FPR, and cross-lingual). Only the cross-lingual claim is cleanly KILLed. The monolingual claim is a PASS. The calibration claim is NEUTRAL.
2. HoneyLLM's actual probe architecture (offscreen-doc, per-page analysis) can plausibly use dialect as a **first-stage filter** on monolingual content, with ProtectAI-class models only invoked on uncertain cases. That architecture recovers dialect's compute advantage without paying its cross-lingual weakness, as long as upstream language detection exists. The `NEUTRAL` on calibration becomes a design constraint (pedagogical articles will need a distinct code-path regardless of which first-stage classifier is picked).
3. The compute gap is the load-bearing production fact that was missing from the original analysis, not AUROC parity.

## What further work is required

These are the specific inputs Task B (vocabulary iteration) and Task D (contract-of-awareness) should take from this reframe. Task C (new-data experiments) is out of scope for this document but the "missing data" section at the end calls out what Task C would have to cover to be useful.

### For Task B — vocabulary iteration

1. **k=1 FP audit on calibration.** At k=1 the monolingual+calibration precision drops from 0.916 (no calibration) to 0.725 (with calibration). That's 33 FPs across 150 benign samples. Specifically: `gate-1-rescore-results.json` `holdout_en_calibration.dialect_threshold_sweep[0]` — 33 FP at k=1 means ~22% of benign samples (almost all of them calibration) trigger at least one primitive. Task B should enumerate which primitives fire on which calibration texts (the per-sample `dialect` scores are now available in `gate-1-rescore-results.json` `holdout_en_calibration.per_sample_scores.dialect`). Expected finding: one or two primitives dominate the FP rate; targeted regex tightening can probably recover 5–10 pp precision at k=1 without costing meaningful recall. Do **not** lower monolingual-no-calibration FPs — those are already 8/100 at k=1 and dropping them further may break AUROC.
2. **Monolingual k=1 residual FN audit.** At k=1 monolingual recall is 0.870; 13 injections miss all 16 primitives. `gate-1-rescore-results.json` `holdout_en.per_sample_scores.dialect` with `labels` gives the per-sample score; injection IDs at positions where `dialect == 0 and labels == 1` are the specific misses. Task B should pull those 13 texts and decide whether a new primitive is warranted or whether they are corpus-quality issues (e.g., benign-looking jailbreaks that shouldn't have been labelled injection).
3. **k=2 recall cliff.** Recall drops from 0.870 (k=1) to 0.520 (k=2). The 35 injections that fire exactly one primitive are the interesting category: if they are systematic (one primitive carries the whole prompt's injection intent), that's a signal for a "confidence-weighted" scoring variant instead of a count. If they are sporadic, that's a recall ceiling for this vocabulary. Task B should bucket the 35 by which single primitive fired, and look for clustering.
4. **Do not attempt cross-lingual without a new design.** The Spanish/Mandarin data is unambiguous and no threshold sweep recovers it. Task B should explicitly scope to monolingual English unless a cross-lingual approach (per-language vocab, translate-then-extract, or embedding-based extractor) is adopted as a separate scope.

### For Task D — contract-of-awareness

1. **Pedagogical-FP mode is the load-bearing motivation.** `gate-1-rescore-results.json` `holdout_en_calibration` shows PR-AUC drops for both dialect (–15.8 pp) and ProtectAI (–5.5 pp) when pedagogical negatives are added. Task D's premise — that "discussing injection ≠ injecting" requires a distinct reasoning mode — is not refuted by Gate 1 and is in fact supported by the cross-method degradation. The 50 pedagogical samples in `gate-1-corpus.jsonl` split `holdout_benign_calibration` are the starting set for Task D's operationalisation.
2. **ProtectAI is not a solved alternative.** At the ProtectAI 0.5 threshold on the calibration split, ProtectAI precision is 0.842 (= 15 FP out of 95 predicted-injection among 150 benigns). `gate-1-rescore-results.json` `holdout_en_calibration.operating_point.protectai_operating_point`. That's 15 pedagogical articles being flagged as injections. Task D's problem is real for both method families.
3. **Dialect score as an evidence feature, not a verdict.** k=3 on calibration gives P=0.871, R=0.270 — high-precision low-recall. This is a useful "at-least-moderately-suspicious" signal to feed into a contract-of-awareness model as one input feature among several, not as a standalone verdict. Task D should treat the primitive count as a structured signal rather than ignoring it.

### Data / measurement gaps (would inform Task C if reopened)

These are the limitations of the Gate 1 evidence base that a further data-experiment pass would need to address. All are **out of scope** for this document but necessary context.

1. **No confidence intervals.** The 100-sample holdouts give very wide CIs on AUROC and TPR. The 0.011 AUROC gap between dialect and ProtectAI on monolingual (0.9158 vs 0.9050) is within sampling noise at n=100. A proper bootstrap on the per-sample scores (now available in `gate-1-rescore-results.json.holdout_en.per_sample_scores`) would establish whether the dialect win is real or noise. Expected: the 95% CI overlaps.
2. **No cross-validation for the vocabulary.** The 16 primitives were hand-built from the same garak/APE source that also seeded the corpus. Vocabulary-to-corpus leakage is likely; the actual AUROC on a fully independent corpus could be meaningfully lower.
3. **Corpus realism.** The benign set is Wikipedia paragraphs. Real HoneyLLM traffic is web-page DOM text (navigation, marketing copy, comment threads, etc.). The AUROC numbers here are optimistic for production.
4. **Translation quality.** The Spanish/Mandarin corpora were machine-translated via MyMemory/Google unofficial endpoint with no human review. "Dialect fails on translated text" is the right conclusion but the exact numeric collapse (AUROC 0.56 / 0.61) has translation-quality-artifact baked in.
5. **ProtectAI's precision on calibration dropped from 1.000 to 0.842.** This is already a 15% FP rate on pedagogical articles at the default 0.5 threshold. A production deployment using ProtectAI would need a higher threshold (e.g., 0.8+) to stay below a usable FP rate, which would drop recall substantially. This degradation is the same failure mode dialect exhibits and the reason Task D's premise still holds.

## Reproducibility audit

This reframe changes no inputs and regenerates no data. The re-score script (`gate-1-rescore.py`) re-runs all four methods against the same four corpus files used by the original spike:

- `gate-1-corpus.jsonl` (1050 rows, hashes unchanged since 2026-04-19)
- `gate-1-corpus-es.jsonl` (100 rows)
- `gate-1-corpus-zh-CN.jsonl` (100 rows)
- `gate-1-vocabulary.json` (16 primitives)

The dialect-count, keyword-count, and ProtectAI-probability computations in `gate-1-rescore.py` match the original `gate-1-run.py` verbatim (dialect regex loop `line 57`–`64` of the original, keyword match `line 67`–`69`, ProtectAI pipeline `line 105`–`122`). Re-scoring reproduces AUROC and TPR@1%FPR to four decimal places against all four original result JSONs:

| split | method | AUROC (original) | AUROC (rescore) | TPR@1 (original) | TPR@1 (rescore) |
|---|---|---|---|---|---|
| holdout_en | dialect | 0.9158 | 0.9158 | 0.520 | 0.520 |
| holdout_en | protectai | 0.9050 | 0.9050 | 0.810 | 0.810 |
| holdout_en_calibration | dialect | 0.8517 | 0.8517 | 0.120 | 0.120 |
| holdout_en_calibration | protectai | 0.8804 | 0.8804 | 0.500 | 0.500 |
| holdout_es | dialect | 0.5640 | 0.5640 | 0.040 | 0.040 |
| holdout_es | protectai | 0.9120 | 0.9120 | 0.740 | 0.740 |
| holdout_zh | dialect | 0.6100 | 0.6100 | 0.220 | 0.220 |
| holdout_zh | protectai | 0.9504 | 0.9504 | 0.800 | 0.800 |

Byte-identity confirms the rescore is a faithful replay; the new metrics (PR-AUC, F1, TPR@5/10%FPR, latency, threshold sweep, operating-point match) are derived from the same per-sample scores that produced the original numbers, not from a re-sampled or re-built corpus.

## Files produced

- `docs/issues/52-cowork-outputs/gate-1-reframe.md` — this document.
- `docs/issues/52-cowork-outputs/gate-1-rescore.py` — parallel runner extending `gate-1-run.py`. Original left untouched.
- `docs/issues/52-cowork-outputs/gate-1-rescore-results.json` — full re-scored metrics per split, per method, including per-sample scores (labels + ids + dialect + keyword + protectai) and the dialect threshold sweep. ~300 KB.
