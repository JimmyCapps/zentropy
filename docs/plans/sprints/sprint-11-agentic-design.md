# Sprint 11 — Scheduled/agentic security model (Days 31-33)

**Theme:** Design + foundation for #5 scheduled/agentic tasks. Heavy on security RFC; implementation finishes in Sprint 12. **Tag:** none. **Recommended model:** `claude-opus-4-7`, effort high (security model must be right first time).

Master plan: [`../v0.1-completion.md` Sprint 11](../v0.1-completion.md#sprint-11-days-3133-scheduled--agentic-tasks-5--security-first-design). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: **`claude-opus-4-7`** (high effort). Agentic actions with verdict-gating must be airtight.
- [ ] Plugins: baseline + `security-guidance`.
- [ ] Repo state: v0.5.0-internal tag exists; isolate mode (#132) on main.

```bash
cd /Users/node3/Documents/projects/HoneyLLM && claude --model claude-opus-4-7
```

---

## Item 11.1 — #5 Stage 1: security model RFC

**Kickoff prompt:**
```
Execute Sprint 11 item 11.1 (#5 Stage 1: agentic security RFC) per docs/plans/v0.1-completion.md Sprint 11 §11.1. Write docs/proposals/agentic-security.md covering invariants: (1) NO network call without a CLEAN verdict on the source page (verdict-gate.ts checker on every outbound action), (2) isolate-mode mandatory for any agentic browsing (#132 enforced), (3) per-task allow-lists for origins / actions, (4) user must approve any cross-origin action (one-time consent UI), (5) telemetry: every gated action logged to honeyllm:agentic-telemetry with {taskId, action, origin, verdict, decision, ts}, (6) failure modes — silent skip on soft violation, hard abort + notification on hard violation, (7) tasks resumable across browser restart via chrome.alarms. Open chore issue first. Branch docs/issue-XXX-agentic-security-rfc.
```

**Validation:**
- `docs/proposals/agentic-security.md` exists on main with explicit answers to all 7 invariants

---

## Item 11.2 — #5 Stage 2: chrome.alarms integration + task storage

**Kickoff prompt:**
```
Execute Sprint 11 item 11.2 (#5 Stage 2: alarms + storage) per docs/plans/v0.1-completion.md Sprint 11 §11.2. Pre-req: §11.1 RFC merged. Implement: (1) src/agentic/task-store.ts — task definitions in chrome.storage.local keyed by task id; schema {id, title, schedule, urlPattern, actions, allowList, createdAt}, (2) src/agentic/alarms-bridge.ts — chrome.alarms.create / onAlarm.addListener wired to task-store, (3) tasks resumable across browser restart (alarms persist; task definitions in storage). TDD: 8 cases — task CRUD, alarm fires correct task, restart resilience, malformed-task defensive. Branch feat/issue-5-stage-2-alarms-storage.
```

---

## Item 11.3 — #5 Stage 3: verdict-gate (security constraints)

**Kickoff prompt:**
```
Execute Sprint 11 item 11.3 (#5 Stage 3: verdict-gate) per docs/plans/v0.1-completion.md Sprint 11 §11.3. Pre-req: §11.2. Implement src/agentic/verdict-gate.ts: every agentic action passes through gate(action, currentVerdict, taskAllowList). Returns {allow: true} | {allow: false, reason: 'verdict_unclean' | 'origin_not_in_allowlist' | 'cross_origin_no_consent' | 'isolate_mode_required'}. Wire to honeyllm:agentic-telemetry. Hard violations → task aborts; soft violations → silent skip with telemetry. TDD: 12 cases covering each refusal class + allow path + edge cases. Branch feat/issue-5-stage-3-verdict-gate.
```

---

## Sprint 11 close-out

1. Epic #248: Sprint 11 ✅ DONE.
2. No tag this sprint — v1.0.0 lands at end of Sprint 12.
3. Open Sprint 12: [`sprint-12-tag-v1.md`](sprint-12-tag-v1.md).
