# Issue graph + related-work pre-flight scan — design

**Status:** draft for review
**Date:** 2026-04-20
**Owner:** @JimmyCapps
**Scope:** HoneyLLM repo (will generalise later if useful)

## Problem

Coding-agent sessions on this repo have produced rework and late retractions
(e.g. the Hawk/Spider/dialect recommendation on 2026-04-20) because the agent
proposed a design without first reading the *adjacent* issues and PRs that
shared files, signals, or concepts with the task. The issue tracker already
links the work correctly; the failure is upstream of discovery — it's at the
*pre-flight* step where an agent has to decide what to read before it starts
designing.

Secondary problem: the human owner has ADHD and finds walls of text hard to
keep resident while working. A visual overview of the graph is easier to scan
than re-reading ten linked issue bodies.

## Goals

1. Force the coding agent to perform a *mechanical* related-work scan before
   proposing any design, plan, or non-trivial edit.
2. Give the human owner a graph view of issues/PRs and their relationships,
   clustered by project and phase, with staleness made visible.
3. Keep the graph bound to the repo working tree — static files, no running
   server, no magic freshness claims.

## Non-goals

- Per-issue long-lived Haiku agents / bidding auction (rejected: see
  conversation 2026-04-20; cost and lossy-compression failure modes outweigh
  the benefit at single-developer scale).
- Building a general-purpose GitHub-project visualiser. This is HoneyLLM-specific.
- Auto-inferring semantic relationships that aren't in issue text. Where a
  relationship exists only in the owner's head, it goes in the human overlay.

## Architecture

### Artifacts

```
test-pages/
├── issue-graph.html              # new page: graph + sidebar, dark theme
├── issue-graph.js                # vanilla canvas force layout, ~200 lines
└── issue-graph/
    └── data.json                 # generated; checked in

docs/
└── issue-graph.md                # human-maintained overlay (relationships
                                  # the script can't infer from gh data)

scripts/
└── issue-graph/
    ├── sync.ts                   # fetch gh data, merge overlay, write json
    └── drift.ts                  # report stale/missing references

CLAUDE.md                         # adds "Related-work pre-flight scan" section

package.json                      # adds scripts:
                                  #   graph:sync   — regenerate data.json only
                                  #   graph:drift  — print drift report, exit nonzero if broken
                                  #   graph:open   — open the HTML in default browser
                                  #   graph        — graph:sync && graph:open (the one humans run)
```

### Data flow

```
   gh issue list --json ...  ┐
   gh pr list --json ...     ├──▶  sync.ts  ──▶  data.json  ──▶  issue-graph.html
   docs/issue-graph.md       ┘                      │
                                                    └──▶  drift.ts  ──▶  stdout banner
```

### Components

**`scripts/issue-graph/sync.ts`**
- Runs `gh issue list --state all --limit 200 --json number,title,labels,body,state,updatedAt`
  and the equivalent for PRs.
- Parses issue/PR bodies and titles for `#N` references to build auto-detected edges
  (type: `references`).
- Reads `docs/issue-graph.md`, extracts explicit relationships in a small YAML-in-fence
  syntax (type: `blocks`, `depends-on`, `competes-with`, `same-signal`, `supersedes`).
- Writes `test-pages/issue-graph/data.json` with:
  - `syncedAt` ISO-8601 timestamp
  - `nodes` (issue/PR metadata, cluster assignment derived from labels)
  - `edges` (typed, direction where applicable)
  - `clusters` (project-honeyllm, project-determillm, phase-4, phase-6+,
    phase-8-candidate, upstream, future-feature — plus custom clusters from
    the overlay: "hunters", "dialect", "nano")
- Prints a summary to stdout: counts, last-updated, drift.

**`scripts/issue-graph/drift.ts`**
- Imported by `sync.ts` but also runnable standalone for CI.
- Flags: issues in the overlay that are `closed` or missing; open issues not
  mentioned in the overlay and not carrying a known cluster label.

