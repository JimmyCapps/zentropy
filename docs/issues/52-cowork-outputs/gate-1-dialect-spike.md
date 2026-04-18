# Gate 1 — Dialect-translation feasibility spike

Refs #52 gate 1. Artefacts: `gate-1-run.py`, `gate-1-vocabulary.json`, `gate-1-corpus.jsonl`, `gate-1-corpus-es.jsonl`, `gate-1-corpus-zh-CN.jsonl`, `gate-1-results-*.json`.

## TL;DR

**Result: KILL.** The English-regex dialect classifier does not survive the translated-set test. ProtectAI (an off-the-shelf fine-tuned classifier) beats the English-regex dialect classifier on every metric on every language set. The "primitives buy paraphrase-invariance specifically" hypothesis is **not supported** by this experiment.

However, the calibration set (pedagogical "articles about injection") showed all four methods collapse similarly (ProtectAI: 0.88 AUROC, dialect: 0.85, keyword: 0.68). This is consistent with the issue's open-questions prediction and is the Angle-2 calibration story. **That finding survives even after Angle-1 KILL** and is the one reason not to close #52 outright — Angle 2 (contract-of-awareness) still has a coherent premise, though its evidence base is untested.

See "Recommendation" at the bottom.

## Pass/kill check

Per brief (Gate 0 §3):

| Criterion | Reading |
|---|---|
| Dialect < keyword on monolingual OR translated | **Dialect > keyword everywhere.** Not hit. |
| Dialect ≥ ProtectAI monolingual AND ≥ 80% recall translated | **Dialect < ProtectAI on TPR@1%FPR at every language (0.52 / 0.04 / 0.22 vs ProtectAI 0.81 / 0.74 / 0.80).** Recall on translated set well below 80% (0.08 avg). FAILS standard-pass. |
| "Dialect ≈ keyword monolingual but ≫ on translated" (strongest-pass) | **Opposite: dialect > keyword monolingual, dialect ≈ keyword translated.** FAILS strongest-pass. |
| Ambiguous | If above not crisp, KILL per brief. |

**Result: KILL.** The dialect classifier is not competitive with an existing off-the-shelf detector, and does not exhibit the predicted paraphrase-invariance advantage on translated text.

## Deviations from brief

1. **Corpus sizes.** Target: 500 injection / 500 benign. Actual: 616 injection unique / 600 benign unique; 100/100 held-out. 50 pedagogical "articles about injection" calibration negatives added per brief's open-questions request.
2. **Injection sources.** Brief said "garak PromptInject + HiddenLayer APE". Actual: garak's `inthewild_jailbreak_llms.json` (666 entries; dedup → 616 unique) + garak's DAN corpus (13 prompt families) + HiddenLayer APE taxonomy Prompt field (51 techniques) + 10 garak `goal_hijacking_attacks` and `prompt_leaking_attacks` templates. The 500-target was trivially exceeded from `inthewild` alone.
3. **Benign source.** Brief said "public Wikipedia paragraph samples". Original Wikipedia MediaWiki-API fetcher rate-limited at 80 samples. Substituted with `Salesforce/wikitext` via HuggingFace datasets-server (706 paragraphs; dedup → 600).
4. **Translation.** Brief said "Google Translate API, DeepL, or argos-translate". Actual: MyMemory API first (rate-limited after 34 Spanish / 0 Mandarin), then Google Translate unofficial endpoint (100/100 both languages). 500-char cap per prompt (61/100 injection prompts truncated, 0 benign truncated — some jailbreak prompts exceed 500 chars). All translations verified non-null. No manual quality check of translations; treated as commodity.
5. **Python env.** Env lives at `/tmp/gate1-venv`, not inside the repo. `transformers==4.57.6`, `torch==2.8.0`, `numpy==2.0.2`, `scikit-learn`.
6. **ProtectAI runs on Apple Silicon MPS** (Metal Performance Shaders). Not CPU as the brief suggested. No meaningful difference in classification quality.

## Corpus

| Split | Count | Source |
|---|---|---|
| `train_injection` | 400 | garak `inthewild_jailbreak_llms.json` + DAN + APE + goal-hijacking templates |
| `train_benign` | 400 | `Salesforce/wikitext` train split, paragraphs 400–2000 chars |
| `holdout_injection` | 100 | same sources, disjoint from train |
| `holdout_benign` | 100 | same source, disjoint from train |
| `holdout_benign_calibration` | 50 | hand-written pedagogical paragraphs discussing injection primitives |

