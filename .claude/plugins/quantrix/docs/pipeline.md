# quantrix pipeline — data flow

Detailed flow showing what each command reads, writes, and hands off.

## Inputs (consuming project must provide)

```
docs/
├── plans/
│   ├── <plan-doc>.md                # config.planDocPath — source of truth
│   └── sprints/
│       └── sprint-<N>-*.md          # per-sprint playbooks (## Item N.M blocks)
├── agent-context/
│   └── known-surfaces.md            # config.surfacesMapPath — project surfaces
└── testing/
    ├── manual-tests/
    │   └── <N.M>.md                 # /te companion files (authored by /sprint)
    └── manual-runs/
        ├── <N.M>-<sha>-state.json   # /te resumable state
        └── <N.M>-<sha>.md           # /te final artifact
```

## Issue body AC contract

```markdown
## Code AC (verified by /qa from diff)

- [ ] <test gate: file:line that asserts X>
- [ ] <regression coverage: baseline byte-identical OR specific test file passes>

## Manual AC (verified by /te + /qa via artifact)

- [manual] · <action> · expect <outcome> · verify via <surface-map key>
- [manual] · <action> · expect <outcome> · verify via <surface-map key>
```

Multi-angle requirement: ≥2 ACs total, covering the symptom from different angles. A buggy fix that satisfies one tends to fail another.

## Per-command flow

### /sprint <N.M>

```
1. Read plan doc + sprint file's §<N.M> block
2. Pre-flight checks:
   - Repo state (clean main, tests passing)
   - Model/effort matches sprint file's recommendation
   - Issue body has ## Code AC + (if manual) ## Manual AC, ≥2 multi-angle
   - Surfaces map readable
3. STOP if any pre-flight fails — do NOT author AC on user's behalf
4. Present kickoff prompt + validation steps to user
5. On user confirm: execute kickoff
6. End-of-session: if manual AC exists, print /te launch command
```

### /qa <PR# | N.M> [first|second]

```
First pass (default when no /te artifact exists):
  1. Resolve target: PR# → diff + originating issue;  N.M → latest PR closing issue
  2. Read issue body, extract Code AC + Manual AC
  3. AC-quality pre-check (concrete, verifiable, distinct, ≤3-bounded)
  4. Run Checks A-F over diff (see qa.md)
  5. Tick Code AC checkboxes on PASS via gh issue edit --body-file
  6. Output: PASS/CONCERNS/FAIL on stdout line 1
  7. On PASS + manual AC exists: print /te launch hint

Second pass (when /te artifact exists at docs/testing/manual-runs/<N.M>-<sha>.md):
  1. Read /te artifact (PASS/FAIL per manual AC)
  2. Run Check G — cross-AC corroboration (do code + manual outcomes triangulate?)
  3. Tick Manual AC checkboxes on PASS
  4. Post summary comment on issue
  5. Output: PASS/CONCERNS/FAIL on stdout
  6. On PASS: ready for auto-merge
```

### /te <N.M>

```
1. Read companion file at <manualTestsDir>/<N.M>.md
2. Read surfaces map for verification-source resolution
3. Check for existing state.json — resume from last-completed step if found
4. For each parent step:
     a. Render parent step + ≤10 sub-steps (boundary group)
     b. For each sub-step: display action + expected + verification command
     c. Wait for user reply
     d. Classify reply: done | error | question | pause | defect-suspected
     e. On done: persist state, advance
     f. On error / defect-suspected: halt, recommend /ts <N.M>, exit
     g. On pause: persist state, exit
5. On final-step done: write artifact at <manualRunsDir>/<N.M>-<sha>.md
6. Print: PASS + /qa <N.M> --phase second hint
```

### /ts <N.M>

```
1. Q&A first (one question per turn)
2. State-load: issue + PR + /te state.json (if present)
3. Post troubleshoot-in-progress status comment + add label
4. Phase B: investigate progressively (R+C on every move)
5. State diagnosis as hypothesis with confidence scorecard
6. Paper-test the fix WITH user
7. Propose single compact fix path
8. STOP after answering pass — do not push to Phase C
9. On user request: Phase C → file T<N.M>.<seq> issue + amend kickoff + handoff
10. Resolution gate: /qa second-pass PASS required to clear label
```

## Surfaces map integration

All four commands consult `<surfacesMapPath>` (default `docs/agent-context/known-surfaces.md`) before scanning the codebase. This avoids dispatching Explore subagents for questions the map already answers.

- `/sprint` — manual AC entries reference surface-map keys; pre-flight verifies referenced keys exist
- `/qa` — Check D scope authority; Check G cross-AC corroboration uses surface-map field semantics
- `/te` — interpolates surface-map-derived verification commands into each step
- `/ts` — Phase B reads surfaces map before any code Read/Grep

## Multi-collaborator handoff

The full session state of `/ts` and `/te` is durable:

- `/ts` posts a status comment on the originating issue + adds `troubleshoot-in-progress` label. Issue cannot close while label present. A second invocation reads the existing comment and resumes.
- `/te` writes state.json after every step. A halted run resumes at the last-completed step. Different collaborators can pick up the run.

This makes the pipeline safe for sessions that get interrupted, context-exhausted, or handed off.
