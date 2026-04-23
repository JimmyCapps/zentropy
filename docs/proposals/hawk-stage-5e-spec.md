# Proposal — Stage 5E: Hawk (fourth hunter)

**Status:** proposal (external, kynwu). Not shipped. Intended to land as a
new stage under issue #3 if James agrees with the framing.
**Context:** follow-up to PR #1 and the Hawk proposal posted on issue #3.

## TL;DR

Add a fourth hunter — **Hawk** — to the Phase 5 architecture. Hawk is a
trained classifier that scores raw content directly using a small ONNX
model (Meta Prompt Guard 22M). It runs on CPU via WASM, requires no LLM
inference, and produces a verdict in 50–200ms per chunk. Its failure
mode (attacks unlike training distribution) is orthogonal to Canary /
Spider / Wolf, so the four hunters cover a strictly larger space than
three.

## Why a fourth hunter

Each of the three hunters in #3 catches a distinct injection failure mode:

| Hunter | Signal source | Misses when |
|--------|--------------|-------------|
| Canary | LLM behaviour on curated probes | Page doesn't provoke the probed behaviours |
| Spider | Known pattern signatures | Injection is novel or paraphrased |
| Wolf | Llama-3.2-1B refusal as detection | Llama complies with the injection rather than refusing |
| **Hawk** (proposed) | **Trained classifier on raw content** | **Attack is unlike training distribution** |

Hawk's failure mode is orthogonal. Where Wolf depends on Llama's refusal
behaviour and Canary depends on the probed LLM's response, Hawk has no
LLM in the loop — it computes a score from the content tokens directly.
Where Spider is bound to its pattern catalog, Hawk generalises through
statistical patterns learned from millions of training examples.

## Where Hawk sits

```
┌──────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Service Worker)          │
│                                                           │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│   │  Spider  │ │  Hawk    │ │  Wolf    │ │  Canary  │   │
│   │ (regex)  │ │(ONNX CLS)│ │(Llama-1B)│ │(Gemma/Nano)│  │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│        │            │             │             │         │
│        └────────────┴─────────────┴─────────────┘         │
│                         │                                 │
│                    HunterResult[]                         │
│                         │                                 │
│                         ▼                                 │
│                  Policy Engine (5C)                       │
│                         │                                 │
│                         ▼                                 │
│                   SecurityVerdict                         │
└──────────────────────────────────────────────────────────┘
```

