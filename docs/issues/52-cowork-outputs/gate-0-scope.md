# Gate 0 — Scope lock

Refs #52 gate 0.

## Pass/kill check

Gate 0 is definitional. No kill criterion. **Result: PASS.**

## Deviations from brief

The original cowork environment lacked network access and could not reach HuggingFace, garak, or translation APIs. Cowork was killed and Gates 0–2 are being re-run in a full-tooling environment (this session). This document is a rewrite of cowork's Gate 0 draft; the one substantive change is dropping the "read-only sandbox" caveats and the "queued comments for human to post" section — the operator here runs commits and posts issue comments directly.

## 1. Working label

- **Internal label:** `dialect` — the hypothesis is that prompt-injection text forms a recurring dialect (primitive vocabulary + grammar) recoverable by translation.
- **External label:** `injection register` — register is the accepted linguistics term for a situation-bound language variety; it sits closer to the "Say It Differently" framing (arXiv 2511.10519) and avoids cultural baggage "dialect" carries.

## 2. Angle sequencing

Angle 1 (dialect-translation) is tested first at Gate 1. Angle 2 (contract-of-awareness) is tested at Gate 2 **only if** Gate 1 passes.

Reasoning, in order of weight:

1. **Tooling asymmetry.** Angle 1 has a primitive-vocabulary seed (HiddenLayer APE taxonomy) and a labelled injection corpus (garak PromptInject probe). Angle 2 has no labelled corpus; the grounded/fabricated pairs must be hand-constructed.
2. **Dependency risk.** If Angle 1 dies, Angle 2 inherits the same circularity concern the investigation flagged. Investing in Angle 2 before knowing whether Angle 1 survives spends effort on a calibration layer for a signal that may not exist.
3. **Cheaper kill.** Gate 1 can be killed in one day with a held-out test against an existing baseline classifier. Gate 2 has no off-the-shelf baseline.

If Gate 1 KILLs, Gate 2 is skipped and Angle 2 is deferred to post-cowork human review.

## 3. Kill criteria

### Gate 1

- **Kill:** dialect classifier < keyword baseline on *either* monolingual OR translated set.
- **Pass (strongest):** dialect ≈ keyword on monolingual but ≫ on translated set. (Primitives buy paraphrase invariance specifically.)
- **Pass (standard):** dialect ≥ ProtectAI monolingual AND ≥ 80% recall on translated set.
- **Ambiguous:** treat as KILL.

Metric: TPR @ 1% FPR on each of three sets (monolingual, Spanish, Mandarin).

### Gate 2

- **Kill:** AUC < 0.7 on the 50-pair set.
- **Pass:** AUC ≥ 0.7 AND calibration check (dialect-positive-but-grounded negatives score lower than dialect-positive-and-fabricated) shows expected separation.
- **Ambiguous:** treat as KILL.

## 4. Out-of-scope

Explicitly excluded across Gates 0–2:

- Any edit inside `src/`, `scripts/`, `dist/`, or `package.json`.
- Any edit under `docs/testing/` (canonical audit files).
- Loading, reloading, or running the HoneyLLM extension.
- On-device probe work on Gemini Nano, Gemma-2-2b, or MLC WebLLM models.
- Opening or scoping Gate 3 (on-device Option A spike).
- Expanding into linked issues #6, #48, or #51.
- Dependency additions to the repo's `package.json`. The experiment's Python env lives at `/tmp/gate1-venv` (scratch, outside the repo).

## 5. Budget

- **Hard ceiling:** 5 cowork-days across Gates 0–2.
- **Soft per-gate cap:** 2 days.
- **Gate 0:** ≤ 30 minutes (this document).
- **Gate 1:** target 1 day, cap 2.
- **Gate 2:** target 1 day, cap 2.

## 6. Communication protocol

- **Gate start:** post comment on #52 — `Starting Gate N — target completion YYYY-MM-DD.`
- **Gate end:** post comment on #52 — `Gate N result: PASS | KILL. Artefact: <path>. Next action: <explicit next step>.`
- **Mid-gate surprise or blocker:** post comment describing the finding.
- **Tag @JimmyCapps:** only on KILL or blocker.
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
