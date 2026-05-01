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
- **Stage 2** (this commit) — embedding population via transformers.js + `intfloat/multilingual-e5-small` (~118 MB, q8 quantised, 100+ languages, shared embedding space, 384 dimensions). Script: `scripts/embed-injection-corpus.ts` (`npm run embed:corpus`). Embeddings written back to the same `injection-corpus.json` file. Schema v2: every entry's `embedding` is an L2-normalised mean-pooled `passage:`-prefixed sentence embedding. Stage 4 (SW orchestrator integration) will compare runtime chunk embeddings to these via dot product == cosine similarity.
- **Stage 3** — vector index module + tier-router integration. May extend with vetted public datasets (Lakera Gandalf, jailbreak-prompts, OWASP LLM Top 10) after licence + provenance review.

### Invariants

- `id` values are unique across the corpus.
- `text` is non-empty for every entry.
- `lang` is one of the three documented values.
- `embedding` is either `null` or a fixed-length `number[]` matching the model's output dimension (writers must keep all entries consistent within one corpus version).
- The schema is enforced by `data/injection-corpus.test.ts`.
