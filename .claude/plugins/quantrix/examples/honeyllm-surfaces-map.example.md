# Example: HoneyLLM surfaces map

This is an illustrative example of a surfaces map for the HoneyLLM project. It conforms to the schema in `quantrix/docs/surfaces-map-spec.md`.

The actual HoneyLLM surfaces map lives at `docs/agent-context/known-surfaces.md` in the HoneyLLM repo. This example excerpts the high-value sections to show the schema in practice.

```markdown
# HoneyLLM known surfaces

Living document. Updated as new surfaces ship. Schema in `quantrix/docs/surfaces-map-spec.md`.

## Caches

| Key | Storage | TTL | Shape | Verification command |
|---|---|---|---|---|
| `honeyllm:scan-cache` | chrome.storage.local | 24h | `{[url]: {verdict, ts, mitigations[]}}` | `await chrome.storage.local.get('honeyllm:scan-cache')` |
| `honeyllm:cache-telemetry` | chrome.storage.local | none | `{count, hits, misses, lastClearTs}` | `await chrome.storage.local.get('honeyllm:cache-telemetry')` |
| `honeyllm:response-telemetry` | chrome.storage.local | none | `{[probe]: {runs, successes, failures}}` | `await chrome.storage.local.get('honeyllm:response-telemetry')` |
| `honeyllm:thinking-telemetry` | chrome.storage.local | none | `{[probe]: {tokens, latencyMs}}` | `await chrome.storage.local.get('honeyllm:thinking-telemetry')` |

## Storage keys (non-cache)

| Key | Storage | Shape | Verification command |
|---|---|---|---|
| `honeyllm:logging-state` | chrome.storage.local | `{connected, heartbeat: {global, perTab: {[tabId]: bool}}}` | `await chrome.storage.local.get('honeyllm:logging-state')` |
| `honeyllm:last-verdict` | chrome.storage.local | `{verdict, mitigations[], ts, url}` | `await chrome.storage.local.get('honeyllm:last-verdict')` |
| `honeyllm:user-config` | chrome.storage.sync | `{enabled, strictBypass, byok: {provider, model}}` | `await chrome.storage.sync.get('honeyllm:user-config')` |

## Message types

| Type | Sender | Receiver | Payload | Notes |
|---|---|---|---|---|
| `PAGE_SNAPSHOT` | content | service-worker | `{html, url, snapshotTs}` | Triggers offscreen create on first call after reload |
| `STATE_QUERY` | harness | service-worker | `{}` | Returns full pipeline state for non-disruptive introspection |
| `SET_LOGGING_STATE` | service-worker | content (via Port) | `{viewerConnected, heartbeatActive}` | Gates content-side log Port emissions |

## Hunters

| Name | Module | Threshold | Verification |
|---|---|---|---|
| Spider | `src/hunters/spider/index.ts` | substring match | `npm test -- spider` |
| Hawk | `src/hunters/hawk/index.ts` | regex / language-router | `npm test -- hawk` |
| Embeddings | `src/hunters/embeddings/index.ts` | cosine ≥ 0.85 | `npm test -- embeddings` |
| DetermiLLM (stub) | `src/hunters/determillm/index.ts` | pack-runtime | `npm test -- determillm` |

## Canaries

| Name | Module | Engine | Capabilities |
|---|---|---|---|
| Gemma-2-2b | `src/offscreen/canaries/gemma-canary.ts` | MLC WebLLM (WebGPU) | text |
| Nano | `src/offscreen/canaries/nano-canary.ts` | Chrome Prompt API | text, image |
| Wolf (Llama-3.2-1B) | `src/offscreen/canaries/wolf-canary.ts` | MLC WebLLM | text (refusal-as-detection) |

## Probes

| Name | Module | Triggered by | Returns |
|---|---|---|---|
| InstructionFollow | `src/probes/instruction-follow/` | dispatcher | `{found, instructions[]}` |
| ImageInjection | `src/probes/image-injection/` | dispatcher when image present | `{found, technique}` |
| RedirectGate | `src/probes/redirect-gate/` | webNavigation | `{action: 'allow' | 'block'}` |

## Mitigations

| Name | Module | Surface |
|---|---|---|
| InjectionMask | `src/content/mitigations/injection-mask.ts` | DOM (CSS overlay) |
| FetchOverride | `src/content/main-world-inject.ts` | network (fetch + XHR) |
| RedirectGuard | `src/service-worker/redirect-guard.ts` | webNavigation |

## Test pages

| Path | Purpose | Expected verdict |
|---|---|---|
| `test-pages/clean/sourdough.html` | clean control | CLEAN |
| `test-pages/clean/image-heavy.html` | clean image-heavy | CLEAN |
| `test-pages/injected/instruction-overt.html` | overt injection | COMPROMISED |
| `test-pages/injected-images/text-overlay.html` | image text overlay | COMPROMISED |
| `test-pages/injected-images/qr-injection.html` | QR-encoded injection | SUSPICIOUS or COMPROMISED |

## Byte-locked files

| Path | Reason | Lock authority |
|---|---|---|
| `docs/testing/inbrowser-results.json` | Phase 2 canonical baseline (162 rows) | CLAUDE.md |
| `scripts/fixtures/phase2-inputs.ts::classifyOutput` (v1) | byte-identity contract | CLAUDE.md |
```

## How AC reference this map

A Manual AC line in an issue body:

```
- [manual] · Reload extension, hard-reload bricklink.com/v2/main.page · expect popup verdict CLEAN with no mitigations · verify via storage:honeyllm:last-verdict
```

`/te` resolves `storage:honeyllm:last-verdict` against the surfaces map's "Storage keys (non-cache)" section, finds:

```
| `honeyllm:last-verdict` | chrome.storage.local | ... | `await chrome.storage.local.get('honeyllm:last-verdict')` |
```

…and renders the sub-step with:

```
  Run: await chrome.storage.local.get('honeyllm:last-verdict')
```

Without the surfaces map, `/te` would have to ask the user to invent the verification command — error-prone.
