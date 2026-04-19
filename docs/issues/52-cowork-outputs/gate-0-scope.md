# Gate 0 — Scope lock

Refs #52 gate 0.

## Changelog

- **2026-04-19:** retired ambiguous-KILL rule; added production-metrics requirement; added hypothesis-precision check; expanded budget to 10 cowork-days.

## Pass/kill check

Gate 0 is definitional. No kill criterion. **Result: PASS.**

## Deviations from brief

The original cowork environment lacked network access and could not reach HuggingFace, garak, or translation APIs. Cowork was killed and Gates 0–2 are being re-run in a full-tooling environment (this session). This document is a rewrite of cowork's Gate 0 draft; the one substantive change is dropping the "read-only sandbox" caveats and the "queued comments for human to post" section — the operator here runs commits and posts issue comments directly.

## 1. Working label

- **Internal label:** `dialect` — the hypothesis is that prompt-injection text forms a recurring dialect (primitive vocabulary + grammar) recoverable by translation.
- **External label:** `injection register` — register is the accepted linguistics term for a situation-bound language variety; it sits closer to the "Say It Differently" framing (arXiv 2511.10519) and avoids cultural baggage "dialect" carries.

## 2. Angle sequencing

Angle 1 (dialect-translation) is tested first at Gate 1. Angle 2 (contract-of-awareness) is tested at Gate 2 **only if** Gate 1 passes (or the human explicitly greenlights after an AMBIGUOUS Gate 1 — see §3 revision below).

Reasoning, in order of weight:

1. **Tooling asymmetry.** Angle 1 has a primitive-vocabulary seed (HiddenLayer APE taxonomy) and a labelled injection corpus (garak PromptInject probe). Angle 2 has no labelled corpus; the grounded/fabricated pairs must be hand-constructed.
2. **Dependency risk.** If Angle 1 dies, Angle 2 inherits the same circularity concern the investigation flagged. Investing in Angle 2 before knowing whether Angle 1 survives spends effort on a calibration layer for a signal that may not exist.
3. **Cheaper kill.** Gate 1 can be killed in one day with a held-out test against an existing baseline classifier. Gate 2 has no off-the-shelf baseline.

If Gate 1 KILLs, Gate 2 is skipped and Angle 2 is deferred to post-cowork human review. If Gate 1 is AMBIGUOUS, Gate 2 is held until the human resolves.

## 3. Kill criteria

### 3.0 History — original criteria (preserved for audit)

The original cowork brief treated ambiguous results as auto-KILL. This subsection preserves the original wording. See §3.1 for the 2026-04-19 revision that supersedes it.

**Gate 1 (original):**

- **Kill:** dialect classifier < keyword baseline on *either* monolingual OR translated set.
- **Pass (strongest):** dialect ≈ keyword on monolingual but ≫ on translated set. (Primitives buy paraphrase invariance specifically.)
- **Pass (standard):** dialect ≥ ProtectAI monolingual AND ≥ 80% recall on translated set.
- **Ambiguous:** treat as KILL.

Metric: TPR @ 1% FPR on each of three sets (monolingual, Spanish, Mandarin).

**Gate 2 (original):**

- **Kill:** AUC < 0.7 on the 50-pair set.
- **Pass:** AUC ≥ 0.7 AND calibration check (dialect-positive-but-grounded negatives score lower than dialect-positive-and-fabricated) shows expected separation.
- **Ambiguous:** treat as KILL.

### 3.1 2026-04-19 revision (supersedes §3.0)

Rationale: the "ambiguous = KILL" rule was intended to prevent runaway research but tilted too far toward false-negative closures. Gate 1's initial run produced a meaningful positive result (dialect AUROC 0.916 beat ProtectAI 0.905 on monolingual English — remarkable for 16 regexes vs a fine-tuned transformer) that the old rule would have buried. Prefer explicit human-in-the-loop for ambiguous outcomes.

**General rule (all gates):** ambiguous results → document findings, surface to human, do NOT unilaterally kill. Continue only with human confirmation. Kill criteria must be crisp, pre-declared, and hit explicitly.

**Gate 1 (revised):**

- **Kill:** dialect classifier < keyword baseline on *either* monolingual OR translated set, measured by the headline metric (TPR@1%FPR) AND not reversed by the compute-adjusted metric (detection-quality-per-ms).
- **Pass (strongest):** dialect ≈ keyword on monolingual but ≫ on translated set.
- **Pass (standard):** dialect ≥ ProtectAI monolingual AND ≥ 80% recall on translated set, with the compute-adjusted metric favouring dialect.
- **Ambiguous:** neither kill nor pass conditions hit explicitly, or the headline metric and compute-adjusted metric disagree on ordering. Document the full metric panel, tag `@JimmyCapps`, wait for direction.

