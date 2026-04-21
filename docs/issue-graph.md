# Issue graph overlay

_Agent-maintained. Last synced: 2026-04-21T22:28:16.233Z_

**In progress:** #86 (branch fix/issue-86-harness-local-http — restoring http delivery via scripts/serve-harnesses.ts (loopback 127.0.0.1:8765) + content-script early-return on that host. Not closing #86 (manifest-level file:// exclude remains a separate design decision).)

**Clusters:** chat-agentic, classifier, determillm-gates, determillm-tracking, dialect, future-feature, hunters, infrastructure, nano, phase-3, phase-4, phase-5, phase-6+, phase-8-candidate, phase-8-engine, project-determillm, project-honeyllm, upstream

<!-- blocks below -->

```issue-graph
cluster: hunters
members: [3, 75, 80, 81]
note: Spider (deterministic), Hawk (classifier), Wolf (Llama refusal), Canary (LLM), and per-coding-language dialect packs — all compete for hunter-signal slots. PR #80 shipped 5A Spider, PR #81 proposes Hawk v1.
```

```issue-graph
cluster: dialect
members: [75]
note: Gate B dialect vocabulary methodology — extension from natural-language (ES/zh-CN shipped via closed #52 research) to per-coding-language packs.
```

```issue-graph
cluster: nano
members: [8, 9, 44, 45, 48, 60]
note: Chrome Prompt API / Gemini Nano — responseConstraint, long-lived session, abort handling, language detection, image-multimodal probe, plus the Chromium-family browser-compat audit.
```

```issue-graph
cluster: infrastructure
members: [2, 16]
note: Phase 3 Track B Stage B5-B7 coordination + the upstream MLC web-llm race-condition dependency.
```

```issue-graph
cluster: classifier
members: [15, 83, 84]
note: Classifier lineage: v1 substring (byte-locked) → v2 JSON-aware (shipped via closed #13) → v3 refusal-with-quoted-URL disambiguation (#83). Mini-sweep #15 for FP tuning. Test-tooling drift #84 (Gemini timeout) tracks here because it affects classifier-run reliability.
```

```issue-graph
cluster: phase-8-engine
members: [6, 14, 17, 18, 25, 51, 86]
note: Phase 8 engine polish: delta-cache + turboquant (#6), Nano replicates (#14), engine-health probe (#17), chunk concurrency revisit (#18), tokeniser-aware chunking (#25), site-structure registry (#51), file:// content-script exclusion (#86).
```

```issue-graph
cluster: chat-agentic
members: [4, 5, 19]
note: Phase 6+ future features — local LLM chat UI, scheduled/agentic tasks with security-first constraints, BYOK / premium-model integration.
```

```issue-graph
cluster: determillm-gates
members: [67, 68, 69, 70, 71, 72, 73, 74]
note: DetermiLLM research gates DM-0 through DM-7 — architecture derivation (#67), position doc (#68), enforcement-path design (#69), scope-derivation prototype (#70), structural pedagogical-FP test (#71), enterprise feature spec (#72), deployment-mode analysis (#73), image + code dialect research (#74).
```

```issue-graph
cluster: determillm-tracking
members: [66, 76, 77, 78, 79]
note: DetermiLLM project-level tracking — seed (#66), OSS licence (#76), codename phonetics (#77), layered-security positioning (#78), pre-gate kickoff (#79).
```

```issue-graph
edge: competes-with
from: 81
to: 80
note: Hawk v1 and Spider 5A both want the fast-path deterministic signal slot. Resolution is PR review (see #3 Phase 5 design discussion).
```

```issue-graph
edge: same-signal
from: 75
to: 80
note: Spider is the deterministic-lexicon hunter; per-coding-language dialect packs (#75) extend the same signal multilingually.
```

```issue-graph
edge: depends-on
from: 2
to: 8
note: Stage B5-B7 real-wrapper leg benefits from #8 Chromium-family audit completing, but not strict blocker — B5 can use Chrome Stable alone.
```

```issue-graph
edge: depends-on
from: 75
to: 48
note: Per-coding-language dialect packs need Language Detector graceful-skip (#48) wired in first to route non-English content.
```

```issue-graph
edge: blocks
from: 86
to: 14
note: File:// content-script exclusion (#86) blocks Nano replicate-sampling (#14) — harness can't run while extension auto-analyses the same page.
```

```issue-graph
status: touched
issue: 86
completed: 2026-04-22T00:15:00Z
note: PR #89 merged — loopback http delivery + content-script early-return on 127.0.0.1:8765. #86 remains open for the manifest-level file:// exclude decision.
```

```issue-graph
status: in-progress
issue: 2
started: 2026-04-22T00:25:00Z
note: branch refactor/unified-harness-console — unified hash-routed Test Console covering S1–S4 of the manual test plan. Directly supports closing #2 Stage B5 (Claude/ChatGPT/Gemini matrices) and #14 Nano replicate sweep. Adds SW externally_connectable handler for contention-aware amber Start.
```
