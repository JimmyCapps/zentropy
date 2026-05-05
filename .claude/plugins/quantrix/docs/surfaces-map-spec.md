# Surfaces map — schema for consuming projects

The surfaces map is the project's authoritative inventory of internal surfaces (caches, storage keys, message types, hunters/canaries/probes/mitigations, byte-locked files, test pages). All four quantrix commands consult it before scanning the codebase.

Path: configurable via `plugin.json` → `config.surfacesMapPath` (default: `docs/agent-context/known-surfaces.md`).

## Why this exists

Without a surfaces map, every command burns tokens rediscovering project structure. With it:
- `/sprint` resolves manual AC verification clauses to runnable commands.
- `/qa` Check D (scope) and Check G (cross-AC corroboration) read declared surfaces.
- `/te` interpolates verification commands per step.
- `/ts` Phase B reads the map before dispatching Explore subagents.

The dispatch-Explore-instead cost is ~50-100K tokens per question; the surfaces map answers most of those for ~5K tokens.

## File shape

Markdown. Sections per surface category. Within each section, a table of entries.

```markdown
# <project> known surfaces

Living document. Updated as new surfaces ship. Schema in `quantrix/docs/surfaces-map-spec.md`.

## Caches

| Key | Storage | TTL | Shape | Verification command |
|---|---|---|---|---|
| `honeyllm:scan-cache` | chrome.storage.local | 24h | `{[url]: {verdict, ts, ...}}` | `await chrome.storage.local.get('honeyllm:scan-cache')` |
| `honeyllm:cache-telemetry` | chrome.storage.local | none | `{count, hits, misses, ts}` | `await chrome.storage.local.get('honeyllm:cache-telemetry')` |

## Storage keys

| Key | Storage | Shape | Verification command |
|---|---|---|---|
| `honeyllm:logging-state` | chrome.storage.local | `{connected, heartbeat: {global, perTab}}` | `await chrome.storage.local.get('honeyllm:logging-state')` |
| `honeyllm:last-verdict` | chrome.storage.local | `{verdict, mitigations, ts, url}` | `await chrome.storage.local.get('honeyllm:last-verdict')` |

## Message types

| Type | Sender | Receiver | Payload | Notes |
|---|---|---|---|---|
| `PAGE_SNAPSHOT` | content | service-worker | `{html, url, ...}` | Triggers offscreen create on first call |
| `STATE_QUERY` | harness | service-worker | `{}` | Returns full pipeline state |

## Hunters

| Name | Module | Threshold | Verification |
|---|---|---|---|
| Spider | `src/hunters/spider/` | substring | `npm test -- spider` |
| Hawk | `src/hunters/hawk/` | regex | `npm test -- hawk` |
| Embeddings | `src/hunters/embeddings/` | cosine ≥ 0.85 | `npm test -- embeddings` |

## Canaries

| Name | Module | Engine | Capabilities |
|---|---|---|---|
| Gemma-2-2b | `src/offscreen/canaries/gemma-canary.ts` | MLC WebLLM | text |
| Nano | `src/offscreen/canaries/nano-canary.ts` | Chrome Prompt API | text, image |

## Probes

| Name | Module | Triggered by | Returns |
|---|---|---|---|
| InstructionFollow | `src/probes/instruction-follow/` | dispatcher | `{found, instructions}` |
| ImageInjection | `src/probes/image-injection/` | dispatcher when image | `{found, technique}` |

## Mitigations

| Name | Module | Surface |
|---|---|---|
| InjectionMask | `src/content/mitigations/injection-mask.ts` | DOM |
| FetchOverride | `src/content/main-world-inject.ts` | network |
| RedirectGuard | `src/service-worker/redirect-guard.ts` | webNavigation |

## Test pages

| Path | Purpose | Expected verdict |
|---|---|---|
| `test-pages/clean/sourdough.html` | clean control | CLEAN |
| `test-pages/injected/instruction-overt.html` | overt injection | COMPROMISED |

## Byte-locked files

| Path | Reason | Lock authority |
|---|---|---|
| `docs/testing/inbrowser-results.json` | Phase 2 canonical baseline | CLAUDE.md |
| `scripts/fixtures/phase2-inputs.ts::classifyOutput` (v1) | byte-identity contract | CLAUDE.md |
```

## Required fields per entry

Every entry MUST have:
- **Key/Name** — the identifier referenced by AC and code
- **Verification command** OR **Verification** — concrete way to check the surface's state from the user side (popup, console, file path)

Optional fields per category (Storage / TTL / Shape / Threshold / etc.) populate when meaningful.

## Living document

The map is updated as new surfaces ship. PRs that add a documented surface category (new cache, new storage key, new message type, new hunter/canary/probe/mitigation) MUST update the map in the same PR.

`/qa` Check G (a future addition) gates this: if a PR diff touches a documented surface but doesn't update the map, surface as a CONCERNS finding.

## Schema versioning

This spec is v1. Future schema changes (additional required fields, new categories) bump the version in `plugin.json` and document migration in this file.
