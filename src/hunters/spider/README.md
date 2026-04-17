# Spider — deterministic hunter for prompt injection

Ported from [`kynwu/ai-page-guard`](https://github.com/kynwu/ai-page-guard)'s
`src/lib/regex-rules.js` per the Stage 5A unblock offer in
[issue #3](https://github.com/JimmyCapps/zentropy/issues/3).

## What's here

- `patterns.ts` — pattern catalog + `scanText()`
- `patterns.test.ts` — 15 tests (5 instruction markers + 5 injection phrases + 5 clean-text guarantees + catalog shape)

Zero dependencies. Pure functions. Latency <1ms per chunk.

## What was intentionally not ported

`ai-page-guard` also exposes a `scanElement()` function that inspects DOM
nodes for `display:none` / `opacity:0` / `font-size:0` / off-screen
positioning combined with injection-signal text. That function is
**omitted** here because HoneyLLM's content-script ingestion already
separates visible vs hidden text into `PageSnapshot.visibleText` and
`PageSnapshot.hiddenText` (see `src/types/snapshot.ts`). Spider runs on
the extracted text chunks rather than the DOM, so the hidden-vs-visible
distinction is captured upstream.

If a "hidden text + injection signal" signal turns out to be useful in
the policy engine, the simplest path is to run `scanText()` over
`hiddenText` and emit a stronger flag than when it matches `visibleText`.
That can be added in the Hunter wrapper, not in the patterns module.

## Suggested orchestrator integration

The patterns module is interface-agnostic. A minimal Hunter shape that
matches HoneyLLM's existing `Probe` style would look like:

```typescript
// src/hunters/base-hunter.ts  (TBD — to be designed by James)
export interface HunterResult {
  readonly hunterName: string;
  readonly matched: boolean;
  readonly flags: readonly string[];
  readonly score: number;
}

export interface Hunter {
  readonly name: string;
  scan(chunk: string): HunterResult;
}

// src/hunters/spider/index.ts  (example wrap — actual shape TBD)
import type { Hunter, HunterResult } from '../base-hunter.js';
import { SCORE_INSTRUCTION_DETECTION } from '@/shared/constants.js';
import { scanText } from './patterns.js';

export const spiderHunter: Hunter = {
  name: 'spider',
  scan(chunk: string): HunterResult {
    const match = scanText(chunk);
    if (!match.matched) {
      return { hunterName: 'spider', matched: false, flags: [], score: 0 };
    }
    return {
      hunterName: 'spider',
      matched: true,
      flags: [`spider:${match.category}`, `pattern:${match.pattern}`],
      score: SCORE_INSTRUCTION_DETECTION,
    };
  },
};
```

Left unwired deliberately — the `Hunter` interface, scoring weights, and
orchestrator integration (parallel-to-probes vs upstream-of-probes) are
design decisions for James to make per Stage 5C (three-way verdict
coordination).

## Future pattern additions

The original ai-page-guard set was tuned to minimise false positives on
real-world browsing. Additional candidates evaluated but rejected:

| Candidate | Why rejected |
|-----------|-------------|
| `you are now` | Matches "you are now logged in" |
| `system prompt` | Matches legitimate tech docs |
| `jailbreak` | Matches iOS / security content |
| Standalone base64 | Matches auth tokens, data URIs, minified JS |

Any new pattern should carry the same invariant: must not fire on Gmail,
YouTube, Google Docs, or a typical news article.
