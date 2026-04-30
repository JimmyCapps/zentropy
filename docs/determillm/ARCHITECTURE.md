# DetermiLLM v1 — Architecture

**Status:** Locked design (2026-04-30 brainstorm) — implementation sub-sequence below feeds master plan item 10
**Plan reference:** `~/.claude/plans/no-scheduling-now-please-valiant-feigenbaum.md` §"Master execution sequence" item 10
**Scope:** Single phase of DetermiLLM work — the **dialect-aware deterministic Hunter** that joins Spider/Hawk in HoneyLLM's k-of-N tier router. Broader contract-enforcement vision (research seeds #66/#67/#69) is **explicitly out of scope** and defers to a Phase 8+ track.

---

## TL;DR

DetermiLLM v1 is a third Hunter — a deterministic, on-device, pattern-pack-driven classifier — that votes alongside Spider and Hawk in `tier-router.ts`. It closes the dialect-coverage gap surfaced by the 1250-fixture corpus (`test-pages/manifest-dialect.json` — EN=1050, ES=100, zh-CN=100) without introducing an LLM dependency. Patterns ship as per-language JSON packs hand-curated from the corpus dev split (1000 fixtures); the held-out split (250 fixtures) is the regression contract. The same pack runtime later powers issue [#75](https://github.com/JimmyCapps/zentropy/issues/75) (per-coding-language packs) — DetermiLLM and #75 are **siblings on a shared loader**, not sequenced dependencies.

Sequenced: lands **after #128 ProtectAI validation** (master plan item 5) and **before #129 multilingual embeddings** (master plan item 8). Total: ~8 sessions across 7 work items.

---

## Scope clarification (load-bearing)

The DM-seed issue cluster ([#66](https://github.com/JimmyCapps/zentropy/issues/66) research seed, [#67](https://github.com/JimmyCapps/zentropy/issues/67) architecture, [#69](https://github.com/JimmyCapps/zentropy/issues/69) DM-2 enforcement paths) frames "DetermiLLM" as a multi-deployment-mode contract-enforcement layer with read-side / write-side action-authority semantics. That vision is real but it is **not what this document scopes**.

This document scopes "DetermiLLM v1 in HoneyLLM" — narrowly, the **dialect-aware Hunter** ([#71](https://github.com/JimmyCapps/zentropy/issues/71) DM-4 validation territory) that runs inside HoneyLLM's existing service worker and votes through the existing tier router. The broader contract-enforcement track stays open under #66/#67/#69 as Phase 8+ work, but does not block or sequence this v1.

The Phase 5 methodology supports this narrowing. `docs/testing/phase5/methodology.md:97` describes the 1250-corpus role as **"Hunter regression contract, not an LLM eval"** — i.e. the corpus is meant to validate a Hunter, not to drive an enforcement layer. Aligning DetermiLLM v1 with that framing is the cleanest path from "today's main" to "shipping value against the dialect gap."

---

## Q1. Architectural position → **Hunter (k-of-N router participant)**

**Decision.** DetermiLLM is a third Hunter. It implements the existing Hunter contract (`HunterResult` from `src/hunters/base-hunter.ts`) and is registered alongside `spiderHunter` and `hawkHunter` in `runHunt`'s call list.

**Why.** `src/service-worker/tier-router.ts:22-35` is `routeChunk(report)`, which counts `report.results.filter((r) => r.matched).length` and maps 0/1/2+ to BENIGN/UNCERTAIN/FLAGGED. The `2+` clause is k-of-N, not k-of-2-fixed — adding a third participant changes the data, not the router. The existing `aggregateError !== null` fail-open at `tier-router.ts:23-24` already covers the "all hunters crashed" case for any N.

**Rejected alternatives.**
- **Middleware (sits between Hunters and probes).** No clean insertion point exists. Tier-router already returns `TierRouting` directly to the probe orchestrator; injecting DetermiLLM between them would require a new contract surface, breaking the "Hunter contract is the only Hunter-tier integration point" invariant.
- **Probe (peer of summarisation/instruction-detection/adversarial).** Probes are LLM-driven by definition; DetermiLLM is deterministic. Forcing it into the probe shape would either require a fake LLM wrapper or a probe-specific deterministic carve-out that the orchestrator doesn't have.
- **Eval-only (offline regression harness, never runtime).** Underuses the corpus and leaves the runtime dialect gap unaddressed. ES and zh-CN content would continue routing to BENIGN with single-Hunter coverage, no matter how good the offline metric becomes.

**Tier-router behaviour change at runtime (BEFORE/AFTER).**

```
BEFORE (Spider + Hawk only):
  matched = [Spider?, Hawk?]
  primitiveCount ∈ {0, 1, 2}
  decision = BENIGN | UNCERTAIN | FLAGGED

AFTER (Spider + Hawk + DetermiLLM):
  matched = [Spider?, Hawk?, DetermiLLM?]
  primitiveCount ∈ {0, 1, 2, 3}
  decision = BENIGN | UNCERTAIN | FLAGGED  // unchanged mapping; 2+ → FLAGGED
```

DetermiLLM votes only **escalate** verdicts (BENIGN→UNCERTAIN, UNCERTAIN→FLAGGED) — it cannot demote. This is structural: any new `matched: true` only increments `primitiveCount`. The Phase 2 byte-locked baseline (162 rows in `docs/testing/inbrowser-results.json`) is therefore safe iff DetermiLLM never flips a Phase-2-CLEAN row from BENIGN to UNCERTAIN. That's a regression-testable property handled in DM-A's gate.

---

## Q2. 1250-corpus role → **Evaluation (with dev/holdout split)**

**Decision.** `test-pages/manifest-dialect.json` is **evaluation data**: the regression contract DetermiLLM must pass. A small training-shaped use is allowed — pattern authors read corpus examples to inform pack contents — but no automated learning, no ML pipelines, no held-set leakage.

**Split.** Of the 1250 fixtures: **1000 dev** (read by humans during pack authoring), **250 holdout** (final regression scoring; never opened during dev work). Suggested allocation that respects the corpus's per-language imbalance (EN=1050, ES=100, zh-CN=100):
- Dev split: EN=800, ES=100 (all), zh-CN=100 (all). Pattern authors need every ES and zh-CN fixture they can see.
- Holdout split: EN=250, ES=0, zh-CN=0. The English regression is what we most need to defend; ES/zh-CN holdouts are released later (DM-D step) once we have a way to grow the corpus.

The cost of zero ES/zh-CN holdout in v1: we have no held-out FPR data on those dialects. Mitigation: the pedagogical FP canary (50 fixtures) and holdout-benign clean rate (100 fixtures) already cover **English** FPR with ProtectAI baselines (`benchmark-dialect.ts:195-204`), and ES/zh-CN content is rare enough in HoneyLLM's wild traffic that an English FPR regression is the dominant risk.

**Why.** Phase 5's framing is explicit. `docs/testing/phase5/methodology.md:97` calls the corpus a "Hunter regression contract, not an LLM eval" — corpora used as regression contracts are **evaluation data**, by definition. `benchmark-dialect.ts:218,276` already evaluates against this manifest with precision / recall / F1.

**Rejected alternatives.**
- **Training (DetermiLLM learns from it, automatically).** Forces a training pipeline (dataset curation, train/val/holdout discipline, checkpoint storage, model versioning) that contradicts the "deterministic" charter. v2 may revisit if pattern packs hit a maintenance ceiling.
- **Both (split into train + eval).** Plausible long-term but premature. Pattern packs are simple enough that human-in-the-loop authoring beats automated synthesis at v1's scale (~1000 fixtures, three languages).

---

## Q3. Execution location → **On-device, service-worker-resident, deterministic (no GPU/Nano)**

**Decision.** DetermiLLM runs in the same execution context as Spider and Hawk: the service worker, called synchronously from `runHunt`, no offscreen-document cost. It uses regex matching, n-gram lookup, and constant-size pack data — no `chrome.offscreen.*`, no MLC engine, no Nano `LanguageModel` API.

**Why.** HoneyLLM's primary value is privacy preservation; sending content to a server regresses on the threat model. Spider and Hawk both run in the SW with sub-millisecond per-chunk cost; DetermiLLM matches the same envelope. Offscreen is only needed for the LLM probes (offscreen doc lazy-loads on first PAGE_SNAPSHOT — see CLAUDE.md "Offscreen document is lazy"). DetermiLLM has no LLM dependency, so the offscreen lifecycle stays untouched.

**Rejected alternatives.**
- **Server-side (via #124 Browse MCP server).** Privacy regression: page content would leave the device. Would also couple DetermiLLM's release to #124 (master plan item 7), which is itself a 5+ session sequence.
- **Hybrid.** Over-engineered for v1. There is no hot path that benefits from a server fallback that the on-device path can't already serve.

---

## Q4. Dialect-as-regex model → **Curated per-language pattern packs (option b)**

This is the substantive design call.

**Decision.** Each language gets a JSON pack (e.g. `packs/dialect-en.json`, `packs/dialect-es.json`, `packs/dialect-zh-CN.json`). A pack is an array of pattern entries. A pattern entry has:
- `id`: stable identifier (e.g. `en-imperative-instruction-001`)
- `language`: ISO code (`en`, `es`, `zh-CN`)
- `dialect_class`: one of the corpus's tagged classes (`dialect-en`, `dialect-es`, `dialect-zh-CN`)
- `match_kind`: one of `regex`, `ngram`, `keyword_phrase`
- `pattern`: the literal regex / n-gram / phrase
- `weight`: float ≥0; pattern matches above the per-Hunter weight threshold mark `matched: true` in the Hunter's `HunterResult`
- `provenance`: list of fixture IDs from the dev split that motivated the pattern (audit trail)

The Hunter at runtime: load the pack(s) on init, detect the chunk's language via `detectLanguage()` (`src/hunters/hawk/language-router.ts:33`, already used by Hawk and by sprint 1's #48 fix), select the matching pack, run all patterns against the chunk text, sum weights, emit `matched: true` if the sum crosses threshold.

**Why.** Curated catalogs match the deterministic charter. They are easy to debug (a single pattern fired on a single fixture), trivially extendable (add a JSON entry), and preserve the "no LLM at Hunter tier" invariant. The pack format is intentionally identical to what #75's per-coding-language packs will need (Q5), so the same loader serves both.

**Rejected alternatives.**
- **(a) Code-gen / ML-synthesised patterns from corpus.** High build cost, fragile to dialect drift, conflicts with the "deterministic" charter at the maintenance level (synthesised patterns are deterministic at *inference*, but their *origin* is opaque, making post-hoc debugging hard).
- **(c) Statistical validation (Chi-square / TF-IDF on candidate dialect signals).** Research-grade, blows v1 timeline, requires a held-set discipline the project doesn't yet have. v2 candidate.
- **(d) Other (e.g. AST-aware code-language patterns).** Unnecessary at v1; #75's coding-language work picks up AST-aware matching as a sibling track.

**BEFORE/AFTER pack-runtime contract.**

```
BEFORE: no pack runtime exists.

AFTER:
  src/hunters/determillm/index.ts        // Hunter contract; calls pack-runtime
  src/hunters/determillm/pack-runtime.ts // pure functions: loadPack, matchChunk
  packs/dialect-{en,es,zh-CN}.json       // curated pattern lists
  packs/schema.json                      // JSON Schema for pack format

  Loader: read JSON at SW startup; freeze; export map<lang, pack>
  Matcher: matchChunk(pack, chunk) → { matched: bool, score: number, fired: PatternId[] }
  Hunter: language detection → pack selection → matchChunk → HunterResult
```

The runtime stays in pure-function territory (no I/O after load); pack contents become the only thing changing across DM-A through DM-D.

---

## Q5. Relationship to #75 → **Sibling**

**Decision.** DetermiLLM v1 ships the pack runtime + per-natural-language packs (en/es/zh-CN). [#75](https://github.com/JimmyCapps/zentropy/issues/75) ships per-coding-language packs (python/go/rust/js/ts) **using the same runtime**. Neither is a prerequisite of the other once the runtime exists; the sequencing question reduces to "which set of packs ships first."

**Why.** #75's body proposes two design approaches ("Extract-then-scan" vs "Code-native primitives") that — once you commit to a pack-format runtime — collapse to "more pattern entries with `language: python` etc." The shared loader carries both. Treating #75 as downstream of DetermiLLM would mis-frame it as blocked; treating it as a prerequisite would mis-frame it as a runtime owner. Sibling is the structurally accurate answer.

**Rejected alternatives.**
- **Prerequisite (DetermiLLM needs language-specific seeds first).** Inverts the dependency — DetermiLLM's English pack does not need any coding-language pack.
- **Downstream (#75 generates packs DetermiLLM consumes).** Conflates roles; #75 is a feature on top of the same runtime DetermiLLM v1 builds, not a code-generator for DetermiLLM.

---

## Q6. Success metric → concrete numbers

**Decision.** All metrics measured via `benchmark-dialect.ts` once it accepts a classifier-under-test (work item DM-F):

| Metric | Target | Measured against |
|---|---|---|
| ES dialect recall | ≥80% (preliminary; revised after DM-A baseline read) | 100-fixture ES dev split |
| zh-CN dialect recall | ≥80% (preliminary; revised after DM-A baseline read) | 100-fixture zh-CN dev split |
| EN baseline recall | ≥ Spider+Hawk current recall, no regression | EN dev split |
| EN regression on Phase 2 byte-locked rows | 0 changed verdicts (BENIGN→non-BENIGN) | `docs/testing/inbrowser-results.json` (162 rows) |
| Pedagogical FP budget | 0/50 compromised | corpus benign_calibration subset |
| Holdout-benign FPR | ≤2% | corpus holdout_benign (100 fixtures) |
| P95 latency per chunk | ≤1 ms | benchmark-dialect.ts harness timer |

**Why these numbers.** Phase 5's pedagogical FP budget is byte-locked at 0/50 (memory `project_pedagogical_fpr_baseline.md`); preserving it is non-negotiable. EN regression on Phase 2 is a hard invariant of the byte-locked baseline — the structural property in Q1 (DetermiLLM only escalates) reduces it to "DetermiLLM does not fire on Phase 2 CLEAN rows," covered by DM-A's gate. The 80% ES/zh-CN target is conservative; the **first DM-A session reads the actual single-Hunter baseline on each language** and revises if Spider+Hawk already exceed 80% (DetermiLLM's bar moves to "baseline + 10pp"). Latency is dimensioned to the existing Spider/Hawk envelope.

---

## Q7. Sequencing → **AFTER #128 (item 5), BEFORE #129 (item 8); independent of Phase 8 Sprint A (item 11)**

**Decision.** Slot DetermiLLM as **master plan item 6.5** — i.e. between item 5 (#128 ProtectAI validation) and item 6 (#125 Agent SDK). Practically that means the master plan re-numbers item 6 onwards, or DetermiLLM gets inserted as a named row at item 10 with an explicit "runs after item 5" gate.

**Pairwise justifications.**
- **vs #128 ProtectAI validation (item 5) → DetermiLLM AFTER #128.** #128's telemetry window opens earlier (Phase 6 telemetry review at item 4, ~2026-05-14, then #128 validation immediately after). DetermiLLM is greenfield with no telemetry dependency — ship the gated work first, free up the unblocked work next.
- **vs #129 multilingual embeddings (item 8) → DetermiLLM BEFORE #129.** #129 is non-deterministic, ~5 sessions, and addresses a near-overlapping coverage gap. DetermiLLM is a simpler, smaller, lower-risk approach to the same gap — ship the cheaper instrument first, then evaluate whether #129 is still worthwhile or shifts in scope (e.g. "embeddings as a v2 pattern-proposer rather than a runtime classifier").
- **vs Phase 8 Sprint A (item 11) → independent.** Sprint A is a cleanup batch. Run Sprint A whenever it's convenient; it does not block or accelerate DetermiLLM.

---

## Decision log (rejected branches, summarised)

- **Q1 Hunter (vs Probe / Middleware / Eval-only).** k-of-N router and `HunterResult` contract are the cleanest insertion point. Probe requires LLM coupling DetermiLLM doesn't have; eval-only leaves runtime gaps.
- **Q2 Evaluation (vs Training).** Phase 5 framing is "regression contract." Adopting it avoids ML pipeline overhead and matches the deterministic charter.
- **Q4 Pack catalog (vs ML synthesis / statistical validation).** Catalogs are auditable per-pattern, easy to extend, shared with #75. ML synthesis fights deterministic charter at maintenance time; statistical validation is research-grade and v1-blocking.
- **Q5 Sibling (vs Prerequisite / Downstream of #75).** Shared pack runtime collapses the dependency to scheduling.
- **Q7 Sequencing (after #128, before #129).** Telemetry-gated work first; cheaper coverage tools before expensive ones.
- **Action-authority scope (out of scope).** #66/#67/#69's proxy/MCP/cloud enforcement layer is Phase 8+ — folding it into v1 forces 3× scope with a different threat model.

---

## Implementation sub-sequence (master plan item 10 expansion)

Each item lists: **scope** | **anchors (file:line)** | **session estimate** | **gate** | **dependencies**.

### DM-A. Pack runtime + en pack v0 stub — 1 session

- **Scope.** Build pack-runtime (loader + matcher), register DetermiLLM as 3rd Hunter, ship a 5-10-pattern stub English pack. Wire DetermiLLM into `runHunt` so it returns `HunterResult` participating in `tier-router.ts:27` `matched.length` count.
- **Anchors.** `src/hunters/base-hunter.ts` (Hunter contract); `src/service-worker/tier-router.ts:22-35` (k-of-N router); `src/hunters/spider/index.ts` (Hunter shape exemplar); `scripts/benchmark-dialect.ts:20-21` (will need DM-F before final scoring).
- **Gate.** Zero changed verdicts on Phase 2 byte-locked baseline (`docs/testing/inbrowser-results.json` — 162 rows). Reuses `phase2-inputs.test.ts:57` byte-identity assertion as canary.
- **Dependencies.** None.
- **Closes (eventual):** part of #71 (DM-4 validation).

### DM-B. Pattern-authoring guide + en pack v1 (production) — 2 sessions

- **Scope.** Document pack format JSON Schema. Author EN pack v1 from corpus dev split (800 fixtures), targeting recall + 10pp over Spider+Hawk EN baseline.
- **Anchors.** `docs/determillm/PACK-FORMAT.md` (new); `packs/dialect-en.json` (expanded); corpus EN dev fixtures.
- **Gate.** EN dev recall ≥ Spider+Hawk EN baseline + 10pp; pedagogical FP 0/50 preserved.
- **Dependencies.** DM-A.
- **Refs:** [#71](https://github.com/JimmyCapps/zentropy/issues/71) DM-4, [#74](https://github.com/JimmyCapps/zentropy/issues/74) DM-7.

### DM-C. ES pack v1 — 1 session

- **Scope.** Author ES pack from 100-fixture ES dev split.
- **Anchors.** `packs/dialect-es.json` (new); `src/hunters/hawk/language-router.ts:33` `detectLanguage()` for runtime language gating.
- **Gate.** ES dev recall ≥80%; EN regression unchanged.
- **Dependencies.** DM-A, DM-B (pack format frozen).

### DM-D. zh-CN pack v1 + ES/zh-CN holdout split — 1 session

- **Scope.** Author zh-CN pack from 100-fixture zh-CN dev split. Split future-corpus growth into ES/zh-CN holdout sets so v2 has held-out FPR data on those dialects.
- **Anchors.** `packs/dialect-zh-CN.json` (new); manifest-dialect.json fixture-split annotation.
- **Gate.** zh-CN dev recall ≥80%; EN regression unchanged.
- **Dependencies.** DM-A, DM-B, DM-C.

### DM-E. Pack-match telemetry surface — 1 session

- **Scope.** Add `honeyllm:pack-match-telemetry` storage key recording `{patternId, chunkId, language, score, ts}` for every pattern that fires in the wild. Feeds v2 pack-author iteration and #75 cross-pollination.
- **Anchors.** `src/service-worker/orchestrator.ts:191` `analyzeSnapshot` entry (where Hunter results are persisted); existing Phase 6 telemetry surfaces as shape exemplars (`honeyllm:cache-telemetry`, `honeyllm:response-telemetry`).
- **Gate.** No PII leaks via telemetry; pattern hits stored as IDs, not the matching text excerpt.
- **Dependencies.** DM-A.

### DM-F. `benchmark-dialect.ts` accepts classifier-under-test — 1 session

- **Scope.** Refactor `benchmark-dialect.ts:20-21` to accept any Hunter (or array of Hunters) as parameter rather than hardcoding Spider+Hawk. Run scoring matrix: Spider+Hawk vs Spider+Hawk+DetermiLLM vs DetermiLLM-alone.
- **Anchors.** `scripts/benchmark-dialect.ts:20-21` (hardcoded imports); `scripts/benchmark-dialect.ts:218,276` (output JSON sites).
- **Gate.** All three configurations produce per-language precision/recall/F1; pedagogical FP and holdout-benign clean rates measurable per configuration.
- **Dependencies.** DM-A. Independently sequenceable from DM-B/C/D — useful as soon as DM-A lands.
- **Closes (eventual):** validation portion of [#71](https://github.com/JimmyCapps/zentropy/issues/71).

### DM-G. DM-seed issue triage + close-superseded — 1 session

- **Scope.** Re-read #66–#79 with the architecture decisions in hand. Close the issues whose intent is satisfied by DM-A through DM-F. Reframe the issues that pertain to the deferred contract-enforcement layer (notably #66/#67/#69) as Phase 8+ track.
- **Anchors.** GitHub issues #66, #67, #68, #69, #70, #71, #72, #73, #74, #76, #77, #78, #79.
- **Gate.** Each closed issue cites the DM-A–F PR or the architecture doc as superseder; each retained issue has a Phase-8+ label and an updated body.
- **Dependencies.** DM-A through DM-F all merged.

**Total:** 7 work items, ~8 sessions.

---

## Deferred / open questions

- **ES/zh-CN holdout corpus growth.** v1 has zero held-out fixtures on the non-English dialects (Q2 split). Growing the corpus is a v2 work item; until then ES/zh-CN FPR is dev-set-only.
- **Pack content cross-contamination with Hunter telemetry.** If DM-E surfaces patterns that overlap with #128 ProtectAI signals, follow up with a deconfliction step.
- **Per-coding-language pack format finalisation.** DM-B locks the pack format. If #75 surfaces requirements DM-B did not anticipate (e.g. AST-anchored patterns), v2 of the pack format adds them additively without breaking DM-A–D consumers.
- **Contract-enforcement layer (#66/#67/#69).** Out of scope for v1; tracked as a Phase 8+ candidate.

---

## Cross-references

- Master plan item 10 (this doc replaces the placeholder): `~/.claude/plans/no-scheduling-now-please-valiant-feigenbaum.md`
- DM-seed issues: [#66](https://github.com/JimmyCapps/zentropy/issues/66) (research seed), [#67](https://github.com/JimmyCapps/zentropy/issues/67) (architecture from #52), [#69](https://github.com/JimmyCapps/zentropy/issues/69) (DM-2 enforcement paths), [#71](https://github.com/JimmyCapps/zentropy/issues/71) (DM-4 validation), [#74](https://github.com/JimmyCapps/zentropy/issues/74) (DM-7 trade-off), [#75](https://github.com/JimmyCapps/zentropy/issues/75) (per-coding-language packs — sibling).
- Phase 5 deferral: `docs/testing/phase5/methodology.md:97`.
- Tier-router contract: `src/service-worker/tier-router.ts:22-35`.
- Existing benchmark harness: `scripts/benchmark-dialect.ts:20-21,195-204,218,276`.
- Project memories: `project_hunter_corpus_split.md` (corpus separation), `project_pedagogical_fpr_baseline.md` (0/50 invariant), `project_issue_2_supersession.md` (parallel reframe pattern).