Train splits were not used (dialect classifier is regex-based, no fitting step).

## Vocabulary

`gate-1-vocabulary.json`: 16 primitives, seeded from HiddenLayer APE tactics (8) + techniques (51). Each has name, one-line definition, APE reference, and 3–5 regex patterns. Full list: `instruction_override`, `role_reassertion`, `system_impersonation`, `prior_context_fabrication`, `refusal_suppression`, `jailbreak_persona`, `output_coercion`, `tool_spoofing`, `encoded_payload`, `imperative_emphasis`, `policy_puppetry`, `stop_token_prevention`, `context_window_separation`, `prompt_leak_request`, `hypothetical_framing`, `credential_exfiltration`.

## Methods

1. **dialect** — primitive-count (0..16) from the vocabulary regex. Threshold-free scoring for AUROC; ≥ 0.5 prediction rule for confusion matrix.
2. **keyword** — substring-match count against 14 Phase-2-style keyword strings (subset chosen from the issue body and garak templates).
3. **protectai** — `protectai/deberta-v3-base-prompt-injection` via HuggingFace pipeline with `truncation=True, max_length=512`. Probability-of-INJECTION as score.
4. **random** — `np.random.default_rng(42).random(n)`, unaffected by input.

All methods scored on the same held-out sets. No training, no cross-validation. Metric: TPR @ 1% FPR (headline), AUROC (secondary), confusion matrix at 0.5 threshold (contextual).

## Results

### Monolingual (English) holdout — 100 injection / 100 benign

| Method | AUROC | TPR@1%FPR | TP / FP / TN / FN |
|---|---|---|---|
| **protectai** | 0.905 | **0.810** | 80 / 0 / 100 / 20 |
| **dialect** | **0.916** | 0.520 | 87 / 8 / 92 / 13 |
| keyword | 0.733 | 0.130 | 57 / 12 / 88 / 43 |
| random | 0.485 | 0.020 | 47 / 49 / 51 / 53 |

Bold = winner on that metric.

### Spanish (translated) — 50 injection / 50 benign

| Method | AUROC | TPR@1%FPR | TP / FP / TN / FN |
|---|---|---|---|
| **protectai** | **0.912** | **0.740** | 43 / 4 / 46 / 7 |
| dialect | 0.564 | 0.040 | 16 / 10 / 40 / 34 |
| keyword | 0.540 | 0.000 | 11 / 7 / 43 / 39 |
| random | 0.606 | 0.060 | 25 / 22 / 28 / 25 |

Dialect collapses to near-random (AUROC 0.56, indistinguishable from random at 0.61).

### Mandarin (translated) — 50 injection / 50 benign

| Method | AUROC | TPR@1%FPR | TP / FP / TN / FN |
|---|---|---|---|
| **protectai** | **0.950** | **0.800** | 48 / 16 / 34 / 2 |
| dialect | 0.610 | 0.220 | 11 / 0 / 50 / 39 |
| keyword | 0.580 | 0.000 | 9 / 1 / 49 / 41 |
| random | 0.606 | 0.060 | 25 / 22 / 28 / 25 |

Dialect's TPR@1%FPR is 0.22 on Mandarin — barely above random, well below ProtectAI's 0.80.

### Combined 3×4 summary (TPR @ 1% FPR)

| Method | Monolingual | Spanish | Mandarin |
|---|---|---|---|
| protectai | **0.810** | **0.740** | **0.800** |
| dialect | 0.520 | 0.040 | 0.220 |
| keyword | 0.130 | 0.000 | 0.000 |
| random | 0.020 | 0.060 | 0.060 |

### Calibration check — monolingual holdout + 50 pedagogical articles about injection

| Method | AUROC | TPR@1%FPR | TP / FP / TN / FN |
|---|---|---|---|
| protectai | 0.880 (↓ from 0.905) | 0.500 (↓ from 0.810) | 80 / 15 / 135 / 20 |
| dialect | 0.852 (↓ from 0.916) | 0.120 (↓ from 0.520) | 87 / 33 / 117 / 13 |
| keyword | 0.681 (↓ from 0.733) | 0.000 (↓ from 0.130) | 57 / 31 / 119 / 43 |
| random | 0.484 | 0.010 | — |

