# `data/` — curated reference data

Files in this directory are committed reference data used at extension build / runtime.

## `injection-corpus.json`

Curated corpus of known prompt-injection patterns. Tier 2.5 of the Hunter pipeline (#129) embeds these into a vector index and scores incoming chunks by cosine similarity.

### Schema (v1)

```jsonc
{
  "schema_version": 1,
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
npx tsx scripts/build-injection-corpus.ts
```

Re-running the build is deterministic — the DM-4 sample is stride-based, not random. Output is byte-stable except for the `generated_at` timestamp.

### Stage rollout

- **Stage 1** (this commit) — bootstrap from in-repo materials: 15 hand-curated honeypots from `test-pages/injected/` + 15 sampled per-language from the DM-4 1250-fixture corpus (`test-pages/injected-corpus/{en,es,zh-CN}/`, originally landed in PR #111 / issue #110). Total: 60 entries, embeddings null.
- **Stage 2** — embedding population via transformers.js + `intfloat/multilingual-e5-small` (~118 MB, 100+ languages, shared embedding space). New script: `scripts/embed-injection-corpus.ts`. Embeddings written back to the same `injection-corpus.json` file.
- **Stage 3** — extend with vetted public datasets (Lakera Gandalf, jailbreak-prompts, OWASP LLM Top 10) after licence + provenance review.

### Invariants

- `id` values are unique across the corpus.
- `text` is non-empty for every entry.
- `lang` is one of the three documented values.
- `embedding` is either `null` or a fixed-length `number[]` matching the model's output dimension (writers must keep all entries consistent within one corpus version).
- The schema is enforced by `data/injection-corpus.test.ts`.
