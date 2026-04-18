# CLAUDE.md

Quick-reference for agent sessions (Claude Code, Codex, Gemini CLI, etc.) picking up work on this repo. Humans reading this: the same information is useful, but `README.md`, `CONTRIBUTING.md`, and `docs/ARCHITECTURE.md` are the authoritative long-form sources — this file is a pointer map, not a replacement.

## Project

**HoneyLLM** is a Chrome Manifest V3 extension that detects prompt-injection attacks on web pages before an LLM-aware app consumes the content. It runs three security probes entirely on-device via WebGPU (MLC WebLLM) or Chrome's built-in Gemini Nano, scores the results, applies DOM / network / redirect mitigations, and signals the verdict to page scripts via `window.__AI_SITE_STATUS__` and a `<meta>` tag.

Primary goal: keep browsing data private while protecting downstream LLM apps from adversarial page content.

For the full capability surface, scoring table, and probe descriptions, read `README.md`. For the execution-context diagram and per-module breakdown, read `docs/ARCHITECTURE.md`.

## Current phase state

Always re-check `README.md` and `docs/ARCHITECTURE.md` before acting on this — phase state drifts.

- **Phase 3 Track A** — shipped. Canonical baseline in `docs/testing/inbrowser-results.json` (162 rows, byte-identity locked — see "Audit trail" below).
- **Phase 3 Track B** — automatable sweep shipped; manual production-LLM leg unblocked by Phase 4B fixes. Re-run blocked on #13-style classifier cleanup (now resolved as of 2026-04-18).
- **Phase 4A–4D** — shipped (see README Status section for per-stage commit pointers).
- **Phase 4E–4G** — queued (Chromium-family compat audit, Track B resumption B5/B7, multimodal image-injection probe).
- **Phase 5+ and Phase 8 backlog** — tracked in GitHub issues + `docs/backlog/phase4-enhancement-requests.md`.

Authoritative phase docs live in `docs/testing/PHASE3_PROMPT.md`, `docs/testing/PHASE4_PROMPT.md`, `docs/testing/phase3/`, `docs/testing/phase4/`.

## GitHub workflow (MUST follow)

Every change — human or agent — goes through: **issue → feature branch → PR linked via `Closes #N` → CI green → squash-merge → branch auto-deleted**.

No direct commits to `main`. Even cosmetic single-file fixes go through a PR. Branch protection is intentionally **not** enabled on `main` right now (collaborators are aligned, the user wants minimal roadblocks), but the workflow expectation stands regardless.

Branch naming: `<type>/issue-<N>-<slug>` where type ∈ `{fix, feat, refactor, docs, chore, test}`. Examples: `fix/issue-13-classifier-v2`, `chore/issue-26-contributor-workflow`.

Commit messages: conventional commits with issue scope, e.g. `fix(phase3-#13): ...`. The pre-push hook runs typecheck + test + build; do not bypass it with `--no-verify`.

See `CONTRIBUTING.md` for the full workflow (templates, PR body structure, merge strategy, parallel-session coordination, branch-protection turn-on recipe).

## Build + test commands

```
npm run typecheck     # tsc --noEmit
npm test              # vitest run (256 tests as of 2026-04-18)
npm run build         # tsc --noEmit && tsx build.ts → dist/
npm run test:e2e      # Playwright, only for detection/mitigation changes
```

CI on every PR to `main` runs typecheck + test + build via `.github/workflows/ci.yml`. Runs in ~20s.

Manual smoke-testing the extension: `npm run build`, then load `dist/` as an unpacked extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked).

## Code-style rules (applied by reviewers)

- TypeScript strict — no `any` in application code; `unknown` + narrowing at boundaries.
- Immutability — return new objects, don't mutate. Use `Readonly<T>` / spread.
- Files under ~400 lines, hard cap ~800. Prefer many small files over few large ones.
- No comments unless explaining a non-obvious *why* (hidden constraint, bug workaround, surprising behaviour). Don't narrate what the code does.
- Interfaces for extensible object shapes; type aliases for unions / intersections / mapped types.

Full rules in `CONTRIBUTING.md` §Code style and `.claude/rules/` (global user rules).

## Domain-specific invariants (easy to trip on)

These are non-obvious constraints that have surfaced across sessions. Treat them as binding.

### Classifier v1 vs v2 (issue #13, 2026-04-18)

`scripts/fixtures/phase2-inputs.ts` exports two classifiers:

