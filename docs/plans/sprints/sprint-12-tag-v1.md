# Sprint 12 — Scheduled/agentic finish + tag v1.0.0 (Days 34-36)

**Theme:** Implement the agentic loop against the Sprint 11 RFC, smoke it, and cut the first publicly releasable tag. **Tag at end:** `v1.0.0`. **Recommended model:** `claude-sonnet-4-6`, effort medium (implementation against locked design).

Master plan: [`../v0.1-completion.md` Sprint 12](../v0.1-completion.md#sprint-12-days-3436-scheduledagentic-finish--tag-v200). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-sonnet-4-6` (medium). RFC + foundation done in Sprint 11; Sprint 12 is implementation.
- [ ] Plugins baseline.
- [ ] Repo state: Sprint 11 deliverables on main (RFC + alarms-bridge + task-store + verdict-gate).

```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-sonnet-4-6
```

---

## Item 12.1 — #5 Stage 4: agentic loop

**Kickoff prompt:**
```
Execute Sprint 12 item 12.1 (#5 Stage 4: agentic loop) per docs/plans/v0.1-completion.md Sprint 12 §12.1. Pre-req: Sprint 11 §11.3 verdict-gate on main. Implement src/agentic/loop.ts: when an alarm fires, (1) load task from task-store, (2) open URL in isolate window per #132 if task isolate-required (always true per RFC), (3) wait for verdict on the loaded page, (4) for each action in task definition: gate(action) → execute or skip per gate decision, (5) emit telemetry, (6) close isolate window when done. Surface a "Run now" button in popup for manual trigger of any scheduled task. TDD: 10 cases — alarm-fires-loads-task, isolate-window-spawns, verdict-gates-block-violations, telemetry-emits, cleanup-on-error, manual-trigger-bypasses-schedule. Branch feat/issue-5-stage-4-agentic-loop.
```

---

## Item 12.2 — #5 Stage 5: testing

**Kickoff prompt:**
```
Execute Sprint 12 item 12.2 (#5 Stage 5: agentic testing) per docs/plans/v0.1-completion.md Sprint 12 §12.2. Add: (1) integration test stubbing chrome.alarms + chrome.windows + verdict-router (DI seams), (2) end-to-end scenario: task fires → isolate spawn → CLEAN verdict → action executes → telemetry recorded, (3) negative scenario: task fires → COMPROMISED verdict → all actions blocked → task aborts with hard-violation log. Branch test/issue-5-stage-5-agentic-tests.
```

---

## Item 12.3 [USER] — Smoke agentic task with simulated injection

**Manual playbook:** [`../v0.1-completion.md` §M-12](../v0.1-completion.md#m-12--scheduled--agentic-task-smoke-sprint-12). Summary: build, load `dist/`, create a daily task pointing at a clean fixture; force-trigger; confirm runs in isolate mode + summary returned. Edit task to point at injection fixture; force-trigger; confirm aborts with verdict-gate violation. Comment + close.

**Validation:**
- `gh issue view 5 --json state -q '.state'` → `CLOSED`
- Comment on #5 has logs showing both clean execution + violation abort

---

## Item 12.4 — Refresh ROADMAP + RAG_STATUS + RELEASE_NOTES_v1.0.0.md

**Kickoff prompt:**
```
Execute Sprint 12 item 12.4 (release-cut prep for v1.0.0) per docs/plans/v0.1-completion.md Sprint 12 §12.4. Update docs/ROADMAP.md: every closed v1.0 issue actually closed; v1.0 row → 100%. Clone RAG_STATUS to a new dated file capturing the v1.0.0 state. Write docs/RELEASE_NOTES_v1.0.0.md as the FIRST PUBLICLY RELEASABLE release notes. Headline capabilities: 4 hunters (Spider/Hawk/embeddings/DetermiLLM-stub), 3 canaries (Gemma-2-2b WebGPU / Gemini Nano / Wolf Llama-3.2-1B), image-injection probe (multimodal Nano), classifier v3, dual-path mitigations w/ deactivation lifecycle, signed registry, isolate mode, local proxy w/ root CA, BYOK (Anthropic/OpenAI/Google), local LLM chat, scheduled/agentic tasks w/ verdict-gating. Known issues remaining: #76 npm publish (deferred), DetermiLLM core packs (DM-B/C/D + #75 in DetermiLLM phase), any deferred per scope-cuts. Branch docs/issue-XXX-release-prep-v1.0.
```

---

## Item 12.5 — Tag v1.0.0

**Kickoff prompt:**
```
Execute Sprint 12 item 12.5 (TAG v1.0.0 — first publicly releasable) per docs/plans/v0.1-completion.md Sprint 12 §12.5. Run npm ci && npm run typecheck && npm test && npm run build:release && npm run test:e2e — ALL must pass. Bump manifest.json + package.json from 0.5.0-internal → 1.0.0 (NOTE: drops the -internal suffix). Branch release/v1.0.0; PR with --body-file docs/RELEASE_NOTES_v1.0.0.md; squash-merge after CI green. git checkout main && git pull && git tag v1.0.0 && git push origin v1.0.0 && gh release create v1.0.0 -F docs/RELEASE_NOTES_v1.0.0.md (NO --prerelease flag — this is the first public release).
```

**Validation:**
- `git tag` lists `v1.0.0` (no -internal suffix)
- `gh release view v1.0.0` shows it as a non-prerelease
- All test suites green
- `manifest.json` and `package.json` show version `1.0.0`

---

## Project close-out

When `v1.0.0` ships:

1. Edit epic #248: mark Sprint 12 ✅ DONE; mark the entire epic complete; close manually (per the never-close-from-PR rule).
2. Archive the plan doc: `git mv docs/plans/v0.1-completion.md docs/plans/archive/v0.1-completion-COMPLETE-2026-XX-XX.md`. Optionally archive the sprint files alongside.
3. Open a fresh plan for what comes next:
   - DetermiLLM phase (DM-B/C/D + #75 dialect packs) is the only remaining concentrated work
   - #76 npm publish if the user signals readiness
   - Anything new that surfaced during the 12 sprints
4. Comment on the GitHub Project board indicating it's now closed for new items.
