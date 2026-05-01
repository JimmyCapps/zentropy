# `data/` — curated reference data

Files in this directory are committed reference data used at extension build / runtime.

## `injection-corpus.json`

Curated corpus of known prompt-injection patterns. Tier 2.5 of the Hunter pipeline (#129) embeds these into a vector index and scores incoming chunks by cosine similarity.

### Schema (v1 → v2)

`schema_version: 1` — Stage 1 layout, every `embedding` is `null`.
`schema_version: 2` — Stage 2 layout, every `embedding` is a length-384 number array (rounded to 6 dp) of an L2-normalised mean-pooled `passage:`-prefixed sentence embedding produced by `intfloat/multilingual-e5-small` (q8). Other fields are unchanged.

```jsonc
{
  "schema_version": 1 | 2,
  "generated_at": "<ISO-8601>",
  "schema": { /* field documentation */ },
  "notes": [ /* free-form provenance + roadmap */ ],
  "count": <number>,
  "entries": [
    {
      "id": "<stable-identifier>",         // e.g. honeypot/injected/hidden-div-basic, dm4/en/train-injection-0065
      "source": "<provenance string>",     // human-readable origin (file path, PR ref)
      "text": "<extracted payload>",       // post-HTML-strip, whitespace-collapsed
      "lang": "en" | "es" | "zh-CN",       // primary language
      "techniques": ["<tag>", ...],        // technique tags from manifest.json or generated
      "embedding": null | number[]         // populated by Stage 2 build script; null in Stage 1
    }
  ]
}
```

### Build

```bash
# Stage 1 — re-bootstrap entries from in-repo materials.
npx tsx scripts/build-injection-corpus.ts

# Stage 2 — populate `embedding[]` for every entry by running the
# multilingual-e5-small model in Node. ~118 MB model lazy-downloads to
# ~/.cache/huggingface on first run; subsequent runs hit the cache.
npm run embed:corpus
```

Both build steps are deterministic — Stage 1 stride-samples DM-4 and Stage 2 rounds embeddings to 6 dp. Output is byte-stable except for the `generated_at` timestamp (which Stage 2 deliberately preserves so re-embedding does not drift the corpus identity).

### Stage rollout

- **Stage 1** — bootstrap from in-repo materials: 15 hand-curated honeypots from `test-pages/injected/` + 15 sampled per-language from the DM-4 1250-fixture corpus (`test-pages/injected-corpus/{en,es,zh-CN}/`, originally landed in PR #111 / issue #110). Total: 60 entries, embeddings null. Schema v1.
- **Stage 2** — embedding population via transformers.js + `intfloat/multilingual-e5-small` (~118 MB, q8 quantised, 100+ languages, shared embedding space, 384 dimensions). Script: `scripts/embed-injection-corpus.ts` (`npm run embed:corpus`). Embeddings written back to the same `injection-corpus.json` file. Schema v2: every entry's `embedding` is an L2-normalised mean-pooled `passage:`-prefixed sentence embedding. Stage 4 (SW orchestrator integration) compares runtime chunk embeddings to these via dot product == cosine similarity.
- **Stage 3** — vector index module + tier-router integration.
- **Stage 4** — SW↔offscreen `EMBED_TEXT` bridge + corpus-loader bootstrap; embeddings hunter wired live as the third Hunter alongside Spider / Hawk.
- **Stage 5** — popup-render of embeddings-Hunter signal. New `<details id="accordion-embeddings">` accordion in the popup renders per-chunk top matches with cosine score + technique chips.
- **Stage 6** (this commit) — corpus expansion 60 → 265 entries (15 honeypot + 165 EN + 50 ES + 50 zh-CN — DM-4 EN sample 15 → 150, ES + zh-CN 15 → 50 (full directories)). Sits comfortably in the #129 acceptance-criteria 200–500 range with 235 entries of headroom under the upper bound. Future expansion: vetted public datasets (Lakera Gandalf, jailbreak-prompts, OWASP LLM Top 10) require licence + provenance review and stay deferred.

### Threshold tuning protocol

`EMBEDDING_COSINE_THRESHOLD` is exposed as a constant in `src/hunters/embeddings/vector-index.ts` (default `0.85`). Re-tuning is gated on:

1. **Telemetry source.** Per-origin `SecurityVerdict` records persisted under `honeyllm:verdict:{origin}` carry an optional `embeddingsFindings` array per chunk. Each finding's `topScore` (the chunk-to-corpus top cosine) is the raw signal; `activations` carries the full top-k `<id>@<score>` list for distribution analysis.
2. **Pedagogical-FP gate.** Per memory `project_pedagogical_fpr_baseline.md`, the Hunter-layer baseline is 0/50 compromised on the pedagogical FPR corpus. Any threshold relaxation MUST preserve that gate or be rejected.
3. **Phase 2 byte-locked baseline.** `docs/testing/inbrowser-results.json` is byte-locked per CLAUDE.md. Threshold changes are display-only with respect to this file, but a regression run is the cheapest sanity check before opening a tuning PR.

Process: collect ≥7 days of `embeddingsFindings` distributions across real-world traffic, plot cosine distribution by chunk-classification bucket, pick a threshold that preserves the 0/50 pedagogical-FP gate, ship behind a single-PR change to the constant.

### Invariants

- `id` values are unique across the corpus.
- `text` is non-empty for every entry.
- `lang` is one of the three documented values.
- `embedding` is either `null` (v1) or a fixed-length `number[]` matching the model's output dimension (writers must keep all entries consistent within one corpus version).
- Total entry count is in the [200, 500] range per #129 acceptance criteria.
- Non-English coverage is non-trivial (≥20 entries each for `es` and `zh-CN`).
- The schema is enforced by `data/injection-corpus.test.ts`.