**`docs/issue-graph.md`** (human overlay)
- Freeform prose at the top (a one-paragraph map of the repo's in-flight work).
- Machine-readable fenced blocks:

  ````
  ```issue-graph
  cluster: hunters
  members: [3, 75, 80, 81]
  note: Spider, dialect packs, Hawk — compete for the same hunter-signal slot.
  ```

  ```issue-graph
  edge: depends-on
  from: 75
  to: 52
  note: Per-language dialect packs extend Gate B methodology.
  ```
  ````

- Sync script parses only the fenced blocks; the prose is for humans.

**`test-pages/issue-graph.html` + `issue-graph.js`**
- Single HTML file, dark theme matching the existing harness pages.
- Shared top nav (new: also backported into `test-pages/index.html`,
  `test-pages/phase4/manual-test-harness.html`, `nano-harness.html`,
  `summarizer-harness.html`): plain `<nav>` with links between harness pages.
- Layout:
  - Header: title, `syncedAt` pill (green <10 min, amber <24 h, red older),
    drift count badge, "Resync" button. The button opens a modal showing the
    exact command (`npm run graph`) with a copy-to-clipboard icon — since the
    page is static and can't shell out, this is the honest UX.
  - Left ~65%: canvas with force-directed layout. Nodes coloured by cluster,
    sized by openness (open issues slightly larger). Edges styled by type
    (`blocks` solid red, `depends-on` solid amber, `competes-with` dashed,
    `same-signal` dotted, `references` thin grey).
  - Right ~35%: sidebar listing all nodes grouped first by project, then by
    phase/cluster, then by status. Each row: `#N title` + tiny status pill.
  - Clicking a node highlights it, dims unrelated nodes, brightens connected
    edges, and scrolls the sidebar to the matching row.
  - Clicking a sidebar row does the reverse.
  - Filter chips along the top: toggle project, phase, state (open/closed),
    edge type.

- Vanilla JS only. No framework, no build step. Canvas 2D API for the graph.
  Simple Verlet-style force simulation (repulsion + spring + centre gravity),
  ~50 lines.

**`CLAUDE.md` — new section**

> ## Related-work pre-flight scan (MUST run before any design/plan)
>
> Before proposing a design, plan, or non-trivial edit for an issue or PR,
> the agent MUST:
>
> 1. Run `npm run graph:sync` and read the drift report. Address any drift
>    that touches the task's cluster before proceeding.
> 2. Open `test-pages/issue-graph/data.json` (or the HTML if a human is
>    present) and list every node connected to the task's issue by any edge
>    type, and every node in the same cluster.
> 3. Read the bodies of those connected/cluster-mates in full. Not titles —
>    bodies.
> 4. In the response, before the design, include a **Related work** section
>    that lists each one with a one-line "how it relates," and explicitly
>    state what this task is *not* doing.
>
> This is blocking, not advisory. A design proposal without a Related-work
> section is incomplete and must be rewritten.

### Freshness model

The page is bound to the committed `data.json`. Three refresh triggers:

1. **Agent pre-flight** — the CLAUDE.md checklist forces `npm run graph:sync`
   before design. This is the path that matters for preventing rework.
2. **Manual** — `npm run graph` regenerates and opens the page. The "Resync"
   button on the page prints the command.
3. **Git hook (optional, phase 2)** — `post-merge` and `post-checkout` hooks
   run `graph:sync` silently. Deferred until phase-1 proves useful.

The `syncedAt` pill makes staleness *visible* rather than pretending static
files are live.

### Drift guardrails

- `drift.ts` exits non-zero if the overlay references issues that don't exist
  or are closed. Wired into CI as a warning (not a blocker) so a stale overlay
  shows up in PR checks.
- Sync script prints a one-line summary on every run: "N open, M closed, K
  overlay entries, D drift warnings."

## Error handling

- `gh` not installed or unauthenticated → script exits 1 with a human message
  and a link to `gh auth login`.
- `gh` rate-limited → retry once with backoff, then exit 1; `data.json` is
  left untouched.
- Overlay YAML block malformed → exit 1, point at the file/line, leave
  `data.json` untouched.
- Canvas unsupported / JS disabled → the HTML shows the sidebar list only.
  The list is always functional without the graph.

## Testing

- **Unit:** `sync.ts` parser tested on a fixture set of issue bodies (with/
  without `#N` refs, with/without labels). `drift.ts` tested against
  hand-built overlay fixtures.
- **Visual:** manual open of the HTML with the committed `data.json`. No
  automated visual regression — not worth it for a solo tool.
- **Smoke:** `npm run graph:sync` on CI for every PR, asserting non-zero
  exit on parse failures.

## Phased delivery

Deliberately split so the text-only value lands first. The canvas is the
headline feature but not the critical-path one — an agent following the
CLAUDE.md checklist never needs the canvas; it reads `data.json`.

1. **Phase 1 (MVP):** sync script, overlay format, `data.json`, drift report,
   `CLAUDE.md` section, shared top-nav across harness pages, `issue-graph.html`
   with **sidebar list only** (filter chips, click-to-expand details, no
   canvas). At the end of phase 1 the agent's pre-flight works and the human
   has a readable list grouped by cluster — both stated goals are met.
2. **Phase 2:** canvas force layout added to the existing page, with node↔sidebar
   highlighting. Purely additive; no phase-1 artifacts change shape.
3. **Phase 3 (optional):** git hooks, CI drift-check-as-warning, additional
   edge types as they prove useful.

## Open questions

None blocking. Defer to implementation:

- Exact cluster membership for the initial overlay — will hand-curate from
  the ~25 open issues during phase 1 build.
- Whether to surface PR state (draft/open/merged) differently from issue
  state in the sidebar — try both, pick what reads better.

## Rejected alternatives

- **Per-issue Haiku agents with bidding.** Overkill for single-developer
  concurrency; adds a lossy compression step in front of a reasoning problem
  that's better solved by reading issues carefully.
- **Chrome extension popup for the graph.** Couples unrelated features of the
  repo (the prompt-injection extension vs. the project-management viewer).
- **Single SPA harness with client-side routing.** Explicitly rejected by
  owner: "Keep each page in harness as its own webpage, not a single URL
  type structure" — minimises navigation failure modes for both human and
  agent.
- **Local dev server (Vite).** One more process to remember to start.
  Static HTML is simpler and matches the rest of the harness.
