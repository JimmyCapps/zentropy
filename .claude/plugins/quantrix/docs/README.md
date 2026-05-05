# quantrix

Agile-loop pipeline plugin for Claude Code. Wraps issue-driven sprint work into four coupled commands: `/sprint` authors, `/qa` verifies, `/te` walks the user through manual tests, `/ts` (troubleshoot) investigates failures.

## Pipeline at a glance

```
/sprint <N.M>   pre-flight AC gate → kickoff → execution
                  │
                  ↓
/qa <N.M>       first pass: code AC from diff + readiness check
                  │ on PASS, if manual AC exists:
                  ↓
/te <N.M>       guided walkthrough: 1 parent step at a time, ≤10 sub-steps,
                  state-resumable, captures artifact
                  │
                  ↓
/qa <N.M>       second pass: consume artifact + Check G cross-AC corroboration
                  │ on PASS:
                  ↓
                close + auto-merge

/ts <N.M>       invoked on FAIL anywhere — reads /te state.json on entry,
                  resolution gate = /qa second-pass PASS
```

## When to invoke each

| Command | When | Runtime |
|---|---|---|
| `/sprint <N.M>` | Starting a planned sprint item | varies (per sprint config) |
| `/qa <PR# \| N.M>` | Pre-merge or manual review of any work | Sonnet 4.6 / medium |
| `/te <N.M>` | Manual AC exists and code AC has passed `/qa` first pass | Sonnet 4.6 / medium |
| `/ts <N.M>` | Manual verification surfaced a problem | Opus 4.7 / high |

## Plugin contract for consuming projects

A consuming project must provide:

1. **Plan doc** at the path declared in `plugin.json` → `config.planDocPath`. Source-of-truth for sprints, version ladder, dependency hierarchy.
2. **Sprint files** matching `config.sprintFilesGlob`. Each file is a per-sprint playbook with `## Item N.M` blocks containing kickoff prompt + validation steps + closeout.
3. **Surfaces map** at `config.surfacesMapPath`. Documents project-specific functions, caches, storage keys, message types, byte-locked files. Schema in `docs/surfaces-map-spec.md`.
4. **Issue body AC contract**: every sprint-driving issue has `## Code AC` (always) and `## Manual AC` (when manual testing applies), with ≥2 multi-angle ACs total. Each manual AC line cites a verification source from the surfaces map.
5. **Companion test files** at `config.manualTestsDir/<N.M>.md` for items with manual AC. Schema in `docs/manual-test-template.md`.

See `docs/pipeline.md` for the full data flow.

## Files in this plugin

- `commands/{sprint,qa,te,troubleshoot}.md` — slash command definitions
- `skills/ac-authoring/` — multi-angle AC discipline + code/manual split
- `skills/boundary-walkthrough/` — `/te`'s step-rendering rules
- `skills/surfaces-map/` — how all four commands consult the surfaces map
- `docs/pipeline.md` — full data flow + handoff points
- `docs/ac-template.md` — issue-body AC template
- `docs/manual-test-template.md` — companion test-file template
- `docs/surfaces-map-spec.md` — schema for the consuming project's surfaces map
- `examples/honeyllm-surfaces-map.example.md` — concrete example

## Status

v0.1 — the four commands ship as a coupled minimal slice. Forward scope (toolkit-side dedicated sessions) tracked in `~/Documents/projects/toolkit/DESIGN.md`:

- `/discover` — turn a vague goal into a structured plan (requirements gathering)
- `/plan` — generate plan doc + sprint files from discovery output
- `/deliverables` — checklists, Jira CSV, change-management artifacts
- `/surfaces-update` — auto-regen surfaces map from code annotations
