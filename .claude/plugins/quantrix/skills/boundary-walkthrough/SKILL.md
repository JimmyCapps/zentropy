---
name: boundary-walkthrough
description: /te step-rendering rules — one parent step at a time, ≤10 sub-steps cap, wait-for-done contract, state.json after each step, classification of user replies. Used by /te.
type: process
---

# Boundary-grouped walkthrough — /te step-rendering rules

`/te` walks the user through manual tests. Display rules below are non-negotiable; they protect users from misinterpreting steps and wasting test time.

## Display rules

### One parent step at a time

Never render parent step 2 until step 1 is fully complete. The user sees the parent step name + a one-paragraph context + sub-steps 1.1 through 1.N.

### ≤10 sub-steps per parent — upper cap, not target

If a logical group has 4 sub-steps, render 4. Don't pad. Don't split arbitrarily.

If a parent has >10 sub-steps, the companion file is wrong — flag during `/te` parse and return FAIL with `parent step <name> exceeds 10 sub-step cap; amend companion file to split into smaller boundaries`.

### Sub-steps grouped by logical boundary

"Setup", "Scan 1", "Scan 2", "Scan 3", "Verification" — each is a parent. Not "first 5 things", "next 5 things" — that's count-based, not boundary-based.

### Each sub-step — four mandatory fields

Render in this order:

```
Sub-step 1.2 — <action verb-object>

  Action:    <single concrete imperative>
  Expected:  <observable outcome>
  Verify via: <surface-map key | direct observation>
  Run:       <interpolated verification command>

  Reply 'done' when verified, or paste output if it doesn't match.
```

If any of the four fields is missing in the companion file, `/te` returns FAIL with `underspecified manual test step at <N.M> step <X.Y>`.

## Wait-for-done contract

After rendering a sub-step, `/te` halts and waits. No advancing without user reply.

### Reply classification

`/te` classifies the user's next message into one of:

| Class | Triggers | Action |
|---|---|---|
| `done` | reply matches `^(done|ok|next|yes|verified|✓)$` (case-insensitive) | persist state, advance to next sub-step or parent |
| `error` | reply contains an error string, log line, exception, "didn't match", "failed" | halt, summarize observed-vs-expected, recommend `/ts <N.M>`, exit |
| `question` | reply ends in `?` or starts with "what", "why", "how", "is", "should" | answer from companion-file context only (no fresh research); if can't answer, halt and ask user how to proceed |
| `pause` | reply matches `^(pause|stop|quit|exit|halt|brb)$` | persist state, exit; user re-invokes `/te <N.M>` later, resumes at last-completed sub-step |
| `defect-suspected` | reply contains "looks wrong", "this is broken", "shouldn't be like this" | halt, recommend `/ts <N.M>`, exit |
| `ambiguous` | reply doesn't classify confidently | ask one focused clarifying question; do NOT advance |

### When ambiguous, ask not assume

`/te`'s job is fidelity, not throughput. If a reply could mean done OR could mean unease, ask. Don't silently advance.

## State persistence — after every sub-step

State written to `<manualRunsDir>/<N.M>-<sha>-state.json`:

```json
{
  "sprintItem": "1.5",
  "sha": "abc123",
  "startedAt": "2026-05-05T10:30:00Z",
  "lastUpdatedAt": "2026-05-05T10:42:00Z",
  "currentParent": 2,
  "currentSubStep": 3,
  "completed": [
    {"parent": 1, "sub": 1, "doneAt": "2026-05-05T10:31:00Z", "userReply": "done"},
    {"parent": 1, "sub": 2, "doneAt": "2026-05-05T10:33:00Z", "userReply": "done"},
    ...
  ],
  "halted": null
}
```

On halt, `halted` populated:

```json
"halted": {
  "at": "2026-05-05T10:45:00Z",
  "atParent": 2,
  "atSubStep": 4,
  "reason": "error" | "pause" | "defect-suspected",
  "userReply": "<verbatim>",
  "recommendedAction": "/ts 1.5"
}
```

## Resume

When `/te <N.M>` is re-invoked and a state.json exists at the SHA:

```
Resuming /te 1.5 from parent step 2, sub-step 4 (halted 2026-05-05 10:45 UTC, reason: pause).
Previous state preserved. Skipping completed steps. Fresh-rendering from sub-step 2.4.

Continue? (yes / restart / cancel)
```

User can:
- `yes` — continue from last incomplete sub-step
- `restart` — wipe state.json, start from parent 1 sub 1
- `cancel` — exit without changes

## Final artifact

On final-step `done`, `/te` writes artifact at `<manualRunsDir>/<N.M>-<sha>.md`:

```markdown
# Manual test run — Sprint <N.M>

**Started:** <ts>
**Completed:** <ts>
**Build SHA:** <sha>
**Verdict:** PASS

## Per-step record

### Parent 1 — <name>

- 1.1 — <action> — done at <ts>
- 1.2 — <action> — done at <ts>
- 1.N — <action> — done at <ts>

### Parent 2 — <name>

...

## Manual AC verification

- [x] [manual] · <verbatim AC text> · verified at parent 3 sub 5
- [x] [manual] · <verbatim AC text> · verified at parent 4 sub 2

## Notes captured during run

<any user-pasted output, observations, etc. — preserved verbatim>
```

`/qa <N.M> --phase second` consumes this artifact.

## Why these rules

- One parent at a time: prevents the user scrolling past steps. The visible step is the active one.
- ≤10 sub-step cap: protects against "step 39 of 60" — when something breaks, the user has only paged through 1-9 sub-steps in this group, easy to retry.
- Boundary grouping: aligns with how the user thinks about the test (setup, run, verify), not with arbitrary chunk size.
- State after every sub-step: a halt at sub-step 7 doesn't lose sub-steps 1-6.
- Wait-for-done: throughput is not the goal; fidelity is.
- Ambiguous → ask: silent advance on ambiguous reply produces false-PASSes that waste downstream time.