Hawk is a peer of Spider / Wolf / Canary, not an upstream filter (this is
the reframe from PR #1, which pitched a pre-filter stage). The orchestrator
runs all four in parallel where resources permit, and the policy engine
aggregates their results per the Stage 5C design.

## Proposed `Hunter` interface

Preliminary. The shape below mirrors `Probe` from `src/probes/base-probe.ts`
to fit HoneyLLM's existing style. James owns the final design.

```typescript
// src/hunters/base-hunter.ts  (proposed)
export interface HunterResult {
  readonly hunterName: string;
  readonly matched: boolean;
  readonly flags: readonly string[];
  readonly score: number;
  /**
   * Populated when the hunter invocation threw. Null on successful runs.
   * Mirrors ProbeResult.errorMessage so the policy engine's error-aware
   * branching (Phase 4 Stage 4A) applies uniformly across hunters and
   * probes.
   */
  readonly errorMessage: string | null;
}

export interface Hunter {
  readonly name: string;
  scan(chunk: string): Promise<HunterResult>;
}
```

`scan()` is async because Hawk needs to await ONNX inference. Spider's
synchronous regex scan is trivially wrapped in `Promise.resolve(...)`.

## Hawk implementation sketch

### Files

```
src/hunters/hawk/
  index.ts             — Hunter export
  classifier.ts        — Prompt Guard 22M session management
  cascade.ts           — optional DeBERTa v3 cascade for borderline scores
  thresholds.ts        — score → verdict mapping
  model-loader.ts      — ONNX Runtime Web + Transformers.js bootstrap
  patterns.test.ts     — unit tests (mocked classifier)
  classifier.test.ts   — ONNX runtime integration tests
models/
  Llama-Prompt-Guard-2-22M.onnx    (~69MB, bundled)
  tokenizer-config/                (bundled)
```

### Primary model

- **Name:** Meta Llama Prompt Guard 2 (22M parameters)
- **Source:** [`gravitee-io/Llama-Prompt-Guard-2-22M-onnx`](https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx)
- **Output:** `BENIGN` / `MALICIOUS` softmax, threshold at 0.5 (tunable)
- **Bundle:** ~69MB, loaded from `chrome-extension://` URL at startup (no network fetch after install)

### Runtime stack

- [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) (v4+) for tokenization
- ONNX Runtime Web with the **WASM backend** (not WebGPU)
- Runs in the offscreen document alongside the MLC engine, or in its own
  offscreen document if resource contention is an issue

Decoupled from WebGPU → runs on any Chrome install regardless of GPU
availability. CPU-only extensions of HoneyLLM become possible.

### Optional DeBERTa v3 cascade

For borderline Prompt Guard scores (0.30 ≤ score ≤ 0.85), optionally
forward to [`protectai/deberta-v3-base-injection-onnx`](https://huggingface.co/protectai/deberta-v3-base-injection-onnx)
for a second opinion. DeBERTa (704MB) is larger and slower (~500ms) but
trained on a different dataset, so cascade disagreement is a useful
uncertainty signal.

Cascade is opt-in. Without it, Hawk is a single-model classifier.

### Regex fast-path integration

If Spider has already flagged a chunk with an `instruction_marker`
category match, Hawk can short-circuit — no need to invoke the classifier
for a chunk that the deterministic hunter already caught. Saves ~100ms
per flagged chunk. Implementation lives in the orchestrator's four-hunter
scheduling, not inside Hawk itself.

## Integration with orchestrator

### Option A: parallel to probes (preferred)

```typescript
// src/service-worker/orchestrator.ts — analyzeSnapshot()
const probeResults = await runChunkProbes(args);
const hunterResults = await runChunkHunters(args);      // NEW

const mergedProbes = mergeProbeResults(probeResultsAllChunks);
const mergedHunters = mergeHunterResults(hunterResultsAllChunks); // NEW
const behavioral = analyzeBehavior(mergedProbes);
const verdict = evaluatePolicy(
  mergedProbes,
  mergedHunters,   // NEW — policy engine gets hunter signals too
  behavioral,
  url,
  aggregateError,
);
```

### Option B: hunters as a separate orchestrator stage

Run hunters first. If Spider or Hawk score ≥ COMPROMISED threshold,
return early without running probes. This is similar to the PR #1
pre-filter pitch but at the hunter level rather than pattern level.

Option A is cleaner (uniform aggregation, no early-return special cases)
but Option B saves compute on unambiguously malicious pages.

James's call. The answer shapes 5C.

## Scoring contribution (5C question)

Hawk emits `score` on a scale compatible with `THRESHOLD_SUSPICIOUS` (30)
and `THRESHOLD_COMPROMISED` (65) in `src/shared/constants.ts`. Suggested
mapping:

| Prompt Guard score | Hawk score | Reasoning |
|--------------------|-----------|-----------|
| 0.00 – 0.30 | 0 | Clean |
| 0.30 – 0.60 | 15 (`SCORE_ROLE_DRIFT`-equivalent) | Borderline, single signal |
| 0.60 – 0.85 | 35 (crosses SUSPICIOUS) | Probable injection |
| 0.85 – 1.00 | 65 (crosses COMPROMISED alone) | Classifier confident |

Open question for 5C: does Hawk score contribute additively to the
existing probe/behavioural score, or does it voting-model with the
other hunters? Additive is simplest; voting is safer against model bias.

## Resource cost

| Component | Startup | Steady-state |
|-----------|---------|--------------|
| Model load (bundled, from chrome-extension://) | ~1s | 0 (held in-session) |
| Tokenizer warm | <100ms | <50ms per chunk |
| ONNX inference | — | 50–200ms per chunk (4K tokens, CPU WASM) |
| Memory | — | ~90MB (model + tokenizer + session state) |

Per-chunk latency <200ms means Hawk completes faster than a single Nano
probe. With 4 chunks at `MAX_CHUNKS_PER_PAGE`, total Hawk time is
~800ms per page. Below Canary's budget.

## Failure modes

| Failure | Handling |
|---------|----------|
| Model file missing / corrupted | `HunterResult.errorMessage` set, policy engine treats as UNKNOWN contribution |
| ONNX Runtime init fails | Same as above; Hawk disabled for session, other hunters continue |
| Chunk exceeds 4K-token input | Truncate to first 4K tokens, emit a `hawk:truncated_input` flag |
| Classifier unsure (score in 0.30-0.85) | Cascade to DeBERTa if enabled, else emit `hawk:borderline` with SUSPICIOUS-only score |

## Testing plan

- **Unit:** pattern-ish tests with a mocked classifier (returns deterministic scores for known inputs). ~15 tests mirroring Spider's test shape.
- **Integration:** real ONNX runtime against a small fixture set — known injection samples, known clean samples. Asserts accuracy bounds rather than exact scores.
- **Behavioural:** run Hawk against `test-pages/` fixtures alongside existing probes, compare verdicts in a sweep similar to Phase 3 Track B.

## What's needed from zentropy side

1. **`Hunter` interface design** — confirm the shape proposed above or specify alternative.
2. **Orchestrator integration option** — A (parallel) or B (early-exit stage).
3. **Scoring fusion rule** — additive vs voting with Spider / Wolf / Canary (5C).
4. **Model hosting decision** — bundle 69MB into the extension (ai-page-guard approach), or lazy-load from a CDN.
5. **Build toolchain** — ONNX models need `vite-plugin-static-copy` or similar to copy from `models/` into `dist/`. Already set up in ai-page-guard; would need to port to HoneyLLM's Vite config.

## What ai-page-guard can contribute

- Pre-built ONNX integration and tokenizer config (working today)
- Regex fast-path module (already ported as Spider — see `src/hunters/spider/`)
- DOM-node → flag mapping architecture (relevant to Stage 5D)
- Test fixtures covering Gmail, YouTube, Docs, and a news-article corpus
  tuned to avoid false positives

## Open questions

- **Where does Hawk live architecturally?** Peer hunter (Option A above) or
  upstream pre-filter (PR #1 framing)?
- **Is the Prompt Guard 22M model acceptable licensing-wise for the
  extension's distribution?** Apache-2 per the `gravitee-io` mirror, but
  Meta's underlying license should be confirmed.
- **Who maintains the ONNX model pin?** Pinning to a specific model version
  is important for reproducibility; updating requires sweep + regression
  testing.
- **Does Hawk need its own offscreen document**, or can it share with the
  MLC engine? Sharing is simpler; separate document gives stronger
  resource isolation if both need to run concurrently.

---

*This proposal is deliberately shaped to be droppable or mergeable without
locking in design decisions. If Hawk doesn't resonate, the Spider port in
`src/hunters/spider/` remains useful on its own for Stage 5A.*
