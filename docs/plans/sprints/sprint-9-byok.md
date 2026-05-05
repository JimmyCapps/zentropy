# Sprint 9 — BYOK #19 (Days 25-27)

**Theme:** Bring-Your-Own-Key for Anthropic + OpenAI + Google providers, gated by per-origin policy. **Tag:** none. **Recommended model:** `claude-sonnet-4-6`, effort medium (well-trodden patterns).

Master plan: [`../v0.1-completion.md` Sprint 9](../v0.1-completion.md#sprint-9-days-2527-byok-19). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-sonnet-4-6` (medium).
- [ ] Plugins baseline + `context7` for SDK docs lookup.
- [ ] Repo state: v0.4.0-internal tag exists.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-sonnet-4-6 --effort medium --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 9.1 — #19 Stage 1: design + provider abstraction

**Kickoff prompt:**
```
Execute Sprint 9 item 9.1 (#19 Stage 1: BYOK design) per docs/plans/v0.1-completion.md Sprint 9 §9.1. Design RFC at docs/proposals/byok.md covering: (1) provider adapter interface mirroring mcp-server/src/probes/llm-endpoint.ts (LlmEndpoint shape), (2) key storage in chrome.storage.session (memory-only, not synced — wipes on browser restart) — rationale: API keys are sensitive, never sync, never persist beyond session, (3) per-origin policy ("use BYOK Claude for anthropic.com tabs"), (4) fallback behaviour on quota / network errors → fall back to local canary with telemetry log, (5) security model: keys never leave the offscreen doc; popup never sees raw key (only a redacted last-4-chars indicator). Open chore issue first. Branch docs/issue-XXX-byok-rfc.
```

---

## Item 9.2 — #19 Stage 2: implementation (3 adapters)

**Kickoff prompt:**
```
Execute Sprint 9 item 9.2 (#19 Stage 2: BYOK adapters) per docs/plans/v0.1-completion.md Sprint 9 §9.2. Pre-req: §9.1 RFC merged. Create src/probes/byok/ with: (1) types.ts defining BYOKProvider interface, (2) anthropic-byok.ts (Anthropic Messages API; current default model claude-opus-4-7), (3) openai-byok.ts (OpenAI Responses API or Chat Completions; current default gpt-5.4), (4) google-byok.ts (Gemini API; default gemini-3-flash-preview), (5) storage.ts for chrome.storage.session key handling, (6) policy.ts for per-origin routing rules. TDD: 6 cases per adapter (success, quota error fallback, network error fallback, key-not-set error, model-not-set error, response-shape validation). Branch feat/issue-19-stage-2-byok-adapters.
```

---

## Item 9.3 — #19 Stage 3: settings UI in popup/options

**Kickoff prompt:**
```
Execute Sprint 9 item 9.3 (#19 Stage 3: BYOK UI) per docs/plans/v0.1-completion.md Sprint 9 §9.3. Add BYOK section to popup settings (or new options page if popup is too crowded). Per provider: paste-key field (password-type input; show last-4 only after save), model selector dropdown, "Test connection" button (sends a 1-token completion to validate), per-origin policy editor. Keys stored via storage.ts (Stage 2). Branch feat/issue-19-stage-3-byok-ui.
```

---

## Item 9.4 — #19 Stage 4: testing

**Kickoff prompt:**
```
Execute Sprint 9 item 9.4 (#19 Stage 4: BYOK testing) per docs/plans/v0.1-completion.md Sprint 9 §9.4. Add: integration test for popup settings → storage → adapter selection on next probe dispatch; jsdom test for the popup UI components; Playwright E2E if feasible (mocking the API endpoint). Branch test/issue-19-stage-4-byok-tests.
```

---

## Item 9.5 [USER] — Smoke each provider with own key

**Manual playbook:** [`../v0.1-completion.md` §M-10](../v0.1-completion.md#m-10--byok-provider-smoke-sprint-9). Summary: get keys for Anthropic + OpenAI + Google; for each: paste key, select model, test connection, visit a test page, confirm popup shows the BYOK model name. Comment + close per provider.

**Validation:**
- `gh issue view 19 --json state -q '.state'` → `CLOSED`
- 3 comments on #19, one per provider, each with a screenshot

---

## Sprint 9 close-out

1. Epic #248: Sprint 9 ✅ DONE.
2. Open Sprint 10: [`sprint-10-local-chat.md`](sprint-10-local-chat.md).
