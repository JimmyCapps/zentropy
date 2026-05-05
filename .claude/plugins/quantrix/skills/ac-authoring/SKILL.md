---
name: ac-authoring
description: Multi-angle acceptance criteria authoring discipline; code/manual AC split; bounded ≤5; verification-source citation. Used by /sprint pre-flight gate and /qa AC-quality pre-check.
type: process
---

# AC authoring — multi-angle, code/manual split, bounded

When authoring or reviewing acceptance criteria for a quantrix sprint item, follow these rules.

## Two sections, always

```markdown
## Code AC (verified by /qa from diff)

- [ ] <test gate>
- [ ] <regression coverage>

## Manual AC (verified by /te + /qa via artifact)

- [manual] · <action> · expect <outcome> · verify via <surface-map key>
```

If manual testing doesn't apply, omit the Manual AC section. Code AC is always present.

## Multi-angle — ≥2 ACs total

A single AC tells you one thing was satisfied. Two ACs from different angles tell you the fix didn't accidentally satisfy the wrong shape.

Example — embeddings false-positive on bricklink:
- AC 1 (positive code): `bricklink-regression.test.ts asserts cosine(<phrase>) < 0.85, passes in CI`
- AC 2 (regression code): `Phase 2 byte-locked baseline byte-identical`
- AC 3 (manual): `[manual] · 3 cache-cleared scans of bricklink.com/v2/main.page · expect CLEAN with no mitigations · verify via storage:honeyllm:last-verdict`

Three angles. A fix that lowers the corpus threshold satisfies AC 1 but fails AC 2. A fix that special-cases the URL satisfies AC 1 + AC 2 but fails AC 3 (tests don't trigger the embeddings layer).

## Bounded — ≤5 total, recommend ≤3 per section

If you have >5 ACs, the work is too broad. Split into multiple issues.

The cap is an upper bound, not a target. 2 well-chosen ACs > 5 redundant ones.

## Concrete + verifiable

Each AC must be:
- **Concrete** — specific file, command, measurable outcome. NOT "fix is good", "works", "no regressions" without a regression list.
- **Verifiable** — `/qa` can check it from the diff (Code AC) or `/te` can walk the user through verification (Manual AC).
- **Distinct** — no overlap between AC items. If two ACs check the same thing differently, drop one.

## Manual AC — verification source citation

Manual AC entries MUST cite a verification source from the project's surfaces map:

```
[manual] · <action> · expect <outcome> · verify via <surface-map key>
```

The verify clause turns into a runnable command via the surfaces map. Without it, `/te` cannot interpolate a verification command and rejects the AC.

If the verification source isn't in the surfaces map yet, add it to the map in the same PR — that's a sign the surface is undocumented.

## Pre-flight gate

`/sprint <N.M>` STOPs if:
- Issue body lacks `## Code AC` section
- Issue body lacks `## Manual AC` section AND the sprint item's validation block references manual testing
- Total AC count < 2
- Any Manual AC line lacks a `verify via` clause
- Any Manual AC line cites a `verify via` key not present in the surfaces map

`/sprint` does NOT author AC on the user's behalf when the gate fails — that's the agent grading its own homework. User amends issue body, then re-runs.

## Common pitfalls

- **AC drift:** ACs change during execution to match what was shipped. Don't. The AC was the contract; ship to it or amend deliberately (and explain why in the PR body).
- **Tautology:** "the test passes" is not an AC. The test name + assertion shape is the AC.
- **Vague verification:** "popup shows the right thing" is not verifiable. "popup verdict = CLEAN, mitigations = []" is.
- **Over-decomposition:** breaking one AC into 5 sub-bullets defeats the bound. One AC with a multi-clause verification is fine.
