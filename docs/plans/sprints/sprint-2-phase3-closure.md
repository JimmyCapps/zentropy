# Sprint 2 — Phase 3 closure + image probe + maintainer smokes (Days 4-6)

**Theme:** Close Phase 3 Track B + ship image-injection popup + run maintainer smokes. **Tag:** none. **Recommended model:** `claude-haiku-4-5-20251001`, effort medium.

Master plan: [`../v0.1-completion.md` Sprint 2](../v0.1-completion.md#sprint-2-days-46-phase-3-closure--image-probe--maintainer-smokes). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-haiku-4-5-20251001` (medium effort).
- [ ] Plugins: same baseline as Sprint 1.
- [ ] MCP: claude-in-chrome (for #124 smoke), playwright. Disable chrome-devtools-mcp if Sprint 1's Officeworks work is done.
- [ ] Repo state: `git checkout main && git pull --ff-only && npm test` → all pass.
- [ ] Confirm: PR #221, #226 fix, #232 fix all on main from Sprint 1.

```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-haiku-4-5-20251001
```

---

## Item 2.1 — #2 reframe doc to N10 methodology

**What:** Rewrite issue #2's body to reflect the N10 methodology (`docs/testing/phase5/methodology.md`) instead of the deprecated synthetic-fixture sweep plan. Doc-only, no code.

**Kickoff prompt:**
```
Execute Sprint 2 item 2.1 (#2 reframe doc) per docs/plans/v0.1-completion.md Sprint 2 §2.1. Read docs/testing/phase5/methodology.md (N10), then rewrite #2's body to consume N10 instead of the deprecated Track B sweep plan. Branch docs/issue-2-reframe. PR body MUST say "Refs #2" — NEVER "Closes #2" (memory rule feedback_issue_2_never_closes.md).
```

**Validation:**
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- `gh issue view 2` body shows N10-aligned plan
- `gh issue view 2 --json state -q '.state'` → still `OPEN` (#2 stays open by rule)

**Closeout:** none — but verify the PR did NOT auto-close #2.

---

## Item 2.2 [USER] — #2 Track B B5 manual leg

**Manual playbook:** [`../v0.1-completion.md` §M-2](../v0.1-completion.md#m-2--2-track-b-b5-manual-leg-sprint-2). Summary: ~2 hours. For each of 23 fixtures × 3 agents (Claude.ai, ChatGPT, Gemini), record verdict + emitted URLs. Commit on `docs/issue-2-b5-manual-leg`; PR body `Refs #2`.

**Pre-req:** confirm fixture host: `curl -I https://fixtures.host-things.online/test-pages/manifest.json` returns 200.

**Validation:**
- New section "Real-wrapper run 2026-05-XX" exists in `docs/testing/phase3/STAGE_B5_RESULTS.md`
- 23 × 3 grid populated
- PR merged with `Refs #2`; #2 stays open

---

## Item 2.3 — #9 4G.6a popup multimodal column

**What:** Add a popup accordion that renders image-injection probe findings (the `image_injection` flag from PR #205). Mirrors `embeddings-findings.ts` + `registry-stats.ts` patterns. UI-only; no probe-runner change.

**Kickoff prompt:**
```
Execute Sprint 2 item 2.3 (#9 4G.6a popup multimodal column) per docs/plans/v0.1-completion.md Sprint 2 §2.3. Mirror src/popup/embeddings-findings.ts + src/popup/registry-stats.ts patterns: lazy DOM query, three render branches (no probe data / probe ran no images / probe with findings), idempotent re-render. Reads from SecurityVerdict.imageInjectionFindings (add the optional field if not yet on the type, defaulting null). No probe-runner / orchestrator change. Branch feat/issue-9-4g6a-popup-multimodal.
```

**Validation:**
- `npm test` includes new popup-render tests; all pass
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- Manual: load `dist/`, visit a `test-pages/injected-images/` fixture, popup shows the new accordion

**Closeout:** #9 stays open (4G.5 + 4G.6b still pending). Verify PR body says `Refs #9` not `Closes #9`.

---

## Item 2.4 [USER] — #9 4G.5 Nano image smoke sweep

**Pre-req:** fix the Chrome extension-load error blocking 4G.5 first (see `chrome://extensions/` → HoneyLLM → "Errors" button if any present).

**Manual playbook:** [`../v0.1-completion.md` §M-3](../v0.1-completion.md#m-3--9-4g5-nano-image-smoke-sweep-sprint-2). Summary: EPP-enrolled Chrome, walk 5 injected-image fixtures + 1 clean control, commit JSON sidecar.

**Validation:**
- File `docs/testing/phase4/4G5-nano-image-sweep-2026-05-XX.json` exists with 6 entries
- PR merged with `Refs #9`

---

## Item 2.5 — #9 4G.6b NANO_BASELINE_ADDENDUM (depends on 2.4)

**What:** Append a multimodal-coverage section to `docs/testing/phase3/NANO_BASELINE_ADDENDUM.md` from the Day 5 sweep output.

**Kickoff prompt:**
```
Execute Sprint 2 item 2.5 (#9 4G.6b NANO_BASELINE_ADDENDUM) per docs/plans/v0.1-completion.md Sprint 2 §2.5. Pre-req: 2.4 sweep JSON is on main at docs/testing/phase4/4G5-nano-image-sweep-2026-05-XX.json. Append a "Multimodal coverage" section to docs/testing/phase3/NANO_BASELINE_ADDENDUM.md with: per-fixture verdict table, per-technique flag-emission rate, comparison vs text-mode-only Nano baseline. Closes #9 since this is the final 4G stage. Branch docs/issue-9-4g6b-addendum.
```

**Validation:**
- `gh issue view 9 --json state -q '.state'` → `CLOSED`
- `docs/testing/phase3/NANO_BASELINE_ADDENDUM.md` shows the new section

---

## Item 2.6 [USER] — #124 Browse MCP smoke

**Manual playbook:** [`../v0.1-completion.md` §M-4](../v0.1-completion.md#m-4--124-browse-mcp-smoke-sprint-2). Summary: configure Claude Desktop, run `browse` tool against Wikipedia + injection fixture, comment + close.

**Validation:**
- `gh issue view 124 --json state -q '.state'` → `CLOSED`
- Comment on #124 has screenshots showing CLEAN + COMPROMISED dispatches

---

## Item 2.7 [USER] — #129 embeddings smoke

**Manual playbook:** [`../v0.1-completion.md` §M-5](../v0.1-completion.md#m-5--129-embeddings-smoke-sprint-2). Summary: load extension unpacked, hit a known-injection honeypot, confirm embeddings accordion renders.

**Validation:**
- `gh issue view 129 --json state -q '.state'` → `CLOSED`
- Comment on #129 has screenshot of the accordion row with cosine ≥ 0.85

---

## Item 2.8 [USER] — #8 Chromium-family compat audit

**Manual playbook:** [`../v0.1-completion.md` §M-6](../v0.1-completion.md#m-6--8-chromium-family-compat-audit-sprint-2). Summary: 6 browsers × 2 test pages, fill `docs/testing/phase4/COMPAT_AUDIT.md` rows.

**Pre-req before user runs:** ask Claude in a quick session to scaffold the empty `docs/testing/phase4/COMPAT_AUDIT.md` template with one row per browser.

**Validation:**
- `gh issue view 8 --json state -q '.state'` → `CLOSED`
- File exists with 6 rows populated

---

## Item 2.9 — #2 B7 regression report (depends on 2.2)

**What:** Populate `docs/testing/phase3/PHASE3_REGRESSION_REPORT.md` §4 + §8 from the B5 + #14 outputs. Cross-reference 2026-04-20 baseline.

**Kickoff prompt:**
```
Execute Sprint 2 item 2.9 (#2 B7 regression report) per docs/plans/v0.1-completion.md Sprint 2 §2.9. Pre-req: B5 results on main from item 2.2 + #14 sidecar from Sprint 1 item 1.6. Populate docs/testing/phase3/PHASE3_REGRESSION_REPORT.md §4 (real-wrapper findings) and §8 (efficacy verdict). Cross-reference 2026-04-20 direct-API baseline (PR #82) and classifier v2/v3 deltas. PR body MUST say "Refs #2" — NEVER "Closes #2".
```

**Validation:**
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- §4 + §8 populated; #2 stays open

**Closeout:** verify PR did NOT auto-close #2.

---

## Sprint 2 close-out

When all 9 items show CLOSED/MERGED (except #2 which stays open by rule):

1. Edit epic #248; mark Sprint 2 ✅ DONE.
2. Spillover log: append any cross-issue progress (likely none this sprint).
3. Open Sprint 3: [`sprint-3-tag-v0.2.md`](sprint-3-tag-v0.2.md).
