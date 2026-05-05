# Sprint 4 — DetermiLLM bridge (DM-A/E/F/G) + Wolf design (Days 10-12)

**Theme:** Wire DetermiLLM as 3rd Hunter (stub) + telemetry + benchmark refactor + seed-issue triage; start Wolf canary design. **Tag:** none. **Recommended model:** `claude-haiku-4-5-20251001`, effort medium (mechanical wiring + triage).

Master plan: [`../v0.1-completion.md` Sprint 4](../v0.1-completion.md#sprint-4-days-1012-determillm-bridge--wolf-design). Tracking: epic #248. Cross-pollination: closes DM-A/E/F/G on the DetermiLLM phase side.

---

## Pre-flight checklist

- [ ] Model: `claude-haiku-4-5-20251001` (medium). Bridge work is mechanical.
- [ ] Plugins baseline.
- [ ] MCP: minimum.
- [ ] Repo state: `npm test` passes; v0.2.0-internal tag exists.
- [ ] Read [`docs/determillm/ARCHITECTURE.md`](../../determillm/ARCHITECTURE.md) before items 4.1-4.4 — that's the design contract.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-haiku-4-5-20251001 --effort medium --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 4.1 — #244 DM-A pack runtime + en pack v0 stub

**Companion:** [`../../testing/manual-tests/4.1.md`](../../testing/manual-tests/4.1.md) — post-merge reload smoke. Verifies via `popup:accordion-hunters` + `service-worker:console`.

**What:** Wire DetermiLLM as 3rd Hunter in `runHunt`. Empty `dialect-en` pack stub; gates on Phase 2 baseline byte-identical.

**Kickoff prompt:**
```
Execute Sprint 4 item 4.1 (#244 DM-A pack runtime + en pack v0 stub) per docs/plans/v0.1-completion.md Sprint 4 §4.1. Read docs/determillm/ARCHITECTURE.md (PR #166) before starting. Create src/hunters/determillm/{index.ts, pack-runtime.ts}, packs/dialect-en.json (stub: {patterns:[], version:1}), packs/schema.json. Register as 3rd Hunter in runHunt (so total = Spider + Hawk + embeddings + DetermiLLM = 4 hunters). Verify k-of-N voting at tier-router.ts:27 picks it up. **HARD GATE: 0 changed verdicts on Phase 2 byte-locked baseline (162 rows in docs/testing/inbrowser-results.json).** Anchors: tier-router.ts:22-35, src/hunters/spider/index.ts (Hunter shape exemplar). Branch feat/issue-244-determillm-pack-runtime.
```

**Validation:**
- `gh issue view 244 --json state -q '.state'` → `CLOSED`
- `npm test` passes; new tests cover empty-pack returns no findings
- `git diff main~1 -- docs/testing/inbrowser-results.json` shows zero diff

**Closeout:** comment on the architecture doc PR #166 marking DM-A ✅ COMPLETE on the DetermiLLM side.

---

## Item 4.2 — #245 DM-E pack-match telemetry surface

**Companion:** [`../../testing/manual-tests/4.2.md`](../../testing/manual-tests/4.2.md) — privacy-contract verification (no `text` / `excerpt` / `chunk` keys persisted). Verifies via `service-worker:console`.

**Kickoff prompt:**
```
Execute Sprint 4 item 4.2 (#245 DM-E pack-match telemetry) per docs/plans/v0.1-completion.md Sprint 4 §4.2. Add STORAGE_KEY_PACK_MATCH_TELEMETRY = 'honeyllm:pack-match-telemetry'. Persist {patternId, chunkId, language, score, ts} per match from orchestrator.ts:191 analyzeSnapshot. **Privacy contract: IDs only, NO excerpt text** (per memory feedback rule). Cap at N=1000 most-recent; rolling drop. Mirror src/registry/telemetry.ts (SR-G) trio: record/reset/getStats. TDD: 8 cases covering persist/no-persist/cap/defensive null. Branch feat/issue-245-pack-match-telemetry.
```

**Validation:**
- `gh issue view 245 --json state -q '.state'` → `CLOSED`
- Manual: visit any page with the post-DM-A extension; SW console `chrome.storage.local.get('honeyllm:pack-match-telemetry')` returns the bounded array

**Closeout:** mark DM-E ✅ on architecture doc.

---

## Item 4.3 — #246 DM-F benchmark-dialect.ts parameterise classifier

> **AC review note (#274):** No manual companion needed — offline benchmark script with no UI surface. The Code AC table is the verification.

**Kickoff prompt:**
```
Execute Sprint 4 item 4.3 (#246 DM-F benchmark parameterise) per docs/plans/v0.1-completion.md Sprint 4 §4.3. Refactor scripts/benchmark-dialect.ts:20-21 to accept --classifier flag with values spider+hawk / spider+hawk+determillm / determillm-alone. Output JSON header includes classifier set. Default (no flag) = spider+hawk to preserve existing scripts. TDD: flag parsing + each classifier set runs + output schema invariant. Branch refactor/issue-246-benchmark-classifier-flag.
```

**Validation:**
- `gh issue view 246 --json state -q '.state'` → `CLOSED`
- `tsx scripts/benchmark-dialect.ts --classifier determillm-alone --dry-run` exits 0

**Closeout:** mark DM-F ✅ on architecture doc.

---

## Item 4.4 — #247 DM-G seed-issue triage

> **AC review note (#274):** No manual companion needed — triage chore with GitHub-side artefacts only (label changes + per-issue disposition comments).

**Pre-req:** DM-A/E/F all merged.

**Kickoff prompt:**
```
Execute Sprint 4 item 4.4 (#247 DM-G seed-issue triage) per docs/plans/v0.1-completion.md Sprint 4 §4.4. Pre-req: #244, #245, #246 all merged. Re-read each of #66, #67, #68, #69, #70, #71, #72, #73, #74, #77, #78, #79 against docs/determillm/ARCHITECTURE.md. Close issues whose intent is satisfied with comment citing superseder PR / arch-doc section. Reframe #66 / #67 / #69 (broader contract-enforcement layer) to phase-8-candidate label; update issue body to reflect Phase 8+ deferral. Each retained / reframed issue gets a comment pointing at the arch-doc section keeping it open. Triage summary commented on #247 with closed/retained/reframed counts. Then close #247.
```

**Validation:**
- `gh issue view 247 --json state -q '.state'` → `CLOSED`
- Triage summary comment on #247 lists all 12 seed issues with disposition
- `gh issue list --label phase-8-candidate --search '#66 OR #67 OR #69'` shows #66/#67/#69 reframed

**Closeout:** mark DM-G ✅ on architecture doc.

---

## Item 4.5 — #3 Wolf canary stage 1: design + Llama-3.2-1B integration scaffold

> **AC review note (#274):** #3's umbrella AC splits across 4.5 (catalog + scaffold, Code-only) → 5.1 (refusal-as-detection pipeline, Code-only) → 5.2 (tier-router integration + scoring, Code-only) → 6.1 (Wolf finish, Code + Manual AC). Each sprint kickoff cites only its stage's contract. Manual companion lands at 6.1.

**What:** RFC + scaffold the third canary engine (Llama-3.2-1B). No production wiring yet; stage 2-4 ship in Sprints 5-6.

**Kickoff prompt:**
```
Execute Sprint 4 item 4.5 (#3 Wolf canary stage 1) per docs/plans/v0.1-completion.md Sprint 4 §4.5. Write design RFC at docs/proposals/wolf-canary.md covering: (1) why Llama-3.2-1B as third canary (refusal-as-detection per Phase 3 Track A §4: 9/9 refusals on clean inputs), (2) scoring contribution SCORE_WOLF_REFUSAL = 30 (between SUSPICIOUS and COMPROMISED), (3) tier-router integration plan, (4) capability declaration ['text_input']. Add 'llama-3.2-1b-mlc' to src/shared/constants.ts CANARY_CATALOG. Scaffold src/offscreen/canaries/wolf-canary.ts mirroring the Gemma adapter pattern (engine init, generateCompletion, Promise singleton). NO refusal-detection logic yet (Stage 2 in Sprint 5). NO tier-router integration yet (Stage 3 in Sprint 5). Branch feat/issue-3-wolf-canary-stage-1.
```

**Validation:**
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- `docs/proposals/wolf-canary.md` exists
- `npm test` passes (scaffold tests; no behaviour-change tests yet)
- #3 stays open (stages 2-4 in Sprints 5-6)

**Closeout:** none.

---

## Sprint 4 close-out

1. Epic #248: Sprint 4 ✅ DONE.
2. Comment on the DetermiLLM architecture doc / its tracking issue: DM-A/E/F/G all complete via HoneyLLM Sprint 4; DetermiLLM phase can now focus on DM-B/C/D pack curation + #75 with the runtime + telemetry + benchmark already shipped.
3. Spillover log: nothing expected this sprint unless Wolf design surfaces a hidden constraint.
4. Open Sprint 5: [`sprint-5-wolf-nano.md`](sprint-5-wolf-nano.md).
