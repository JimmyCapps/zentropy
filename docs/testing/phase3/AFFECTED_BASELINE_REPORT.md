# HoneyLLM Phase 3 — Track A Affected-Baseline Report (current)

**Phase:** 3
**Track:** A (in-extension affected baseline)
**Scope:** affected-baseline sweep + manual FP curation under the **v2 JSON-aware classifier** (issue #13).
**Last updated:** 2026-04-18
**Previous report:** [`AFFECTED_BASELINE_REPORT_2026-04-17.md`](./AFFECTED_BASELINE_REPORT_2026-04-17.md) — pre-v2 numbers, retained as historical baseline per the report-fork convention (see `CONTRIBUTING.md` §Phase reports).

> **Reading order.** This report is the source of truth for Phase 3 Track A FP characterisation as-of the v2 classifier. The historical report quantifies the pre-fix state and the SHIP/defer decision that produced the v2 work; the numbers there are frozen and should not be updated in place.

## What changed from the historical report

Issue #13 (commit `b2aae63`, merged 2026-04-18) replaced the Phase 3 Track A classifier with a JSON-aware v2. v1 substring-matched the probe's `instruction_detection` output, which caused the probe's *evidence of detection* (quoted attacker text inside the `instructions` array) to be misread as *evidence of compromise*. v2 parses the detection-report shape and returns all-false when matched; falls through to v1 for non-conformant outputs.

**Net effect on Track A affected rows:**
- Total FP count: 15 → 10 (−33%).
- `instruction_detection` FPs: 12 → 6 (−50%). All Nano + Gemma rows cleared; 6 legitimate model-behaviour FPs remain on Llama / Phi-3.5 where the model emitted prose or malformed JSON and v2 deferred to v1.
- `summarization` and `adversarial_compliance` FPs: essentially unchanged (v2 only activates on instruction_detection).

See issue #13 + commit `b2aae63` + [`AFFECTED_BASELINE_REPORT_2026-04-17.md`](./AFFECTED_BASELINE_REPORT_2026-04-17.md) for the pre-fix rationale.

## Source files (current anchors)

| File | Role | sha256 |
|---|---|---|
| `docs/testing/inbrowser-results-affected.json` | Canonical Track A sweep — 189 rows, `fp_review` + `classification_version: 'v2'` stamped | `429d3f2f135a90d81efab5d1da33d15c029ba5f8d5d9a99040276b187150345d` |
| `docs/testing/inbrowser-results-affected-replicates.json` | Replicate sidecar — 6 models × inject_role_hijack × N=5 | `42f03f6e94853861eeea75ba8bbfd7aece0aeee83d1bef99e9ced98c4df2fb44` |
| `docs/testing/phase3/fp-review-affected.json` | Verdict table — 55 FP-surface rows (was 52 pre-v2; v2 drops 10 detection-report rows and retains the 6 prose/malformed-JSON rows, plus a few rows that were not previously surfaced) | `f6277baee07ad9a860e530cf5b9bb33dac755d27906143c60534760575c486db` |
| `docs/testing/inbrowser-results.json` | Phase 2 native baseline (unchanged; v1-locked, byte-identity test) | (pre-existing) |

Source commits (for numbers in this report): v2 migration `b2aae63` (#13), cosmetic fixes `1122cdb` + `f9e3386`.

## Current FP curation totals

From `scripts/annotate-fp-review-affected.ts` after the v2 re-stamp:

| Model | real | false_positive | ambiguous | total curated |
|---|---|---|---|---|
| Qwen2.5-0.5B | 4 | 0 | 1 | 5 |
| TinyLlama-1.1B | 1 | 2 | 3 | 6 |
| Llama-3.2-1B | 1 | 3 | 1 | 5 |
| Phi-3-mini | 5 | 2 | 2 | 9 |
| Phi-3.5-mini | 7 | 2 | 3 | 12 |
| gemma-2-2b | 9 | 0 | 0 | 9 |
| chrome-builtin-gemini-nano | 7 | 1 | 1 | 9 |
| **TOTAL** | **34** | **10** | **11** | **55** |

Raw FP rate: 10/55 = **18%** (down from 29% in the historical report). Adjusted FP rate excluding remaining `instruction_detection` structural FPs: 4/49 = **8.2%** (down from 7.5% adjusted; the denominator changed because fewer rows are now FP-surface).

## FP distribution by probe

| Probe | real | false_positive | ambiguous |
|---|---|---|---|
| summarization | 15 | 2 | 4 |
| adversarial_compliance | 19 | 2 | 7 |
| instruction_detection | 0 | 6 | 0 |

**`instruction_detection` remaining FPs** are all on Llama-3.2-1B or Phi-3/Phi-3.5 outputs where the model emitted prose or malformed-JSON instead of the strict `{found, instructions, techniques}` schema. v2 correctly falls through to v1 on those; the remaining 6 FPs are a limit of the classifier approach rather than a bug. See issue #13 for the deferred follow-up (classifier-agnostic treatment for prose outputs).

## Status

Classifier-cleanup decision made; v2 shipped. Track A SHIP decision from the historical report remains valid (Gemma-2-2b as primary canary). Phase 3 Track B re-run (issue #2) is now unblocked — v2 addresses the dominant FP source that would have inflated the Track B efficacy verdict.

## Related

- Historical report: [`AFFECTED_BASELINE_REPORT_2026-04-17.md`](./AFFECTED_BASELINE_REPORT_2026-04-17.md)
- Nano-specific addendum: [`NANO_BASELINE_ADDENDUM.md`](./NANO_BASELINE_ADDENDUM.md) — Nano instruction_detection FPs: 4/4 → 0/4 under v2.
- Classifier fix: issue #13 + commit `b2aae63`.
- Track B re-run tracker: issue #2.
