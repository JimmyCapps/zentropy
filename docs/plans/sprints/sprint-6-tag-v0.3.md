# Sprint 6 — Wolf finish + #227 + tag v0.3.0-internal (Days 16-18)

**Theme:** Finish Wolf, ship harness state-query API, optionally run #15 mini-sweep, tag the second internal milestone. **Tag at end:** `v0.3.0-internal`. **Recommended model:** `claude-sonnet-4-6`, effort medium.

Master plan: [`../v0.1-completion.md` Sprint 6](../v0.1-completion.md#sprint-6-days-1618-wolf-finish--227--tag-v110). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-sonnet-4-6` (medium).
- [ ] Plugins baseline.
- [ ] Repo state: Wolf stages 1-3 on main; #60 + #119 on main.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-sonnet-4-6 --effort medium --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 6.1 — #3 Wolf stage 4: testing + benchmark + popup integration

**Kickoff prompt:**
```
Execute Sprint 6 item 6.1 (#3 Wolf stage 4) per docs/plans/v0.1-completion.md Sprint 6 §6.1. Run scripts/benchmark-dialect.ts --classifier spider+hawk+wolf against the 23-page test-pages/ corpus (NOT the 1250-corpus per memory rule project_hunter_corpus_split). Add Wolf row to popup hunter-findings UI mirroring the existing Spider/Hawk/embeddings rows. Validate Phase 2 byte-locked baseline byte-identical when Wolf is NOT the selected canary. CLOSES #3 if all stages 1-4 are green. Branch feat/issue-3-wolf-stage-4.
```

**Validation:**
- `gh issue view 3 --json state -q '.state'` → `CLOSED`
- Benchmark output JSON committed under `docs/testing/phase5/wolf-benchmark-2026-05-XX.json`
- `git diff main~1 -- docs/testing/inbrowser-results.json` shows zero diff
- Manual: load `dist/`, switch canary to Wolf in popup, visit injected fixture, confirm Wolf row appears in popup

---

## Item 6.2 — #227 harness-mediated live state query API

**Kickoff prompt:**
```
Execute Sprint 6 item 6.2 (#227 harness state-query API) per docs/plans/v0.1-completion.md Sprint 6 §6.2. Build a chrome.runtime.sendMessage({type: 'STATE_QUERY'}) handler in src/service-worker/index.ts that returns {loadedCanary, activeMitigations, lastVerdict, telemetryCounters: {cache, response, intercept, thinking, packMatch, registry}}. Used by harness for non-disruptive state introspection (no UI side effects). TDD: 8 cases — each return field present, missing-state defaults (e.g. no canary loaded → loadedCanary: null), unknown-message-type rejection, defensive against runtime.lastError. Branch feat/issue-227-state-query-api.
```

**Validation:**
- `gh issue view 227 --json state -q '.state'` → `CLOSED`
- `npm test` includes 8 new state-query tests
- Manual: `chrome.runtime.sendMessage({type: 'STATE_QUERY'})` from harness or DevTools console returns the expected shape

---

## Item 6.3 — #15 Phase 8 mini-sweep (CONDITIONAL)

**Run only if Sprint 3's Phase 6 telemetry review (item 3.3) flagged Stage-6 deltas.** Otherwise skip; close #15 in Sprint 12 with a "no signal in telemetry" note.

**Kickoff prompt (only if conditional fires):**
```
Execute Sprint 6 item 6.3 (#15 Phase 8 mini-sweep) per docs/plans/v0.1-completion.md Sprint 6 §6.3. Pre-req: Sprint 3's TELEMETRY_REVIEW doc flagged Stage-6 deltas needing re-sample. Run the mini-sweep on the 3 un-re-sampled Stage 6 deltas. Output JSON sidecar; commit on test/issue-15-mini-sweep.
```

**Validation if run:**
- `gh issue view 15 --json state -q '.state'` → `CLOSED`
- Sidecar JSON committed

---

## Item 6.4 — Refresh ROADMAP + RAG_STATUS + RELEASE_NOTES_v0.3.0-internal.md

**Kickoff prompt:**
```
Execute Sprint 6 item 6.4 (release-cut prep for v0.3.0-internal) per docs/plans/v0.1-completion.md Sprint 6 §6.4. Update docs/ROADMAP.md with Sprint 4-6 closures. Clone docs/RAG_STATUS_<prev>.md → docs/RAG_STATUS_2026-05-XX.md. Write docs/RELEASE_NOTES_v0.3.0-internal.md headlining: Wolf canary shipped (third canary engine), DetermiLLM bridge complete (DM-A/E/F/G), Nano in-chunk abort (#60), xlm-roberta language detection (#119), harness state-query API (#227). Branch docs/issue-XXX-release-prep-v0.3 (open chore issue first).
```

**Validation:** doc files exist on main.

---

## Item 6.5 — Tag v0.3.0-internal

**Kickoff prompt:**
```
Execute Sprint 6 item 6.5 (tag v0.3.0-internal) per docs/plans/v0.1-completion.md Sprint 6 §6.5. Run npm ci && npm run typecheck && npm test && npm run build:release && npm run test:e2e — all must pass. Bump manifest.json + package.json from 0.2.0-internal → 0.3.0-internal. Branch release/v0.3.0-internal; PR with --body-file docs/RELEASE_NOTES_v0.3.0-internal.md; squash-merge after CI green. git tag v0.3.0-internal && git push origin v0.3.0-internal && gh release create v0.3.0-internal -F docs/RELEASE_NOTES_v0.3.0-internal.md --prerelease.
```

**Validation:**
- `git tag` lists `v0.3.0-internal`
- `gh release view v0.3.0-internal` returns the release

---

## Sprint 6 close-out

1. Epic #248: Sprint 6 ✅ DONE; tag link in summary block.
2. Open Sprint 7: [`sprint-7-isolate-mode.md`](sprint-7-isolate-mode.md).
