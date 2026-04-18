# Contributing to HoneyLLM

Thanks for contributing! This document describes the standard workflow for any change — from a one-line typo fix to a multi-day feature. The same rules apply to humans and to autonomous agent sessions (Claude Code, etc.).

## Getting started

1. Fork the repository (or clone directly if you have write access).
2. `git clone https://github.com/<your-username>/zentropy.git`
3. `npm install`

## The standard workflow

Every code change follows this loop:

```
GitHub issue → feature branch → commits → PR linked to issue → CI green → squash-merge → branch deleted
```

No direct commits to `main`. Even cosmetic single-file fixes go through a PR. The PR description is the durable record of *why* a change exists, and outlives commit messages and issue threads.

### 1. Find or open an issue

- Search existing issues first to avoid duplication.
- Use one of the issue templates (Bug / Feature / Finding) — they prompt for the context reviewers will need.
- For larger work, comment on the issue to claim it before starting, so two contributors don't end up doing the same thing.

### 2. Create a branch

Branch from the latest `main`, using this naming convention:

```
<type>/issue-<N>-<short-slug>
```

Where `<type>` is one of:

| Type       | Use for                                          |
|------------|--------------------------------------------------|
| `feat`     | New capability or user-visible enhancement       |
| `fix`      | Bug fix or regression repair                     |
| `refactor` | Code change with no behavioural difference       |
| `docs`     | Documentation only                               |
| `chore`    | Tooling, deps, CI, repo hygiene                  |
| `test`     | Test-only changes (no production code)           |

Examples: `fix/issue-13-classifier-v2`, `feat/issue-9-image-probe-4G1`, `chore/issue-26-contributor-workflow`.

Push the branch early so other sessions can see it.

### 3. Make changes

- Run `npm run typecheck`, `npm test`, and `npm run build` locally before pushing.
- The local pre-push hook also runs these — don't bypass it (`--no-verify`).
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Reference the issue number in the scope when applicable, e.g. `fix(phase3-#13): ...`.
- Keep PRs focused. If scope grows, split into a new issue + branch.

### 4. Open a PR

Open as soon as there's something worth showing — draft is fine. The PR template asks for:

- **Summary** — what and why, with `Closes #<issue>` so the issue auto-closes on merge.
- **Approach** — key design decisions and alternatives considered.
- **Impact** — concrete effects (data deltas, perf numbers, schema changes).
- **Test plan** — how you verified.
- **Risk / rollback** — what could break and how to revert.

### 5. CI must be green

The `CI` workflow runs typecheck + test + build on every PR. It mirrors the local pre-push hook so passing locally is a strong signal it'll pass in CI.

### 6. Merge

- **Squash-merge** is the default — keeps `main` history one-commit-per-feature/fix, which lines up cleanly with issues and PRs.
- Self-merge is allowed for now. When in doubt, ask for review.
- The feature branch auto-deletes on merge.

## Parallel work / agent coordination

When multiple sessions (human or agent) work in parallel:

- One session per branch. Push the branch immediately after creating it so other sessions see it via `git fetch`.
- Avoid touching files that an open PR also touches. Coordinate via issue comments if overlap is unavoidable.
- If two PRs end up conflicting, the second-to-merge rebases on top of `main` (`git rebase main`, then `git push --force-with-lease`).
- Don't merge `main` into feature branches — rebase keeps PR history clean.

## Project-specific recipes

### Adding a new probe

1. Create a new file in `src/probes/` implementing the `Probe` interface from `base-probe.ts`.
2. Add corresponding tests in `src/probes/<name>.test.ts`.
3. Register the probe in `src/offscreen/probe-runner.ts`.
4. Add scoring rules in `src/policy/rules.ts`.
5. Update the max score constant in `src/shared/constants.ts`.

### Adding a new behavioral analyzer

1. Create a new file in `src/analysis/`.
2. Add tests in `src/analysis/<name>.test.ts`.
3. Wire it into `src/analysis/behavioral-analyzer.ts`.
4. Add the flag to `BehavioralFlags` in `src/types/verdict.ts`.
5. Add scoring weight in `src/policy/rules.ts`.

### Loading the extension for manual testing

Build the extension (`npm run build`) and load `dist/` as an unpacked extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked). Run E2E tests with `npm run test:e2e` if modifying detection or mitigation logic.

## Code style

- TypeScript strict mode — no `any`. Use `unknown` and narrow when input is external.
- Immutable patterns — return new objects, don't mutate.
- Small files — aim for under 400 lines, hard cap around 800.
- No comments unless explaining a non-obvious "why" (a hidden constraint, a workaround for a specific bug, behaviour that would surprise a reader). Don't narrate what the code does.
- Interfaces for object shapes that may be extended; type aliases for unions, intersections, mapped types.

