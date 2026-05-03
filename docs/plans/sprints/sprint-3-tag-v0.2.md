# Sprint 3 — §4.2 + telemetry review + ProtectAI + tag v0.2.0-internal (Days 7-9)

**Theme:** Heavy reasoning sprint — measure pedagogical FPR, review Phase 6 telemetry, validate ProtectAI, then tag the first internal milestone. **Tag at end:** `v0.2.0-internal`. **Recommended model:** `claude-opus-4-7`, effort high.

Master plan: [`../v0.1-completion.md` Sprint 3](../v0.1-completion.md#sprint-3-days-79-pedagogical-42--telemetry-review--protectai--tag-v100). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: **`claude-opus-4-7`** (high effort). Validation + telemetry analysis are reasoning-heavy; not the place to save tokens.
- [ ] Plugins: same as Sprint 1.
- [ ] MCP: context7 useful for mlc-llm docs lookup.
- [ ] **User pre-req:** complete §M-7 `mlc_llm serve` setup ([`../v0.1-completion.md` §M-7](../v0.1-completion.md#m-7--mlc_llm-serve-setup-sprint-3)) before item 3.2.
- [ ] **Date check:** item 3.3's telemetry window opens ~2026-05-14. If today < 2026-05-14, swap 3.3 with a Sprint 4 item (DM-A) and slip 3.3 to Sprint 4. The tag still cuts at end of Sprint 3 with whatever 3.3 was able to land.
- [ ] Repo state: `npm test` passes; all Sprint 1+2 PRs on main.

```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-opus-4-7 --effort high --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 3.1 [USER] — `mlc_llm serve` setup

**Manual playbook:** [`../v0.1-completion.md` §M-7](../v0.1-completion.md#m-7--mlc_llm-serve-setup-sprint-3). End-state: `mlc_llm serve` running at `http://127.0.0.1:8000/v1` with `gemma-2-2b-it-q4f16_1-MLC` model.

**Validation:** `curl http://127.0.0.1:8000/v1/models` returns the model id JSON. Tell Claude in next session: "mlc_llm serve is up at http://127.0.0.1:8000/v1 with model gemma-2-2b-it-q4f16_1-MLC".

---

## Item 3.2 — #120 §4.2 LLM-layer pedagogical FPR (depends on 3.1)

**What:** Run the 50-entry pedagogical corpus through `mlc_llm serve`; populate the §4.2 cells in `docs/testing/phase5/PEDAGOGICAL_BASELINE.md`.

**Kickoff prompt:**
```
Execute Sprint 3 item 3.2 (#120 §4.2 LLM-layer pedagogical FPR) per docs/plans/v0.1-completion.md Sprint 3 §3.2. Pre-req: mlc_llm serve up at http://127.0.0.1:8000/v1 with model gemma-2-2b-it-q4f16_1-MLC (per §M-7). Set HONEYLLM_LLM_BASE_URL + HONEYLLM_LLM_MODEL env vars; run scripts/run-pedagogical-fpr.ts; populate docs/testing/phase5/PEDAGOGICAL_BASELINE.md §4.2 cells. If FPR > 0.10 on any path, file a follow-up tuning issue (label phase-5) AND ship the documented result; do NOT block tag. Branch test/issue-120-llm-layer-fpr.
```

**Validation:**
- `docs/testing/phase5/PEDAGOGICAL_BASELINE.md` §4.2 cells populated
- `gh issue view 120 --json state -q '.state'` → `CLOSED`
- If FPR > 0.10 on any path: follow-up issue exists with measurement + label `phase-5`

**Closeout:** none.

---

## Item 3.3 — Phase 6 combined telemetry review

**What:** Read all 4 Phase 6 telemetry storage keys; output a review doc.

**Date gate:** the telemetry review needs ≥14 days of accumulated signal. Window opens ~2026-05-14. If today < 2026-05-14, defer this item to Sprint 4 and bring DM-A forward.

**Kickoff prompt:**
```
Execute Sprint 3 item 3.3 (Phase 6 combined telemetry review) per docs/plans/v0.1-completion.md Sprint 3 §3.3. Pre-req: ≥14 days of telemetry across honeyllm:{cache,response,intercept,thinking}-telemetry storage keys (telemetry started accumulating 2026-04-30). Output docs/testing/phase6/TELEMETRY_REVIEW_2026-05-XX.md with: per-portal capture/analysed/suspicious/compromised rates; cache hit + 404 rate; intercept override-window crossings; cross-portal divergence stat (responseVerdict.status vs thinkingVerdict.status on same origin); selector regression signals (any portal with zero captures over the window). Open follow-up issues for any tuning gaps surfaced. Branch docs/issue-XXX-phase6-telemetry-review (open chore issue first).
```

**Validation:**
- `docs/testing/phase6/TELEMETRY_REVIEW_2026-05-XX.md` exists on main
- Any tuning gaps have open issues with `phase-6+` label

---

## Item 3.4 — #128 ProtectAI validation

**What:** Head-to-head Path A (Hawk → ProtectAI deberta-v3 → LLM) vs Path B (Hawk → LLM direct) on the 50-entry pedagogical corpus. Measure TPR/FPR/F1/latency. Decide ship or won't-fix.

**Kickoff prompt:**
```
Execute Sprint 3 item 3.4 (#128 ProtectAI validation) per docs/plans/v0.1-completion.md Sprint 3 §3.4. Set up the head-to-head: Path A = Hawk-FLAGGED → ProtectAI deberta-v3 → LLM-if-confirmed; Path B = Hawk-FLAGGED → LLM direct. Run on the English-only Hawk-FLAGGED chunks from the 50-entry pedagogical corpus (#120). Measure TPR / FPR / F1 / latency for both paths. Decision: if Path A measurably wins (significant latency saving without F1 loss) → implement on branch feat/issue-128-protectai-pathway. Else close #128 as won't-fix with measurements documented. Pre-req: pedagogical corpus available at docs/testing/phase5/pedagogical-corpus.jsonl.
```

**Validation:**
- `gh issue view 128 --json state -q '.state'` → `CLOSED`
- Decision documented (PR body if shipped; close comment if won't-fix) with TPR/FPR/F1/latency table

---

## Item 3.5 — ROADMAP refresh + RAG_STATUS clone

**Kickoff prompt:**
```
Execute Sprint 3 item 3.5 (ROADMAP refresh + RAG_STATUS clone) per docs/plans/v0.1-completion.md Sprint 3 §3.5. Update docs/ROADMAP.md: mark Sprint 1-3 closed issues actually closed in §v1.0 (recompute %s; the doc is currently stale showing #83/#44/#45/#48/#60/#118/#119/#145 as v1.0-critical when all were closed 2026-04-30). Add 2026-05-XX decision-log entry summarising v0.2.0-internal cut. Clone docs/RAG_STATUS_2026-04-21.md → docs/RAG_STATUS_2026-05-XX.md with delta of all closed work since. Branch docs/issue-XXX-roadmap-refresh-v0.2 (open chore issue first).
```

**Validation:**
- `docs/ROADMAP.md` v1.0 row reflects current closed-issue count
- `docs/RAG_STATUS_2026-05-XX.md` exists

---

## Item 3.6 — Write `docs/RELEASE_NOTES_v0.2.0-internal.md`

**Kickoff prompt:**
```
Execute Sprint 3 item 3.6 (RELEASE_NOTES_v0.2.0-internal.md) per docs/plans/v0.1-completion.md Sprint 3 §3.6. Headline: stability fixes (#220/#221 mitigation lifecycle, #226 logging coverage, #232 bricklink FP, #217 Officeworks posture), Phase 3 closure (#2 B7 report, #14 replicates), maintainer smokes done (#124, #129), image probe popup (#9 4G.6a/b), Phase 5 §4.2 LLM-layer FPR baseline, ProtectAI validation result (#128). Known issues: any items deferred from this sprint per scope-cuts. Branch docs/issue-XXX-release-notes-v0.2 (open chore issue first).
```

**Validation:** `docs/RELEASE_NOTES_v0.2.0-internal.md` exists with all Sprint 1-3 closures cited.

---

## Item 3.7 — Tag v0.2.0-internal

**Kickoff prompt:**
```
Execute Sprint 3 item 3.7 (tag v0.2.0-internal) per docs/plans/v0.1-completion.md Sprint 3 §3.7. Run: npm ci && npm run typecheck && npm test && npm run build:release && npm run test:e2e — all must pass. Bump manifest.json + package.json from 0.1.0 → 0.2.0-internal. Branch release/v0.2.0-internal; PR with --body-file docs/RELEASE_NOTES_v0.2.0-internal.md; squash-merge after CI green. Then: git checkout main && git pull && git tag v0.2.0-internal && git push origin v0.2.0-internal && gh release create v0.2.0-internal -F docs/RELEASE_NOTES_v0.2.0-internal.md --prerelease.
```

**Validation:**
- `git tag` lists `v0.2.0-internal`
- `gh release view v0.2.0-internal` returns the release
- `manifest.json` and `package.json` show version `0.2.0-internal`

---

## Sprint 3 close-out

1. Edit epic #248: mark Sprint 3 ✅ DONE; tag link in summary block.
2. Spillover log: append any from Sprint 1-3.
3. Open Sprint 4: [`sprint-4-determillm-bridge.md`](sprint-4-determillm-bridge.md).