**Gate 2 (revised):**

- **Kill:** AUROC < 0.7 on the 50-pair set.
- **Pass:** AUROC ≥ 0.7 AND calibration check shows expected separation AND the full metric panel does not reveal a degenerate operating region.
- **Ambiguous:** AUROC between 0.6–0.7, or calibration partial, or headline vs. full-panel disagreement. Surface to human, do not kill.

**Production-metrics panel (applies to all detection-oriented gates):**

- **AUROC** — threshold-free ranking quality.
- **PR-AUC** — more informative than AUROC when positive class is rare or the operating point of interest is low-FPR.
- **TPR at {1%, 5%, 10%} FPR** — three operating points, not one.
- **F1 at optimal threshold** — with the threshold itself reported.
- **Detection-quality-per-ms-of-inference** — for classifier comparisons. HoneyLLM's on-device constraint means a 16-regex classifier that hits 0.92 AUROC at microsecond latency may be more valuable than a fine-tuned transformer at ~200ms/sample, even if absolute TPR@1%FPR is lower. Metrics must reflect deployment reality. Measure latency on CPU, single-threaded, batch size 1; report median and p95.

**Hypothesis-precision check (mandatory pre-flight for every gate):**

Before execution, verify:

- The experiment tests *the stated hypothesis*, not a stricter form.
- The operationalization does not introduce confounds that make a negative result uninterpretable.
- If the hypothesis has a scope qualifier (e.g. "per-language", "paraphrase-invariant"), the experiment respects it.

Worked example from Gate 1: the hypothesis was "primitives are paraphrase-invariant"; the experiment tested "English regex is paraphrase-invariant across translation" — strictly stronger. Per-language vocabulary packs are the correct test of the actual hypothesis and are the subject of follow-up Task B.

Record the check result at the top of each gate's deliverable before proceeding.

## 4. Out-of-scope

Explicitly excluded across Gates 0–2 and follow-up tasks A/B/C/D/E:

- Any edit inside `src/`, `scripts/`, `dist/`, or `package.json`.
- Any edit under `docs/testing/` (canonical audit files).
- Loading, reloading, or running the HoneyLLM extension.
- On-device probe work on Gemini Nano, Gemma-2-2b, or MLC WebLLM models.
- Opening or scoping Gate 3 (on-device Option A spike).
- Expanding into linked issues #6, #48, or #51.
- Dependency additions to the repo's `package.json`. The experiment's Python env lives at `/tmp/gate1-venv` (scratch, outside the repo).

## 5. Budget

- **Hard ceiling:** expanded from 5 to 10 cowork-days given the initial Gate 1 produced a mixed-signal result worth following up.
- **Soft per-gate cap:** 2 days. Gates exceeding 2 days still require human check-in.
- **Gate 0:** ≤ 30 minutes (this document).
- **Gate 1:** target 1 day, cap 2.
- **Gate 2:** target 1 day, cap 2.
- **Follow-up tasks (A/B/C/D/E):** see the brief's §"Follow-up gates (post-Gate-1-reframe)" table. Total follow-up budget fits within the 10-day ceiling.

## 6. Communication protocol

- **Gate start:** post comment on #52 — `Starting Gate N — target completion YYYY-MM-DD.`
- **Gate end (pass or kill):** post comment on #52 — `Gate N result: PASS | KILL. Artefact: <path>. Next action: <explicit next step>.`
- **Gate end (ambiguous):** post comment on #52 tagged `@JimmyCapps` with the full metric panel, hypothesis-precision check outcome, and a recommended next action. Do NOT kill unilaterally. Do NOT close the issue.
- **Mid-gate surprise or blocker:** post comment describing the finding.
- **Tag @JimmyCapps:** on KILL, on AMBIGUOUS, or on blocker.
- **Issue closure:** never performed by the gate runner. Human decides.

## 7. Output tree

```
docs/issues/
├── 52-cowork-stage-gates.md          (brief; authoritative)
└── 52-cowork-outputs/
    ├── gate-0-scope.md               (this file)
    ├── gate-1-dialect-spike.md       (Gate 1 deliverable)
    ├── gate-1-vocabulary.json        (primitive vocabulary)
    ├── gate-1-corpus.jsonl           (held-out eval set)
    ├── gate-1-run.py                 (experiment script)
    ├── gate-1-results.json           (raw metrics)
    ├── gate-2-contract-spike.md      (only if Gate 1 passes)
    └── gate-2-pairs.jsonl            (only if Gate 1 passes)
```
