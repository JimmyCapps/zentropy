# Issue graph overlay

_Agent-maintained. Last synced: 2026-04-21T01:41:51.507Z_

**Clusters:** dialect, future-feature, hunters, nano, phase-3, phase-4, phase-5, phase-6+, phase-8-candidate, project-determillm, project-honeyllm, upstream

<!-- blocks below -->

```issue-graph
cluster: hunters
members: [3, 75, 80, 81]
note: Spider (deterministic), Hawk (classifier), and dialect packs compete for the same hunter-signal slot.
```

```issue-graph
cluster: dialect
members: [52, 75]
note: Gate B dialect vocabulary research + per-language extension.
```

```issue-graph
cluster: nano
members: [44, 45, 48, 60]
note: Chrome Prompt API / Gemini Nano optimisations and abort handling.
```

```issue-graph
edge: depends-on
from: 75
to: 52
note: Per-language dialect packs extend Gate B methodology shipped in #52.
```

```issue-graph
edge: competes-with
from: 81
to: 80
note: Hawk v1 and Spider 5A both want the fast-path deterministic signal slot.
```

```issue-graph
edge: same-signal
from: 75
to: 80
note: Spider is the deterministic-lexicon hunter; dialect packs extend the same signal multilingually.
```
