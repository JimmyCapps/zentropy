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
   cd /Users/node3/Documents/projects/HoneyLLM && claude --model <model> --effort <low|medium|high|xhigh|max> --remote-control --chrome --dangerously-skip-permissions
   ```
   Effort `xhigh` and `max` enable extended thinking; there's no separate `--thinking` flag — thinking is folded into effort.
3. Paste the item's kickoff prompt block into Claude. Wait for it to complete.
4. Run the validation commands from the file. If they pass, exit (`Ctrl+D`). If they fail, paste the closeout prompt or escalate.
5. Next item → next fresh session.

## Slash command

`~/.claude/commands/sprint.md` provides `/sprint <N.M>` (e.g. `/sprint 1.2`). It reads the matching sprint file, finds the item block, and presents the kickoff prompt + validation + any human-test steps in-conversation. See the slash command's source for exact behaviour.

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
