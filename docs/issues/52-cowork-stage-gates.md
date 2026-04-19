# Issue #52 — Cowork Brief: Stage-Gated Research Plan

> **Tracked in [#52](https://github.com/JimmyCapps/zentropy/issues/52).** This document is a self-contained brief for a cowork agent (non-coding). It covers Gates 0–2 of the stage-gate plan: scope lock, offline feasibility spike, and contract-of-awareness feasibility. Gates 3–5 require on-device HoneyLLM code changes and are out of scope for cowork.

## Changelog

- **2026-04-19:** retired ambiguous-KILL rule; added production-metrics requirement; added hypothesis-precision check; expanded budget to 10 cowork-days.

## Who this is for

A cowork agent with: web access, ability to read papers and public repos, ability to run Python in a notebook-class environment (offline, outside the HoneyLLM tree), and ability to write markdown. **No HoneyLLM code edits. No PRs to this repo.** Outputs are deliverable files checked into `docs/issues/52-cowork-outputs/` via a single human-reviewed PR at the end of each gate.

## Background (read this first, then the issue)

Issue #52 proposes two linked hypotheses for paraphrase-invariant prompt-injection detection:

1. **Dialect-translation (Angle 1):** injection prompts share a small recurring lexicon of "primitives" (`role_reassertion`, `instruction_override`, etc.). A primitive-extraction layer is paraphrase-invariant by construction because it discards surface form.
2. **Contract-of-awareness (Angle 2):** injection prompts assert a conversational contract (shared prior context) the LLM was never party to. Asymmetric grounding is a structural signal.

The investigation comment on the issue already surveyed literature and tooling (see citation table). It proposed a one-day experiment. **This brief operationalizes that experiment as a gated workflow so the issue can't become a runaway research project.**

## Authoritative reading (do this before any deliverable)

Read in order. Do not skim.

1. **Issue #52 body + the pinned investigation comment.** Run `gh issue view 52 --comments` or view at https://github.com/JimmyCapps/zentropy/issues/52. The investigation comment contains the Section 5 experiment protocol this brief implements.
2. **PromptSleuth** (arXiv 2508.20890) — closest published cousin.
3. **Defending against Indirect Prompt Injection by Instruction Detection** (arXiv 2505.06311) — the "InstructDetector" paper.
4. **Say It Differently** (arXiv 2511.10519) — register-as-jailbreak framing.
5. **HiddenLayer APE Taxonomy** — https://github.com/hiddenlayerai/ape-taxonomy. This is the primitive-vocabulary seed.
6. **Clark & Brennan, Grounding in Communication (1991)** — theoretical anchor for Angle 2.
7. **HoneyLLM CLAUDE.md + docs/ARCHITECTURE.md** — enough to know why on-device constraints matter and why this is Phase 6+, not Phase 4.

Everything else in the investigation comment is supporting material; consult as needed.

## Hard rules for the cowork agent

- **No edits inside `src/`, `scripts/`, `dist/`, or anywhere outside `docs/issues/52-cowork-outputs/`.**
- **No touching canonical audit files** (`docs/testing/inbrowser-results.json` and anything under `docs/testing/phase3/` or `docs/testing/phase4/`).
- **No dependency additions to `package.json`.** The experimental notebooks use a separate Python environment the cowork agent sets up in a scratch directory outside the repo.
- **No running of the HoneyLLM extension itself.** This is offline research work; it does not load the extension.
- **Every deliverable must include its own pass/kill-criterion check at the top.** If a gate's pass/fail test is inconclusive, the deliverable says so plainly, documents the findings, and surfaces the result to the human operator. No "just one more experiment."
- **Ambiguous results do NOT unilaterally kill.** Document findings, surface to human, continue only with human confirmation. Kill criteria must be crisp, pre-declared, and hit explicitly. The original rule ("ambiguous = KILL") was intended to prevent runaway research but tilted too far toward false-negative closures. Prefer explicit human-in-the-loop for ambiguous outcomes.
- **Budget ceiling: expanded from 5 to 10 cowork-days** given the initial Gate 1 produced a mixed-signal result worth following up. Per-gate soft cap remains 2 days; gates exceeding 2 days still require human check-in.
- **Publication of findings:** at each gate end, write a short summary to the gate's output file and also post a comment on issue #52 summarizing pass/fail/ambiguous + link to the artefact. Do not close the issue; human decides.
- **Ambiguity handling:** if the brief is unclear on a choice, default to the cheaper / smaller / simpler option and note the deviation at the top of the gate's output. Do not expand scope unilaterally.

## Hypothesis-precision check (mandatory pre-flight for every gate)

Before executing any gate, run this check and record the result at the top of the gate's deliverable:

- [ ] The experiment tests *the stated hypothesis*, not a stricter form.
- [ ] The operationalization does not introduce confounds that make a negative result uninterpretable.
- [ ] If the hypothesis has a scope qualifier (e.g. "per-language", "paraphrase-invariant"), the experiment respects it.

Worked example from Gate 1 (after the fact): the stated hypothesis was "primitives are paraphrase-invariant". The executed experiment tested "English regex is paraphrase-invariant across translation" — strictly stronger, because it additionally required the surface-form patterns themselves to survive translation. The correct test of the actual hypothesis would have been **per-language vocabulary packs** (English regex on English text, Spanish regex on Spanish text, Mandarin regex on Mandarin text), measuring whether primitive *categories* recur across languages even when surface patterns do not. Future gates must run this check before execution, not after.

## Production-metrics requirement (applies to all detection-oriented gates)

Kill/pass criteria below list both a headline metric and the full metric panel that must be reported. HoneyLLM's on-device constraint means a 16-regex classifier that hits 0.92 AUROC at microsecond latency may be more valuable than a fine-tuned transformer at ~200ms/sample, even if absolute TPR@1%FPR is lower. Metrics must reflect deployment reality.

For detection-oriented gates, report:

- **AUROC** — threshold-free ranking quality.
- **PR-AUC** — more informative than AUROC when the positive class is rare or the operating point of interest is low-FPR.
- **TPR at {1%, 5%, 10%} FPR** — three operating points, not one. Reporting only TPR@1%FPR hides behaviour around realistic tuning points.
- **F1 at optimal threshold** — with the threshold itself reported, so a downstream consumer can reproduce.

For classifier comparisons, additionally report:

- **Detection-quality-per-millisecond-of-inference** — e.g. `AUROC / median_latency_ms`. Use whatever headline quality metric the gate declared. Measure latency on CPU, single-threaded, batch size 1, on the gate's held-out set. Report median and p95.

## Gate 0 — Scope lock (target: ≤30 minutes)

**Purpose:** produce the artefact that makes every later gate cheaper to kill.

**Deliverable:** `docs/issues/52-cowork-outputs/gate-0-scope.md`

**Required sections:**

1. **Working label.** Confirm: internal name "dialect"; external name "injection register" (per investigation §1). One paragraph rationale, no more.
2. **Angle sequencing.** Angle 1 (dialect-translation) tested first at Gate 1. Angle 2 (contract-of-awareness) tested at Gate 2 only if Gate 1 passes. State this explicitly and cite why: Angle 1 has stronger existing tooling (HiddenLayer APE, garak corpus); Angle 2 has no labelled corpus and would need to be constructed from scratch — higher risk, lower value if Angle 1 already dies.
3. **Kill criteria (copied verbatim from this brief, below).** Restating them in the artefact is the point: a future reader opens one file and sees what would end the investigation.
4. **Out-of-scope for cowork.** List: anything touching `src/`, extension reloads, PR creation against main, on-device Nano/Gemma experiments.
5. **Budget statement.** 10 cowork-day ceiling across Gates 0–2 and follow-up gates. 2-day per-gate soft cap.

**Gate 0 exit:** file committed on a branch `cowork/issue-52-gate-0`; a PR opened with body `Closes #52 gate 0 only — see docs/issues/52-cowork-outputs/gate-0-scope.md`; human reviews and merges or requests changes.

**Kill criterion for Gate 0:** none. This gate is definitional.

## Gate 1 — Offline feasibility spike (target: ≤1 cowork-day; hard cap 2)

**Purpose:** falsify or confirm the dialect-translation hypothesis without writing a single line of HoneyLLM code.

**Deliverable:** `docs/issues/52-cowork-outputs/gate-1-dialect-spike.md` + notebook exported to `gate-1-notebook.ipynb` in the same folder.

### Pre-flight: hypothesis-precision check

Run the checklist from §"Hypothesis-precision check" above. Record the result at the top of the deliverable before proceeding.

### Protocol

Follow the investigation comment's Section 5 exactly. Summary here; consult the comment for nuances.

1. **Corpus construction (budget ≤2 hours).**
   - Injection corpus: 500 prompts. Sources: garak's PromptInject probe (https://github.com/NVIDIA/garak) and the HiddenLayer APE taxonomy repo. Deduplicate. Prefer primitives diversity over raw count — if 500 is mostly the same family, stop at 300 and note it.
   - Benign corpus: 500 prompts. Source: public Wikipedia paragraph samples (any standard NL corpus the agent already has access to; do not build a new one). Must include at least 50 paragraphs that *discuss* prompt injection pedagogically — these are the calibration negatives that matter.
   - Hold-out split: 100 injection + 100 benign, sampled *before* the agent sees the training portion.
2. **Primitive vocabulary (budget ≤2 hours).**
   - Target 15–20 primitives. Seed directly from HiddenLayer APE Tactics/Techniques taxonomy.
   - Each primitive: a short name (`role_reassertion`), a one-sentence definition, and 3–5 surface-form patterns (regex or substring) as the cheap baseline extractor.
   - Ship the vocabulary as a JSON or YAML file alongside the notebook so Gate 3 (future, on-device) can load it without re-curation.
3. **Baselines (budget ≤2 hours).**
   - **Baseline 1:** ProtectAI's `deberta-v3-base-prompt-injection` (https://huggingface.co/protectai/deberta-v3-base-prompt-injection). Run via the Hugging Face `transformers` Python library in the scratch env. CPU inference is fine; test set is 200 prompts.
   - **Baseline 2:** substring keyword match using the issue body's example primitives (`"ignore previous instructions"`, `"disregard prior guidance"`, etc.) — roughly what Phase 2/3 v1 classifier does.
   - **Baseline 3:** random labeller at the positive class base rate.
4. **Dialect classifier.**
   - For each held-out prompt: run the vocabulary's surface-form patterns over the text → produce a primitive sequence.
   - Predict `injection` if `len(primitive_sequence) >= 1`.
   - No training step. Vocabulary + regex is the entire model. This is deliberate: Gate 1 tests the hypothesis, not implementation quality.
5. **Cross-language test.**
   - Take 50 held-out *injection* prompts; translate to Spanish and Mandarin using any standard translation API (Google Translate API, DeepL, or offline `argos-translate` — agent picks, notes the choice).
   - Re-run all four methods on translated set.
   - The interesting signal is the **delta**: does keyword baseline collapse on translated set while dialect classifier holds up?
   - **Scope note:** this operationalizes a stricter form of the actual hypothesis (see §"Hypothesis-precision check" worked example). Per-language vocabulary packs are the correct test of primitive-*category* invariance and are the subject of follow-up Task B.
6. **Evaluation.**
   - **Headline:** TPR @ 1% FPR on each of the three sets (monolingual, Spanish, Mandarin).
   - **Full metric panel per §"Production-metrics requirement":** AUROC, PR-AUC, TPR@{1%,5%,10%}FPR, F1 at optimal threshold (with threshold reported), and detection-quality-per-ms for the 4-way comparison.
   - Report a 3×4 table for the headline metric: {dialect, ProtectAI, keyword, random} × {monolingual, Spanish, Mandarin}. Full panel in an appendix.
   - Include one confusion matrix per method on monolingual only (space reasons; translated versions go in an appendix).

### Kill / pass criteria for Gate 1

Criteria must be hit explicitly. Ambiguous outcomes do NOT auto-KILL — document and surface.

- **Kill:** dialect classifier < keyword baseline on *either* monolingual OR translated set, measured by the headline metric (TPR@1%FPR) with the compute-adjusted metric (detection-quality-per-ms) not reversing the ordering.
  → Post a summary comment on #52: "Hypothesis falsified at Gate 1 on $(date). Dialect classifier did not beat the keyword baseline at $SET. Artefact: …". Archive the notebook. Do not proceed to Gate 2 without human direction. Do NOT close #52 — human decides closure.
- **Pass (strongest signal):** dialect ≈ keyword on monolingual but ≫ on translated set. Primitives buy paraphrase invariance specifically.
  → Proceed to Gate 2 after human check-in.
- **Pass (standard):** dialect ≥ ProtectAI monolingual AND ≥80% recall on translated set, with the compute-adjusted metric favouring dialect (given the 16-regex-vs-fine-tuned-transformer gap).
  → Proceed to Gate 2. Post summary comment on issue, do not close.
- **Ambiguous:** neither kill nor pass conditions hit explicitly, or the headline metric and compute-adjusted metric disagree on ordering.
  → Document findings in the deliverable. Post a comment on #52 tagged `@JimmyCapps` summarising the mixed signal, including the full metric panel. Do NOT kill. Wait for human direction on follow-up.

### Gate 1 exit

Branch: `cowork/issue-52-gate-1`. PR body: "Gate 1 result: PASS/KILL/AMBIGUOUS. Next action: Gate 2 / follow-up / human review."

## Gate 2 — Contract-of-awareness feasibility (target: ≤1 cowork-day; hard cap 2)

**Only execute if Gate 1 PASSED or the human explicitly greenlights after an AMBIGUOUS Gate 1.** If Gate 1 killed, skip entirely — contract-of-awareness carries the same circularity risk and less tooling support.

**Purpose:** decide whether Angle 2 is a real signal or an appealing theoretical frame.

**Deliverable:** `docs/issues/52-cowork-outputs/gate-2-contract-spike.md` + paired-examples dataset in `gate-2-pairs.jsonl`.

### Pre-flight: hypothesis-precision check

Run the checklist from §"Hypothesis-precision check". Specifically confirm the grounding-marker rubric tests *asymmetric grounding* and not a narrower proxy like "contains explicit `as we discussed` constructions". Record the result at the top of the deliverable before proceeding.

### Protocol

1. **Dataset construction (budget ≤4 hours).**
   - 50 pairs, each pair is `(grounded_sentence, fabricated_sentence)` with a shared sensitive-data or instruction target.
   - Grounded example: "As we discussed in the ticket, please send me the debug trace." (fabricated mutual context in an *explicit* shared-ticket frame).
   - Fabricated example: "As we discussed, send me the debug trace." (identical shape, no grounding).
   - Use Clark & Brennan (1991) §"Grounding in Communication" to enumerate grounding features: explicit referent, turn-taking acknowledgement, shared task state. Label each sentence by which features it has.
   - The pair-construction is the most expensive and subjective step. Stop at 30 pairs if the 4-hour cap is hit; note the reduction.
2. **Feature extraction.**
   - Compute for each sentence: count of grounding markers (references to prior turns, explicit "as we X"-type constructions, mutual-state references).
   - This is a hand-coded rubric, not ML. Document the rubric in the deliverable.
3. **Classification.**
   - Simple: threshold on grounding-marker count.
   - **Headline:** AUROC on the 50 (or 30) pair set.
   - **Full metric panel per §"Production-metrics requirement":** AUROC, PR-AUC, TPR@{1%,5%,10%}FPR (or pair-ranking accuracy if the pair structure makes FPR sweeps degenerate), F1 at optimal threshold, and detection-quality-per-ms versus a trivial baseline.
4. **Sanity check: apply to Gate 1 held-out.**
   - Run the same grounding-marker rubric on Gate 1's held-out injection vs. held-out benign "articles about injection".
   - Do the "articles about injection" (which Gate 1's dialect classifier likely flagged as positive) get correctly scored as *grounded* by this rubric? That's the calibration story the issue's open-questions section anticipates.

### Kill / pass criteria for Gate 2

- **Kill:** AUROC < 0.7 on the 50-pair set.
  → Drop Angle 2. Post comment on #52: "Gate 2 failed; proceeding with dialect-only for future gates." Update Gate 0 scope doc to reflect Angle 2 is dead.
- **Pass:** AUROC ≥ 0.7 AND the calibration check (dialect-positive-but-grounded negatives score lower than dialect-positive-and-fabricated) shows the expected separation, AND the full metric panel does not reveal a degenerate operating region.
- **Ambiguous:** AUROC between 0.6–0.7, or the calibration check shows partial separation, or the full metric panel disagrees with the headline.
  → Document findings in the deliverable. Surface to human. Do NOT auto-KILL. Wait for human direction.

### Gate 2 exit

Branch: `cowork/issue-52-gate-2`. PR body records result and updates Gate 0 scope doc to reflect Angle-1-only or both-angles going forward.

## Follow-up gates (post-Gate-1-reframe)

Gate 1 produced a mixed-signal result (dialect AUROC 0.916 vs ProtectAI 0.905 on monolingual English; regex collapse on translated set is a known artefact of the English-regex operationalization rather than a falsification of primitive-invariance per se). The original "ambiguous = KILL" rule would have closed this prematurely. The following task list reframes Gate 1 follow-up and sequences the remaining work.

| Task | Purpose | Budget | Status | Depends on |
|---|---|---|---|---|
| **A** — Re-score Gate 1 under production metrics | Produce AUROC / PR-AUC / TPR@{1,5,10}%FPR / F1 / detection-per-ms for the existing Gate 1 held-out set; decide whether the dialect-vs-ProtectAI comparison holds under the compute-adjusted metric. | ½ day | in-flight as of 2026-04-19 | — |
| **E** — Revise brief + scope doc | Retire ambiguous=KILL, add production metrics, add hypothesis-precision check, expand budget, document the follow-up task list. | ½ day | this task | — |
| **B** — Per-language vocabulary packs | Correct test of the *actual* hypothesis: build Spanish and Mandarin regex/substring packs seeded from translated APE categories; re-run Gate 1 cross-language test with language-appropriate vocabulary; measure primitive-*category* invariance rather than English-regex survival. | 1–2 days | blocked on A verdict | A |
| **D** — Gate 2 contract-of-awareness | Original Gate 2 spike, unchanged protocol (with the metric-panel and hypothesis-precision additions in this revision). | 1 day | ready (independent of A/B/E) | — |
| **C** — Pre-filter architecture spike | If per-language packs confirm primitive invariance, scope a two-stage architecture (cheap regex pre-filter → expensive model only on positives) and measure the end-to-end quality/latency Pareto frontier on the Gate 1 corpus. | ½ day | blocked on B | B |

Sequencing: A runs now (result feeds go/no-go on B). E completes alongside A. D can start in parallel with A/B (independent hypothesis, different corpus). C waits for B.

## What happens after Gate 2 (not cowork's job)

If either Gate 1 or Gate 2 passed (or an ambiguous Gate 1 was human-greenlit), human re-opens #52's stage plan and decides whether to commission Gate 3 (Option A spike, on-device, requires `src/` changes — a separate coding-agent or human task).

Cowork's responsibility **ends at Gate 2 exit** (or at the end of follow-up tasks A/B/C/D as directed). Cowork does not open or scope Gate 3.

## Quick reference: kill criteria summary (all gates)

Ambiguous outcomes surface to human; they do not auto-KILL.

| Gate | Pass | Kill | Ambiguous → |
|---|---|---|---|
| 0 | Scope doc committed | n/a | n/a |
| 1 | Dialect ≥ ProtectAI monolingual + ≥80% recall on translated, with compute-adjusted metric favouring dialect | Dialect < keyword baseline on either set on headline metric AND compute-adjusted metric | Document full metric panel, tag human, do not close |
| 2 | AUROC ≥ 0.7 on pairs + correct calibration on dialect-positive-benign + no degenerate operating region | AUROC < 0.7 | Document findings, surface to human, do not close |

## Communication protocol

- **Gate start:** post a comment on #52: "Starting Gate N; target completion $(date+1d)." Then work.
- **Gate end (pass or kill):** post a comment with result, link to artefact, and explicit next-action line. Tag `@JimmyCapps` only on kill, not on pass.
- **Gate end (ambiguous):** post a comment tagged `@JimmyCapps` with the full metric panel, the hypothesis-precision check outcome, and a recommendation for next action. Do not close. Do not kill unilaterally.
- **Stuck / over budget:** post a comment immediately. Stop work. Wait for human.

## Pre-existing repo conventions cowork must follow

- Branch naming: `cowork/issue-52-gate-N`
- Commit format: `research(cowork-#52): <short description>`
- PR body format follows `CONTRIBUTING.md` §PR template; one PR per gate.
- No `--no-verify` on commits. If the pre-push hook fails on an artefact-only PR, investigate — likely a file-placement error.

## Output file tree (what the repo looks like after all three gates)

```
docs/issues/
├── 52-cowork-stage-gates.md              (this file)
└── 52-cowork-outputs/
    ├── gate-0-scope.md
    ├── gate-1-dialect-spike.md
    ├── gate-1-notebook.ipynb
    ├── gate-1-vocabulary.json
    ├── gate-2-contract-spike.md          (only if Gate 1 passed)
    └── gate-2-pairs.jsonl                (only if Gate 1 passed)
```

## Done.

The cowork agent now has: the hypothesis, the protocol, the exit criteria for each gate, the file layout, the branch/PR conventions, the hypothesis-precision pre-flight, the production-metrics panel, and the explicit-human-in-the-loop rule for ambiguous outcomes that prevents this from becoming either a runaway research project or a premature closure.
