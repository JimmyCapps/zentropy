# Nano replicate-sampling entry template — issue #14

**Goal:** 5 replicates × 27 cells (9 inputs × 3 probes) = 135 rows of Nano variance data.
**Harness:** `test-pages/nano-harness.html` (already supports the 27-cell grid).

## Pre-flight

1. Chrome Stable, EPP-enrolled profile.
2. Confirm `chrome://on-device-internals/` shows Gemini Nano **Ready**.
3. Load `file:///Users/node3/Documents/projects/HoneyLLM/test-pages/nano-harness.html`.
4. If the harness does NOT yet have an "N replicates" input box (per #14), the harness needs a small patch — see TODO at end of this file.

## Sidecar schema target

Write results to `docs/testing/phase3/nano-replicates.json` with this shape
(mirrors `inbrowser-results-affected-replicates.json`):

```json
{
  "schema_version": "1.0",
  "test_date": "2026-04-21",
  "engine": "nano",
  "replicates_per_cell": 5,
  "results": [
    {
      "input": "clean_recipe",
      "probe": "summarization",
      "replicate": 1,
      "category": "clean",
      "output": "...",
      "inference_ms": 1234,
      "complied": false,
      "leaked_prompt": false,
      "included_url": false,
      "classification_version": "v2"
    }
    // ... 134 more
  ],
  "variance": {
    "<input>|<probe>": {
      "replicates": 5,
      "inference_ms_min": 0,
      "inference_ms_max": 0,
      "inference_ms_stddev": 0,
      "classifications_unique": 1,
      "jaccard_overlap": 1.0
    }
  }
}
```

## Expected findings (hypothesis from #14)

Gemma's Track A Stage 7b variance was modest — Jaccard overlap across replicates typically >0.8. Nano's variance is probably similar or lower (smaller model, temperature: 0.1). But "probably" is not a measurement.

## Harness TODO

If the harness doesn't already support an "N replicates" input:

**File:** `test-pages/nano-harness.ts`

```ts
// Add at top of config block
const REPLICATES = Number((document.getElementById('replicates') as HTMLInputElement)?.value ?? 1);

// Wrap the per-cell probe loop:
for (let r = 1; r <= REPLICATES; r++) {
  const out = await runProbeOnCell(probe, input);
  results.push({ ...out, replicate: r });
}
```

Add matching HTML:
```html
<label>Replicates <input id="replicates" type="number" min="1" max="20" value="5"></label>
```

Test the patch with `npm test` (harness has no unit tests today — visual sanity only) and a 1-cell replicates=3 run before committing to the full 135 rows.

## Time budget

- Harness patch: ~20 minutes
- Full sweep: ~10 minutes wall-clock on Nano (~4-8s per cell × 135 cells × UI overhead)
- Variance analysis + addendum writeup: ~1 hour

## When done

1. Commit `nano-replicates.json` under a feat branch referencing #14.
2. Extend `docs/testing/phase3/NANO_BASELINE_ADDENDUM.md` with §Replicates.
3. Close #14.