## Phase reports (historical + current fork convention)

Phase test reports follow a fork-on-supersede pattern. The goal is to preserve the as-of state of every reported number so historical decisions stay reviewable, while keeping a single canonical entry point that always reflects current state.

**Naming:**
- `REPORT_NAME.md` — the **current** report. Always reflects the latest data + classifier version. Has a `Last updated` field at the top.
- `REPORT_NAME_YYYY-MM-DD.md` — a **historical** snapshot, frozen as of that date. Created when a code or methodology change would invalidate the current report's numbers.

**When to fork:**
- A classifier or scoring change that flips rows in the dataset (e.g. issue #13's v2 classifier).
- A new measurement run that would require rewriting most of the existing report's body.
- Any change where the historical report's numbers + recommendation are still relevant for context, but no longer reflect what someone running the analysis today would see.

**When NOT to fork:**
- Typo fixes, broken links, formatting — edit in place.
- Adding a "Last updated" line or cross-link — edit in place.
- Single-section additions that don't invalidate the existing body — edit in place with an inline `**Update YYYY-MM-DD:**` admonition.

**Process:**
1. `git mv REPORT_NAME.md REPORT_NAME_YYYY-MM-DD.md` (date = the report's own author date, not today).
2. Write a fresh `REPORT_NAME.md` with the new state.
3. The new report's preamble must include:
   - A `Previous report:` link to the dated historical version.
   - A `What changed` section explaining the delta + linking the resolving issue / commit.
4. The historical report stays untouched. Don't backport links to it from the new report; readers find it via the current report's "Previous report" link.

This is an Option C variant of the deferred decision in #32 (forked report pair, lightweight convention rather than CURRENT/HISTORICAL suffix split).

## Issue-tracked design docs

GitHub is the canonical source of truth for backlog items, enhancement proposals, and feature requests. Per the convention from #33, status / prioritisation / discussion live on the issue itself.

When an issue's design rationale outgrows the issue body — long architectural sketches, trade-off tables, ASCII diagrams, multi-section trade-off analysis — write a per-issue document at `docs/issues/<N>-<slug>.md` and link it from the issue body.

**Format:**
- File path: `docs/issues/<issue-number>-<short-slug>.md`. Examples: `docs/issues/6-phase4-enhancements.md`, `docs/issues/9-image-injection-probe.md`.
- Header must include a "Tracked in #N — see issue for current status" admonition pointing back to the canonical issue.
- The doc holds rationale + design only. Status, owner, blocker relationships, and discussion stay on the issue.
- One doc per issue. If an issue spawns sub-issues with their own designs, each gets its own file.

**When NOT to create a per-issue doc:**
- The design fits in 2-3 paragraphs — keep it in the issue body.
- The doc would just restate what the issue already says — keep it in the issue body.

The pattern preserves rich technical content alongside code while keeping GitHub as the entry point for everything that requires coordination.

## Branch protection (currently disabled — recipe for fast turn-on)

Branch protection on `main` is **intentionally not enabled** as of writing — collaborators are aligned and the user wants to minimise roadblocks. The workflow expectation above stands regardless.

If protection becomes necessary (new contributor without context, an accidental direct push, etc.), apply these settings via the GitHub UI at *Settings → Branches → Add rule for `main`*:

| Setting | Value |
|---|---|
| Require a pull request before merging | ✓ |
| Require approvals | 1 (or 0 for solo work) |
| Dismiss stale pull request approvals when new commits are pushed | ✓ |
| Require status checks to pass before merging | ✓ |
| Required status checks | `verify` (from `.github/workflows/ci.yml`) |
| Require branches to be up to date before merging | ✓ |
| Require linear history | ✓ (matches squash-merge default) |
| Restrict deletions | ✓ |
| Do not allow bypassing the above settings | ✓ |
| Allow force pushes | ✗ |

Repo-level settings (*Settings → General*):

| Setting | Value |
|---|---|
| Allow merge commits | ✗ |
| Allow squash merging | ✓ (default) |
| Allow rebase merging | ✗ (or ✓ if you want stacked-PR support) |
| Automatically delete head branches | ✓ |

Optional follow-on:

- **CODEOWNERS** at `.github/CODEOWNERS` for path-based reviewer assignment.
- **Lighter bar for docs-only PRs** via path-based protection rule exemptions, if review-wait friction shows up.

## Questions

For open-ended discussion, use [GitHub Discussions](https://github.com/JimmyCapps/zentropy/discussions). For bug reports or feature requests, open an issue with the appropriate template.
