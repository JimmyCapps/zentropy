# Sprint 1 — Stability (Days 1-3)

**Theme:** Bug fixes + observability primary. **Tag at end:** none. **Recommended model:** `claude-haiku-4-5-20251001`, effort medium.

Master plan section: [`../v0.1-completion.md` Sprint 1](../v0.1-completion.md#sprint-1-days-13-stability--bugs--observability).
Tracking: epic #248. Project board: <https://github.com/users/JimmyCapps/projects/1>.

---

## Pre-flight checklist (run once at sprint start)

- [ ] **Model:** `claude-haiku-4-5-20251001` (medium effort). Bug fixes + plumbing — well-specified TDD-first work.
- [ ] **Plugins (recommended state):** keep superpowers, feature-dev, code-simplifier, commit-commands, code-review, security-guidance, typescript-lsp, chrome-devtools-mcp, playwright, context7, hookify. Disable cloudflare, huggingface-skills, agent-sdk-dev, playground, skill-creator, claude-code-setup if still on.
- [ ] **MCP servers needed:** chrome-devtools-mcp (for #217 profiling), playwright (for E2E tests). Others not load-bearing for this sprint.
- [ ] **Repo state:** `cd /Users/node3/Documents/projects/HoneyLLM && git checkout main && git pull --ff-only && npm test` → all pass.
- [ ] **Confirm scope:** read [Sprint 1 spec](../v0.1-completion.md#sprint-1-days-13-stability--bugs--observability) — bricklink fix expects #226 logs to identify primitive; Officeworks 4-step diagnostic in #217 body.

**Start Claude in repo root:**
```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-haiku-4-5-20251001
```

---

## Item 1.1 — Rebase + merge PR #221 (closes #220)

**What:** PR #221 deactivates network-guard + redirect-blocker on benign re-verdict; CI green but mergeable=CONFLICTING vs main. Rebase onto main, resolve the expected `src/content/index.ts` conflict near `applyMitigations` extraction, push, auto-merge.

**Kickoff prompt:**
```
Execute Sprint 1 item 1.1 (PR #221 rebase + merge — closes #220) per docs/plans/v0.1-completion.md Sprint 1 §1.1. Conflict expected in src/content/index.ts near applyMitigations extraction; keep PR #221's extraction shape, replay newer changes inside the new module. Push --force-with-lease, wait for CI, squash-merge, delete branch.
```

**Validation:**
- `gh pr view 221 --json state -q '.state'` → `MERGED`
- `gh issue view 220 --json state -q '.state'` → `CLOSED`
- `git log -1 --oneline main` shows the merge commit

**Closeout:** none — #220 closes via the PR.

---

## Item 1.2 — #226 logging coverage

**What:** Adds chunk + hunter + probe-selection log entries to the existing LogBus jsonl pipeline. Unblocks #232 triage by exposing per-hunter scores.

**Kickoff prompt:**
```
Execute Sprint 1 item 1.2 (#226 logging coverage) per docs/plans/v0.1-completion.md Sprint 1 §1.2. TDD-first: write src/tests/observability/pipeline-trace.test.ts asserting jsonl emits {chunk_created, hunter_run:spider, hunter_run:hawk, hunter_run:embeddings, probe_selected, probe_run, verdict_emitted} for a synthetic PageSnapshot. Touch src/service-worker/orchestrator.ts, src/hunters/{spider,hawk,embeddings}/, src/service-worker/dispatch.ts. Reuse src/log-viewer/file-writer.ts (#222/#223/#225 infra) — do NOT introduce a parallel sink. Extend LogEvent union in src/types/messages.ts. Phase 2 byte-locked baseline must stay byte-identical (logging is display-only). Spillover note: #236 already shipped the LogBus Port pattern (commit e56996a) — write into that infra. Branch feat/issue-226-pipeline-logging.
```

**Validation:**
- `npm test -- --run pipeline-trace` passes
- `gh pr view <N> --json state -q '.state'` → `MERGED` (auto-merge after CI)
- `gh issue view 226 --json state -q '.state'` → `CLOSED`
- Manual: `npm run build`, load `dist/` unpacked, scan a Wikipedia page, confirm new entries appear in `docs/logs/<latest>/`.
- Phase 2 baseline unchanged: `git diff HEAD~1 -- docs/testing/inbrowser-results.json` shows no diff.

**Closeout:** none — #226 closes via the PR.

---

## Item 1.3 — #232 bricklink false-positive fix (depends on 1.2)

**What:** Use the new #226 jsonl to identify which primitive flagged bricklink.com. Likely embeddings hunter (J.Burrows precedent). Fix the calibration; lock with a regression test.

**Kickoff prompt:**
```
Execute Sprint 1 item 1.3 (#232 bricklink false-positive fix) per docs/plans/v0.1-completion.md Sprint 1 §1.3. Pre-req: #226 must be merged. Workflow: re-run a bricklink scan with the new jsonl; identify flagging primitive from per-hunter scores. If embeddings: add commerce/promotional-copy negative examples to data/injection-corpus.json + npm run embed:corpus + lock with "Buy now! Click here! Limited offer!" unit test below EMBEDDING_COSINE_THRESHOLD = 0.85. If Hawk or Spider: tune that primitive + add bricklink homepage to test-pages/clean/ as a regression fixture. Acceptance: 3 consecutive CLEAN scans of bricklink.com/v2/main.page. Branch fix/issue-232-bricklink-fp.
```

**Validation:**
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- `gh issue view 232 --json state -q '.state'` → `CLOSED`
- Manual: load `dist/`, visit `https://www.bricklink.com/v2/main.page` 3 times, all CLEAN.

**Closeout:** none.

---

## Item 1.4 — #217 Officeworks renderer leak (independent)

**What:** Issue body has 4-step diagnostic (network delta → outerHTML test → fetch toString test → heap profile). Cheapest-first; ship a fix or a documented known-issue note.

**Kickoff prompt:**
```
Execute Sprint 1 item 1.4 (#217 Officeworks renderer leak) per docs/plans/v0.1-completion.md Sprint 1 §1.4. Execute the 4-step diagnostic from issue #217's body cheapest-first: (1) network-panel delta enabled vs disabled, (2) `outerHTML = ''` test in src/content/ingestion/extractor.ts:64, (3) Function.prototype.toString mask in src/content/main-world-inject.ts, (4) heap profile only if 1-3 don't localise. Decision tree per issue body. If localised: ship fix on fix/issue-217-<root-cause> with regression test. If not: write known-issue paragraph for the eventual docs/RELEASE_NOTES_v0.2.0-internal.md and file a v0.2.0.x patch issue with the captured profile.
```

**Validation:**
- Either: `gh pr view <N> --json state -q '.state'` → `MERGED` AND Officeworks homepage idle 5 min stays bounded (<1 GB renderer)
- Or: `gh issue view 217` shows known-issue triage comment with profile attachment

**Human testing for the diagnostic:**
1. Open Chrome with HoneyLLM unpacked (use the test profile, not your daily profile — the leak escalates fast).
2. Open Chrome Task Manager (`Window` → `Task Manager`) and macOS Activity Monitor (sort by Memory).
3. Visit `https://www.officeworks.com.au/` (homepage, NOT a product detail page).
4. Note the tab renderer's PID; record memory baseline at T=0.
5. Leave the tab idle 5 minutes — do not interact.
6. Record memory at T=5min. Compare against memory at the same time with HoneyLLM disabled on the site (popup → "Never scan on officeworks.com.au").
7. After each fix attempt (steps 2 and 3 in the diagnostic), repeat 1-6 and record the delta.
8. Comment results on #217 per attempt.

**Closeout:** none if fix lands; else manual issue update with known-issue posture.

---

## Item 1.5 — #157 strict-LLM-bypass gate-check + ship-or-close

**What:** Telemetry gate: read `honeyllm:cache-telemetry` for `ner_exfil_fast_path` hit-rate over the last 7+ days. ≥10% AND reasonable LLM-disagreement → ship Option A (skip LLM call on fast-path hits). Else close as won't-fix with the rate documented.

**Kickoff prompt:**
```
Execute Sprint 1 item 1.5 (#157 strict-LLM-bypass gate-check) per docs/plans/v0.1-completion.md Sprint 1 §1.5. Read honeyllm:cache-telemetry storage from a recent SW console dump or harness query (#227 isn't shipped yet, so use chrome.storage.local DevTools panel). Compute 7-day ner_exfil_fast_path hit-rate + LLM-disagreement rate. If hit-rate ≥10% AND disagreement reasonable → implement Option A in src/probes/orchestrator: skip LLM call when ner_exfil_fast_path flag set, branch feat/issue-157-strict-llm-bypass. Else close #157 as won't-fix with measurements documented in close comment.
```

**Validation:**
- `gh issue view 157 --json state -q '.state'` → `CLOSED` (either via PR merge or won't-fix)
- If shipped: `npm test` includes new orchestrator skip-path test that passes
- Close comment cites measured hit-rate + disagreement-rate

**Closeout:** if ship path → none (PR closes). If won't-fix path → ensure close comment has the measurement table (don't close silently).

---

## Item 1.6 [USER] — #14 Nano replicate-sampling

**What:** Run the already-patched harness through the 162 affected-baseline rows × 5 replicates each. ~1 hour. Output JSON sidecar that informs Sprint 2's #2 B7 regression report.

**Human steps (no Claude session needed):**

1. Open EPP-enrolled Chrome profile (the one with Gemini Nano available).
2. Confirm Nano is downloaded: visit `chrome://on-device-internals/` → "Optimization Guide" tab → "Available" for Gemini Nano.
3. From repo root: `npm run build && npm run harness:nano` — opens the harness in a new tab.
4. Click "Run Replicates Sweep" (button added by PR #82); wait ~10 minutes.
5. Sidecar JSON writes to browser downloads as `nano-replicates-2026-05-XX.json`. Move into `docs/testing/phase4/`.
6. Branch + commit:
   ```bash
   git checkout -b test/issue-14-nano-replicates
   git add docs/testing/phase4/nano-replicates-2026-05-*.json
   git commit -m "test(harness-#14): Nano replicate-sampling on affected baseline"
   git push -u origin test/issue-14-nano-replicates
   gh pr create --base main --title "test(harness-#14): Nano replicate-sampling on affected baseline" --body "Closes #14"
   ```
7. Auto-merge after CI green.

**Validation:**
- `gh issue view 14 --json state -q '.state'` → `CLOSED`
- File `docs/testing/phase4/nano-replicates-2026-05-XX.json` exists on main with 162 rows × 5 replicates

---

## Sprint 1 close-out

When all 6 items above show `CLOSED` (or shipped), update epic #248:

1. Edit issue #248; mark Sprint 1 ✅ DONE in the sprint summary block.
2. If any spillover happened (e.g. #226's logging unexpectedly closed #157's measurement need), append to the spillover log section.
3. No tag this sprint — v0.2.0-internal lands at end of Sprint 3.
4. Open Sprint 2 by reading [`sprint-2-phase3-closure.md`](sprint-2-phase3-closure.md).
