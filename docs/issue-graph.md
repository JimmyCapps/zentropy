# Issue graph overlay

_Agent-maintained. Last synced: 2026-04-25T14:17:04.101Z_

**In progress:** #94 (branch fix/issue-94-persistence-error-surface — PRS-1..4 fix on harnesses/lib/harness-state.ts. Adds Array.isArray guard to loadState, switches saveState to boolean return + console.error logging, runs a hand-written serializability validator before JSON.stringify (rejects BigInt/Date/Map/Set/RegExp/function/symbol/circular). Also enables harnesses/**/*.test.ts in vitest config so the new colocated test suite (19 cases) runs in CI.)

**Clusters:** chat-agentic, classifier, determillm-gates, determillm-tracking, dialect, future-feature, hunters, infrastructure, nano, phase-3, phase-4, phase-5, phase-6+, phase-8-candidate, phase-8-engine, project-determillm, project-honeyllm, upstream

<!-- blocks below -->

```issue-graph
cluster: hunters
members: [3, 75, 80, 81, 103]
note: Spider (deterministic), Hawk (classifier), Wolf (Llama refusal), Canary (LLM), and per-coding-language dialect packs — all compete for hunter-signal slots. PR #80 shipped 5A Spider, PR #81 shipped 5E Hawk v1; ultrareview follow-ups on Hawk v1 in flight via #103 (PR #104). 5B Wolf + 5C Canary remain.
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
note: Classifier lineage: v1 substring (byte-locked) → v2 JSON-aware (shipped via closed #13) → v3 refusal-with-quoted-URL disambiguation (#83). Mini-sweep #15 for FP tuning. Test-tooling drift #84 (Gemini timeout) tracks here because it affects classifier-run reliability. Harness S3-matrix bare-substring URL FP fix shipped via closed #92 (PR #98, 2026-04-23).
```

```issue-graph
cluster: phase-8-engine
members: [6, 14, 17, 18, 25, 51, 86, 93, 94, 95, 96]
note: Phase 8 engine polish: delta-cache + turboquant (#6), Nano replicates (#14), engine-health probe (#17), chunk concurrency revisit (#18), tokeniser-aware chunking (#25), site-structure registry (#51), file:// content-script exclusion (#86). Harness hygiene surfaced by 2026-04-23 behavioural testing: Web Locks API for cross-tab sweep race (#93), persistence observability + Zod (#94), contention banner inFlightCount (#95), SUSPICIOUS vs COMPROMISED chip rendering (#96). pendingChip helper + currentRoute JSDoc shipped via closed #97 (PR #99, 2026-04-23).
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
status: touched
issue: 2
completed: 2026-04-23T08:30:00Z
note: PRs #90, #91, #98, #99 shipped harness-layer support for S3 matrix testing (Test Console, sweep resume, classifier fix, pendingChip helper). #2 was auto-closed by PR #98's Development-panel linkage and manually reopened — remaining scope is the B5 manual agent-mode testing + B7 regression report, pending $20 AUD budget and user time at agent UIs. Next session: guided manual testing walkthrough.
```

```issue-graph
status: touched
issue: 3
completed: 2026-04-23T11:45:00Z
note: PR #81 landed 5E Hawk v1 (feature-based dialect pre-filter) + runHunters + benchmark harness. #3 remains open for 5B Wolf + 5C Canary + orchestrator integration. 1250-fixture dialect-as-regex analysis contributed to #71 is deferred DetermiLLM work.
```

```issue-graph
status: in-progress
issue: 94
started: 2026-04-25T00:00:00Z
note: branch fix/issue-94-persistence-error-surface — PRS-1..4 fix on harnesses/lib/harness-state.ts. Adds Array.isArray guard to loadState, switches saveState to boolean return + console.error logging, runs a hand-written serializability validator before JSON.stringify (rejects BigInt/Date/Map/Set/RegExp/function/symbol/circular). Also enables harnesses/**/*.test.ts in vitest config so the new colocated test suite (19 cases) runs in CI.
```
