---
description: Look up a sprint item kickoff prompt + validation, gate on AC contract pre-flight, present to user. Usage `/sprint <N.M>` for planned, `/sprint T<N.M>.<seq>` for troubleshoot follow-ups.
---

You are bootstrapping a quantrix sprint work item. The argument is a sprint-item identifier:
- Planned items: `<sprint>.<item>` (e.g. `1.2`, `4.5`, `12.5`)
- Troubleshoot follow-ups: `T<sprint>.<item>.<seq>` (e.g. `T1.3.1`, `T7.2.2`)

The argument: $ARGUMENTS

## What to do

### 1. Parse argument

- If starts with `T`, troubleshoot item. Sprint number = digit immediately after `T` (e.g. `T1.3.1` → sprint `1`). Full identifier (e.g. `T1.3.1`) is the item-block heading suffix.
- Otherwise planned. Split on `.`; sprint number = first segment.

### 2. Locate sprint file + item block

- Sprint files at `<plugin-config.sprintFilesGlob>` (default `docs/plans/sprints/sprint-*.md`).
- Find file matching `sprint-<N>-*.md`.
- Within it, find heading `## Item <full-identifier>`.

### 3. AC pre-flight gate (NEW — quantrix v0.1)

Before presenting kickoff, verify the originating issue has the AC contract:

a. Find originating issue: from sprint file's `## Item <N.M>` block, look for `Refs #<N>` / `Closes #<N>` / `**Issue:** #<N>` reference.

b. `gh issue view <orig> --json body,labels`.

c. Check issue body for:
- `## Code AC` section present (always required)
- `## Manual AC` section present (required if sprint validation block references manual testing)
- ≥2 ACs total across both sections
- Every Manual AC line has format `[manual] · <action> · expect <outcome> · verify via <key>`
- Every `verify via` key exists in the surfaces map (`<surfacesMapPath>`)

d. If ANY check fails, STOP. Do NOT author AC on the user's behalf.

```
══════════════════════════════════════════════════════════════
AC pre-flight FAILED — Sprint <N.M>
══════════════════════════════════════════════════════════════
Issue #<orig> is missing the quantrix AC contract:

<bullet list of failures>

Required structure:

## Code AC (verified by /qa from diff)

- [ ] <concrete test gate>
- [ ] <regression coverage>

## Manual AC (verified by /te + /qa via artifact)

- [manual] · <action> · expect <outcome> · verify via <surface-map key>

See: <plugin>/docs/ac-template.md

Amend the issue body, then re-run /sprint <N.M>.
```

EXIT — do NOT proceed to kickoff.

### 4. Pre-flight checks (existing)

- Repo state: `git status -sb` (expect clean), `git log -1 --oneline` (capture HEAD SHA).
- Tests passing: `npm test 2>&1 | tail -3` (or project equivalent).
- Model/effort matches sprint file's recommendation. If mismatched, STOP and tell user.
- Surfaces map readable.

### 5. Companion file check (when manual AC exists)

If issue body has `## Manual AC`:

- Look for `<manualTestsDir>/<N.M>.md`.
- If missing: warn user that the companion file will be authored during execution. (`/te` will require it.)
- If present: verify structure (parents, sub-steps, four mandatory fields per sub-step, ≤10 cap). Surface any structural issue.

### 6. Present to user

- Item title
- 2-sentence "What"
- Kickoff prompt block VERBATIM
- Validation steps
- AC summary (read from issue body — DON'T author)
- Companion file path (if manual AC exists)
- Closeout instructions

### 7. Confirmation prompt

```
Pre-flight checks passed:
  ✓ AC contract complete (<N> code AC, <M> manual AC)
  ✓ Surfaces map: all verify-via keys resolved
  ✓ Repo clean on <branch> · HEAD <sha-short>
  ✓ Tests passing
  ✓ Model/effort matches sprint config

Ready to execute? Confirm and I'll run the kickoff prompt.
```

### 8. On confirmation, execute kickoff

Execute the kickoff prompt content as the actual task. During execution, if Manual AC exists, author the companion file at `<manualTestsDir>/<N.M>.md` per `<plugin>/docs/manual-test-template.md`.

### 9. End-of-session handoff

After kickoff execution completes (PR opened, ready for QA):

```
══════════════════════════════════════════════════════════════
Sprint <N.M> execution complete
══════════════════════════════════════════════════════════════
PR: #<pr>
Branch: <branch>
Companion file: <manualTestsDir>/<N.M>.md (authored ✓ | N/A)

Next steps:

1. Pre-merge QA (first pass):
   cd <repo-root>
   claude --model claude-sonnet-4-6 --effort medium -p "/qa <N.M>"

2. If first-pass PASS AND Manual AC exists, manual test:
   cd <repo-root>
   claude --model claude-sonnet-4-6 --effort medium --dangerously-skip-permissions
   /te <N.M>

3. After /te PASS, second-pass QA + auto-merge:
   cd <repo-root>
   claude --model claude-sonnet-4-6 --effort medium -p "/qa <N.M> --phase second"
```

## Hard constraints

- Use slim kickoff form. Do NOT inflate kickoff with extra context — agent reads plan doc + sprint file end-to-end as spec.
- If item is `[USER]`, do NOT execute autonomously — present manual playbook + wait.
- If pre-flight fails (any of: AC contract, repo state, tests, model match), STOP. Do not patch around.
- If issue is already CLOSED on GitHub, STOP and ask whether to skip or re-open.
- Do NOT author AC. The user authors AC; /sprint enforces presence.

## Reference

- Plan: `<plugin-config.planDocPath>` (default `docs/plans/v0.1-completion.md`)
- Sprint files: `<plugin-config.sprintFilesGlob>` (default `docs/plans/sprints/sprint-*.md`)
- AC contract: `<plugin>/docs/ac-template.md`
- Manual-test template: `<plugin>/docs/manual-test-template.md`
- AC-authoring skill: `<plugin>/skills/ac-authoring/SKILL.md`
- Surfaces map skill: `<plugin>/skills/surfaces-map/SKILL.md`
