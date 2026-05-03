# Sprint 10 — Local LLM chat #4 + tag v0.5.0-internal (Days 28-30)

**Theme:** In-popup chat surface reusing existing canaries (Gemma WebGPU + Nano). **Tag at end:** `v0.5.0-internal`. **Recommended model:** `claude-sonnet-4-6`, effort medium.

Master plan: [`../v0.1-completion.md` Sprint 10](../v0.1-completion.md#sprint-10-days-2830-local-llm-chat-4--tag-v130). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-sonnet-4-6` (medium).
- [ ] Plugins baseline.
- [ ] Repo state: v0.4.0-internal tag exists; BYOK shipped (Sprint 9).

```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-sonnet-4-6
```

---

## Item 10.1 — #4 Stage 1: chat UI design

**Kickoff prompt:**
```
Execute Sprint 10 item 10.1 (#4 Stage 1: chat UI design) per docs/plans/v0.1-completion.md Sprint 10 §10.1. Design RFC at docs/proposals/local-chat.md covering: (1) where chat lives — new tab in popup vs separate options page, (2) canary selector — Gemma-2-2b WebGPU vs Gemini Nano vs (if Sprint 9 BYOK enabled) BYOK provider, (3) conversation history storage shape (chrome.storage.local keyed by conversation id), (4) privacy: no remote sync, history wiped on extension uninstall, (5) UX: streaming responses, cancel button, copy-to-clipboard, regenerate. Branch docs/issue-XXX-local-chat-rfc.
```

---

## Item 10.2 — #4 Stage 2: implementation

**Kickoff prompt:**
```
Execute Sprint 10 item 10.2 (#4 Stage 2: chat impl) per docs/plans/v0.1-completion.md Sprint 10 §10.2. Pre-req: §10.1 RFC. New src/chat/ surface: ui.ts (chat surface component), engine-router.ts (routes to existing canary engines via reused offscreen-doc message types — DO NOT load a second engine), history-store.ts. Mount in popup as a Chat tab. Reuse the streaming pattern from existing canary dispatch. TDD: engine-router routes to Gemma when Gemma loaded, to Nano when Nano loaded, surfaces canary-not-loaded error otherwise. Branch feat/issue-4-stage-2-chat-impl.
```

---

## Item 10.3 — #4 Stage 3: conversation history + storage

**Kickoff prompt:**
```
Execute Sprint 10 item 10.3 (#4 Stage 3: chat history) per docs/plans/v0.1-completion.md Sprint 10 §10.3. Implement history-store.ts: chrome.storage.local key honeyllm:chat:<conversation-id>, schema v1 = {id, title, messages: [{role, content, ts}], createdAt, updatedAt}. Cap N=50 conversations; oldest-pruned when over cap. Bulk delete for "Clear all chats". TDD: persist round-trip, cap enforcement, defensive against storage quota errors. Branch feat/issue-4-stage-3-chat-history.
```

---

## Item 10.4 — #4 Stage 4: testing

**Kickoff prompt:**
```
Execute Sprint 10 item 10.4 (#4 Stage 4: chat testing) per docs/plans/v0.1-completion.md Sprint 10 §10.4. Cover: streaming response rendering, cancel mid-stream, conversation persistence across popup close/open, switching canary mid-conversation, BYOK selection if Sprint 9 shipped. Branch test/issue-4-stage-4-chat-tests.
```

---

## Item 10.5 [USER] — Smoke chat with WebGPU + Nano

**Manual playbook:** [`../v0.1-completion.md` §M-11](../v0.1-completion.md#m-11--local-llm-chat-smoke-sprint-10). Summary: load `dist/`, open Chat tab, ask Gemma a question, confirm streamed response, switch to Nano, repeat. Comment + close.

**Validation:**
- `gh issue view 4 --json state -q '.state'` → `CLOSED`
- Comment on #4 has screenshot of streamed response

---

## Item 10.6 — Refresh ROADMAP + RAG_STATUS + RELEASE_NOTES_v0.5.0-internal.md

**Kickoff prompt:**
```
Execute Sprint 10 item 10.6 (release-cut prep for v0.5.0-internal). Update ROADMAP + clone RAG_STATUS. Write RELEASE_NOTES_v0.5.0-internal.md headlining: BYOK (#19) + Local LLM chat (#4). Branch docs/issue-XXX-release-prep-v0.5.
```

---

## Item 10.7 — Tag v0.5.0-internal

**Kickoff prompt:**
```
Execute Sprint 10 item 10.7 (tag v0.5.0-internal) per docs/plans/v0.1-completion.md Sprint 10 §10.7. Tests + build clean. Bump 0.4.0-internal → 0.5.0-internal. release/v0.5.0-internal branch + PR + tag + gh release create --prerelease.
```

---

## Sprint 10 close-out

1. Epic #248: Sprint 10 ✅ DONE.
2. Open Sprint 11: [`sprint-11-agentic-design.md`](sprint-11-agentic-design.md).
