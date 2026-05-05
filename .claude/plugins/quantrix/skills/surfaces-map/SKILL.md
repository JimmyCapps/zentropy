---
name: surfaces-map
description: How all four quantrix commands consult the project's surfaces map to avoid environment-scanning. Read the map BEFORE Grep/Read/Explore for any question about caches, storage keys, message types, hunters, canaries, mitigations, byte-locked files.
type: process
---

# Surfaces map first

Every quantrix command consults the project's surfaces map at `<surfacesMapPath>` (default `docs/agent-context/known-surfaces.md`) before any code Read/Grep or Explore subagent dispatch.

Schema for the map: `quantrix/docs/surfaces-map-spec.md`.

## Why

A typical question like "where does the cache live?" can be answered by:

- **A:** dispatch Explore subagent → 50-100K tokens, multi-second latency, may miss
- **B:** read surfaces map (~5K tokens, deterministic, complete)

Always (B) when the question is about a documented surface category.

## When to read the map

| Command | When to read |
|---|---|
| `/sprint` | Pre-flight, when verifying Manual AC `verify via` clauses cite real keys |
| `/qa` | Always at start (Check D scope authority + Check G cross-AC corroboration) |
| `/te` | At start, to interpolate verification commands per step |
| `/ts` | Phase B entry — BEFORE any Explore subagent |

## When NOT to dispatch Explore

If the question is about:
- A documented cache → read map's "Caches" section
- A storage key → read map's "Storage keys" section
- A message type / IPC payload → read map's "Message types" section
- A hunter / canary / probe / mitigation behavior → read the relevant category section
- A byte-locked file → read map's "Byte-locked files" section
- A test page expected verdict → read map's "Test pages" section

Only dispatch Explore for genuinely cross-cutting research the map doesn't cover (e.g. "find all places that import or call function X" when X isn't catalogued).

## When the map is wrong or stale

If you find the map missing a surface that exists in code, OR the map's claim contradicts the code:

1. Don't silently work around it — note the discrepancy.
2. If you're in `/sprint` or `/ts` Phase C, add the surface map update to the same PR.
3. If you're in `/qa`, surface as a CONCERNS finding (Check G category — "PR touches a documented surface but map not updated" OR "PR adds a new surface not catalogued").

The map IS a source of truth — if it's stale, the right move is to update it, not bypass it.

## Reading pattern (efficient)

When reading for a specific question:

1. **Don't read the whole map** — it can grow large. Read the section that matches the question.
2. **Cite the entry inline** when forming the answer — e.g. "per surfaces-map §Caches, the scan-cache lives in `chrome.storage.local` keyed by URL with 24h TTL".
3. **If the entry is missing**, fall back to Explore — but flag the gap so it can be added later.

## Verification interpolation (used by /te)

When a manual AC says `verify via storage:honeyllm:cache-telemetry`, /te looks up the entry in surfaces map → finds:

| Key | Storage | Verification command |
|---|---|---|
| `honeyllm:cache-telemetry` | chrome.storage.local | `await chrome.storage.local.get('honeyllm:cache-telemetry')` |

Then renders the sub-step with:

```
  Run: await chrome.storage.local.get('honeyllm:cache-telemetry')
```

If the key isn't in the map, /te FAILs with `verify via key '<key>' not found in surfaces map at <path>; amend map or correct AC`.

## The contract

The surfaces map is a **promise** between the project's commits and the agents reading them. Every surface category named in the spec MUST be documented before a sprint item depending on it ships. Updating the map is part of authoring, not a separate task.