- `classifyOutput` (v1) — substring-based, **byte-locked against the 162 canonical Phase 2 rows** in `docs/testing/inbrowser-results.json`. The test at `phase2-inputs.test.ts:57` enforces this byte-identity. Do not modify v1's behaviour — any change invalidates the cross-phase delta comparison that `docs/testing/phase3/AFFECTED_BASELINE_REPORT.md` depends on.
- `classifyOutputV2` — JSON-aware. Used by Phase 4+ runners. Handles the `{found, instructions, techniques}` detection-report shape so a probe's *evidence of detection* isn't misread as *evidence of compromise*. Falls through to v1 when output isn't a recognisable detection report.

Affected rows carry a `classification_version: 'v1' | 'v2'` field so queries can filter or join by classifier version.

### Phase 2 canonical file is locked

`docs/testing/inbrowser-results.json` is the canonical Phase 2 baseline. **Do not modify it** without a deliberate "re-baseline" decision. Migration scripts (e.g. `scripts/restamp-affected-v2.ts`) operate on `inbrowser-results-affected.json` and `inbrowser-results-affected-replicates.json`, never the native file.

### Phase 2 and Phase 3 Track A fixtures share a source of truth

`scripts/fixtures/phase2-inputs.ts` is imported by `run-mlc-local-baseline.ts` (native Phase 2) AND `run-affected-baseline-helpers.ts` (Phase 3 Track A). Changing probe text, input text, or v1 classifier behaviour breaks the delta-comparison contract. Additive changes only.

### Offscreen document is lazy

The offscreen doc is created on first `PAGE_SNAPSHOT` after a reload, not eagerly. Use the **service worker** console for storage / state reads — the offscreen inspector isn't reliably available until a page is analysed. (Recorded in project memory as a recurring gotcha.)

### Chrome Stable unpacked extension ID

`immjocpajnooomnmdgecldcfimembndj` — use verbatim in `chrome-extension://` URLs until the user signals a reload changed it.

### Audit-trail discipline

When committing phase test results, commit **full per-probe result directories** as evidence. Gitignore only partial / wiped dumps that were superseded by a summary JSON. Before first `git add`, run `npm audit` + a broad secret grep — AIza keys are 39 chars, so regex must be ≥20 char suffix to catch them.

## Execution-context map (service worker vs offscreen vs content)

When debugging, know which context a log line came from:

- **Content script** (`src/content/`) — runs in the page's isolated world. Extracts text, applies mitigations, signals verdict. Cannot call `chrome.offscreen.*`.
- **Service worker** (`src/service-worker/`) — background. Orchestrates chunking, runs the offscreen lifecycle, scores verdicts, persists to `chrome.storage`.
- **Offscreen document** (`src/offscreen/`) — hosts the LLM engine (MLC WebLLM on WebGPU, or Chrome's `window.LanguageModel` for Nano). Runs probes. Created lazily.
- **Popup** (`src/popup/`) — reads the persisted verdict from `chrome.storage` on open. No analysis logic.
- **Main-world inject** (`src/content/main-world-inject.ts`) — runs in the page's real JS realm (not isolated) to override `fetch` / `XMLHttpRequest` before page scripts execute.

Message types and flow: `docs/ARCHITECTURE.md` has the authoritative diagram.

## When to ask the user vs. act autonomously

`auto` mode (when active) means: execute reasonable assumptions, minimise interruptions. Even in auto mode, **ask before**:

- Pushing to shared remotes (`git push`, `gh pr merge`, `gh issue close` when the issue has open questions).
- Touching canonical audit files (`docs/testing/inbrowser-results.json`, etc.).
- Enabling GitHub branch protection or similar settings that change behaviour for collaborators.
- Publishing content anywhere visible to others (PR comments on shared work, issue comments, chat posts).
- Destructive git operations (`reset --hard`, `push --force`, branch deletion on remote).

Fast local work — edits, tests, builds, commits, branch creation — proceeds without asking.

## Further reading

| Topic | Source of truth |
|---|---|
| Feature surface, scoring, installation | `README.md` |
| Execution contexts, message flow, module map | `docs/ARCHITECTURE.md` |
| Workflow, commit format, templates, protection recipe | `CONTRIBUTING.md` |
| Phase 3 results + FP curation | `docs/testing/phase3/AFFECTED_BASELINE_REPORT.md`, `docs/testing/phase3/NANO_BASELINE_ADDENDUM.md` |
| Phase 4 plan + Nano integration | `docs/testing/PHASE4_PROMPT.md`, `docs/testing/phase4/` |
| Phase 8 backlog (enhancement ideas) | `docs/backlog/phase4-enhancement-requests.md` + GitHub issues tagged `phase-8-candidate` |
| Running Phase 3 live sweeps | `scripts/run-phase3-live.ts`, `scripts/run-affected-baseline.ts` |