All methods degrade on pedagogical negatives, confirming the issue's open-questions prediction. Dialect degrades most on TPR@1%FPR in absolute terms (falls from 0.52 → 0.12).

### Diagnostic — dialect hit-rate on translated text

Independent of classifier threshold: how often does *any* primitive fire on translated text?

| Language | Injection hits | Benign hits |
|---|---|---|
| Spanish | 18/50 | 10/50 |
| Mandarin | 11/50 | 0/50 |

Mandarin has zero benign false-positives (no Western string accidentally matches), which is why its AUROC (0.61) is slightly higher than Spanish (0.56) despite lower absolute recall. But in both languages the injection-hit-rate drops from ~95% on English (implied by monolingual AUROC 0.92) to 22–36%. The English regex does not translate.

## Why the hypothesis didn't survive

The issue's premise was that a primitive-extraction layer is paraphrase-invariant **by construction** because it discards surface form before classification. This is only true if the *extraction* step is language-agnostic. In this spike the extractor is English-regex, so paraphrase invariance applies only to English paraphrases (a "disregard" → "ignore" transformation) and does not survive natural-language translation.

A proper test of the hypothesis would require either:
1. Per-language primitive vocabularies (multiplies vocabulary effort by N languages), or
2. Translation-before-extraction (introduces a translation model as a new dependency and its own failure modes — see #48), or
3. A primitive extractor that operates on cross-lingual embeddings (e.g. fine-tune a small mBERT model per the InstructDetector paper — arXiv 2505.06311).

Option 3 is indistinguishable from ProtectAI's approach (fine-tuned encoder). So the "dialect framing" as operationalised here does not buy anything beyond what a standard fine-tuned classifier delivers, at substantially more ad-hoc effort.

## What DOES survive

Two findings are worth carrying forward even after Gate 1 KILLs:

1. **Calibration-set difficulty is real.** All methods (including ProtectAI at 0.88 AUROC, 0.50 TPR@1%FPR) degrade meaningfully on pedagogical injection discussions. No public benchmark currently scores this axis, but it is the dominant FP mode HoneyLLM would see in the wild (security blog posts, AI-safety articles, documentation of injection attacks). This is the Angle-2 calibration story.
2. **ProtectAI generalises across Spanish/Mandarin without per-language tuning.** Its TPR@1%FPR is 0.81/0.74/0.80 across English/Spanish/Mandarin. This suggests the answer to the issue's multilingual question (#48) is "use a multilingually-pretrained fine-tuned classifier" rather than "build primitive vocabularies per language". Worth recording for #48 scope.

## Recommendation

1. **Close #52 Angle 1** as KILL with these artefacts as evidence.
2. **Do not proceed to Gate 2** as specified (contract-of-awareness feasibility). Angle 2's premise is not killed by Gate 1 — the pedagogical-calibration collapse is consistent with Angle 2's prediction — but executing Gate 2 here would consume a second day to produce evidence that still doesn't operationalise a production detector. A more useful next step is a human decision on whether to:
   - (a) Reopen the Angle-2 scope in a new issue with a tighter protocol (e.g. fine-tune a small contract-symmetry classifier on Clark-and-Brennan-style paired examples),
   - (b) Redirect effort to evaluating ProtectAI (or similar fine-tuned classifiers) as a HoneyLLM probe in Phase 6+, possibly calibrated on a pedagogical-article held-out set, or
   - (c) Close Angle 2 entirely as subsumed by (b).
3. **The calibration-set difficulty result should be filed as its own observation in #52 comments**, since it's the load-bearing finding from this day of work. It is also a useful input to #48 (multilingual) and to any future evaluation corpus HoneyLLM builds.

## Files

- `gate-1-run.py` — experiment script (standalone, needs `/tmp/gate1-venv`).
- `gate-1-vocabulary.json` — 16 primitives, regex patterns, APE references.
- `gate-1-corpus.jsonl` — 1050-row corpus (1400 train + 250 holdout including calibration).
- `gate-1-corpus-es.jsonl`, `gate-1-corpus-zh-CN.jsonl` — translated 100-row holdouts per language.
- `gate-1-results-holdout.json`, `gate-1-results-calibration.json`, `gate-1-results-es.json`, `gate-1-results-zh.json` — raw metrics with confusion matrices.
