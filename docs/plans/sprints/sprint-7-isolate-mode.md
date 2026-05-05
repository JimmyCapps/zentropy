# Sprint 7 — Isolate mode #132 (Days 19-21)

**Theme:** Phase 7+ Stage 1: managed sandbox tab/profile so a flagged page can't reach the user's real session. **Tag:** none. **Recommended model:** `claude-opus-4-7`, effort high (security-critical design).

Master plan: [`../v0.1-completion.md` Sprint 7](../v0.1-completion.md#sprint-7-days-1921-isolate-mode-132--phase-7-stage-1). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: **`claude-opus-4-7`** (high effort). Security-critical; cookie/storage isolation must be exact.
- [ ] Plugins: baseline + `chrome-devtools-mcp` for incognito-window debugging.
- [ ] Repo state: v0.3.0-internal tag exists on main.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-opus-4-7 --effort high --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 7.1 — #132 Stage 1: design + sandbox tab/profile RFC

**Kickoff prompt:**
```
Execute Sprint 7 item 7.1 (#132 Stage 1: isolate mode RFC) per docs/plans/v0.1-completion.md Sprint 7 §7.1. Write design RFC at docs/proposals/isolate-mode.md covering: (1) trigger UX — "Isolate" button in popup + per-origin "always isolate" preference, (2) isolation primitive — chrome.windows.create({incognito: true, focused: true, ...}) OR a managed Chrome profile via chrome.identity API; pick one with rationale, (3) cookie / storage / cache containment guarantees, (4) escape paths to consider (window.opener, postMessage cross-window, drag-drop, copy/paste via clipboard), (5) UX for the user when an isolate happens (notification? automatic close on tab navigate-away?), (6) interaction with existing mitigations (network-guard, redirect-blocker still apply inside isolate window). Open chore issue first. Branch docs/issue-XXX-isolate-mode-rfc.
```

**Validation:**
- `docs/proposals/isolate-mode.md` exists on main
- RFC PR merged with explicit answers to all 6 design questions

---

## Item 7.2 — #132 Stage 2: implementation

**Kickoff prompt:**
```
Execute Sprint 7 item 7.2 (#132 Stage 2: isolate implementation) per docs/plans/v0.1-completion.md Sprint 7 §7.2. Pre-req: §7.1 RFC merged. Implement per RFC: (1) "Isolate this page" button in popup → SW message ISOLATE_PAGE, (2) SW handler creates incognito window via chrome.windows.create, opens the URL, returns success/failure to popup, (3) per-origin "always isolate" preference stored at honeyllm:isolate-preferences in chrome.storage.sync (or local — match RFC decision), (4) auto-isolate when verdict on a configured origin returns COMPROMISED, (5) preserve existing mitigations (network-guard, redirect-blocker) inside isolate window. Branch feat/issue-132-isolate-mode-impl.
```

**Validation:**
- `npm test` passes; new tests cover SW handler + popup wiring + preferences storage
- `gh pr view <N> --json state -q '.state'` → `MERGED`

---

## Item 7.3 — #132 Stage 3: testing

**Kickoff prompt:**
```
Execute Sprint 7 item 7.3 (#132 Stage 3: isolate testing) per docs/plans/v0.1-completion.md Sprint 7 §7.3. Add: (1) unit tests for SW message handler (DI seam for chrome.windows; jsdom doesn't cover it), (2) preference storage round-trip tests, (3) integration test scenario — popup click → message → handler → window.create stub assertion, (4) E2E if feasible via Playwright (incognito window control is limited but at least confirm popup button presence + click handler wires up). Branch test/issue-132-isolate-mode-tests.
```

**Validation:**
- `npm test` passes with isolate-mode tests
- `npm run test:e2e` passes if E2E added

---

## Item 7.4 [USER] — Smoke isolate mode

**Manual playbook:** [`../v0.1-completion.md` §M-8](../v0.1-completion.md#m-8--isolate-mode-smoke-sprint-7). Summary: load `dist/`, click "Isolate this page", confirm new incognito window opens; in incognito DevTools confirm cookies sandboxed; comment outcome on #132; close issue.

**Validation:**
- `gh issue view 132 --json state -q '.state'` → `CLOSED`
- Comment on #132 has screenshot of incognito DevTools showing empty cookie set

---

## Sprint 7 close-out

1. Epic #248: Sprint 7 ✅ DONE.
2. Open Sprint 8: [`sprint-8-local-proxy.md`](sprint-8-local-proxy.md).
