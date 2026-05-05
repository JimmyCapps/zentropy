# Per-sprint kickoff files

Sequential 3-day sprints to ship the v0.1 → v1.0 completion plan. Each file is a **playbook** for one sprint: read the pre-flight checklist once at sprint start, then per work item paste one kickoff prompt block per Claude session.

Source-of-truth spec: [`../v0.1-completion.md`](../v0.1-completion.md). The plan doc holds the architecture / dependencies / scope-cut rules; the sprint files hold the paste-ready commands.

**Project board:** <https://github.com/JimmyCapps/zentropy/projects> · **Epic tracking:** [#248](https://github.com/JimmyCapps/zentropy/issues/248).

## How to run a work item

The discipline is **one Claude session per work item**, regardless of model / effort / thinking choices (memory rule: `feedback_session_per_item_discipline.md`). Compression and context degradation hit every model past a threshold; fresh sessions per item keep cache warm and avoid debugging-by-degradation.

For each item:

1. Read the sprint file's pre-flight checklist. Confirm or set: model, effort, plugins, MCP servers, repo state.
2. Open Claude in repo root with the recommended model + effort + flags. The exact paste-ready command is in **each issue's plan-pointer comment** (see project board → click any issue → first comment). Generic shape:
   ```bash
   cd "$(git rev-parse --show-toplevel)" && claude --model <model> --effort <low|medium|high|xhigh|max> --remote-control --chrome --dangerously-skip-permissions
   ```
   Effort `xhigh` and `max` enable extended thinking; there's no separate `--thinking` flag — thinking is folded into effort.
3. Paste the item's kickoff prompt block into Claude. Wait for it to complete.
4. Run the validation commands from the file. If they pass, exit (`Ctrl+D`). If they fail, paste the closeout prompt or escalate.
5. Next item → next fresh session.

## Slash commands

- **`/sprint <N.M>`** (e.g. `/sprint 1.2`) — start a planned sprint item. Reads the matching sprint file, presents kickoff prompt + validation + any human-test steps. Also handles troubleshoot items (e.g. `/sprint T1.3.1`) — same lookup, finds the appended `## Item T<N.M>.<seq>` block in the originating sprint file.
- **`/qa <PR#>`** — pre-merge QA gate. Compares the PR diff against acceptance criteria + the sprint kickoff prompt. Auto-invoked by the building session as a Sonnet child immediately before auto-merge; returns `PASS` / `CONCERNS` / `FAIL` on stdout. PRs FAIL `/qa` if tests are tautological (e.g. `expect(true).toBe(true)`), if the byte-locked Phase 2 baseline drifts, or if acceptance criteria are missing artifacts. See [`../v0.1-completion.md` §"Pre-merge QA gate"](../v0.1-completion.md#pre-merge-qa-gate--universal-across-all-sprints) for full spec.
- **`/troubleshoot [<N.M>]`** — investigate a problem that surfaced during manual verification of a completed item. Agnostic on framing; dialogue-driven; honors integrity rules (don't move goalposts, don't fabricate evidence, diagnosis confirmed before action). Creates a follow-up `T<N.M>.<seq>` work item only after a confirmed diagnosis and an agreed fix. **Persists state to the originating issue: posts a status comment + adds `troubleshoot-in-progress` label on Phase A start, updates at milestones, clears to `troubleshoot-resolved` on resolution. While `troubleshoot-in-progress` is present, the originating issue MUST NOT be closed (close-gate; multi-collaborator-safe).** See [`../v0.1-completion.md` §"Troubleshoot workflow"](../v0.1-completion.md#troubleshoot-workflow--when-manual-verification-surfaces-a-problem) for the full spec.

Slash commands live in `~/.claude/commands/`. Recommended runtime per command:
- `/sprint <N.M>` — model varies per sprint (see each sprint file's pre-flight checklist)
- `/qa` — Sonnet 4.6 / medium effort (cheap, fast comparison)
- `/troubleshoot` — Opus 4.7 / high effort (reasoning-heavy synthesis)

## Sprint files

| File | Sprint theme | Tag at end | Recommended model |
|---|---|---|---|
| [`sprint-1-stability.md`](sprint-1-stability.md) | Bugs + observability | — | haiku 4.5 / medium |
| [`sprint-2-phase3-closure.md`](sprint-2-phase3-closure.md) | Phase 3 closure + smokes | — | haiku 4.5 / medium |
| [`sprint-3-tag-v0.2.md`](sprint-3-tag-v0.2.md) | §4.2 + telemetry + ProtectAI | v0.2.0-internal | opus 4.7 / high |
| [`sprint-4-determillm-bridge.md`](sprint-4-determillm-bridge.md) | DM-A/E/F/G + Wolf design | — | haiku 4.5 / medium |
| [`sprint-5-wolf-nano.md`](sprint-5-wolf-nano.md) | Wolf canary + Nano + #119 | — | sonnet 4.6 / medium |
| [`sprint-6-tag-v0.3.md`](sprint-6-tag-v0.3.md) | Wolf finish + #227 + tag | v0.3.0-internal | sonnet 4.6 / medium |
| [`sprint-7-isolate-mode.md`](sprint-7-isolate-mode.md) | Isolate mode (#132) | — | opus 4.7 / high |
| [`sprint-8-local-proxy.md`](sprint-8-local-proxy.md) | Local Proxy w/ root CA (#133) | v0.4.0-internal | opus 4.7 / high |
| [`sprint-9-byok.md`](sprint-9-byok.md) | BYOK (#19) | — | sonnet 4.6 / medium |
| [`sprint-10-local-chat.md`](sprint-10-local-chat.md) | Local LLM chat (#4) | v0.5.0-internal | sonnet 4.6 / medium |
| [`sprint-11-agentic-design.md`](sprint-11-agentic-design.md) | Scheduled/agentic security model | — | opus 4.7 / high |
| [`sprint-12-tag-v1.md`](sprint-12-tag-v1.md) | Scheduled/agentic finish + ship | v1.0.0 | sonnet 4.6 / medium |

## Workflow rules (universal across sprints)

- Issue → branch `<type>/issue-<N>-<slug>` → PR → `Closes #N` → CI green → squash-merge.
- **Never** `Closes #2` or `Closes #248` from a PR (long-running tracker issues).
- **Spillover**: when closing item X partially completes planned item Y, comment on Y with what landed + what remains, set Y's project Status = `Partially Done`, append to the epic issue's spillover log.
- Auto-merge once CI green. Pre-push runs typecheck + test + build; never `--no-verify`.
- `npm audit` + AIza-≥20 grep before first `git add`.
- TypeScript strict; files <400 lines (cap 800); no `any` in app code.
- Don't touch `docs/testing/inbrowser-results.json` (Phase 2 byte-locked baseline).
