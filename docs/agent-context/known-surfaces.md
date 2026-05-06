# HoneyLLM internal surfaces map

A reference for Claude Code agents (`/sprint`, `/qa`, `/troubleshoot`) — the project's documented internal surfaces, where they live, and how they behave. Read this BEFORE dispatching `Explore` subagents for read-heavy research; many questions ("where's the cache? where do logs go? what storage keys exist?") are answered here.

> **Status:** manually curated. Future state: hybrid auto + curated, with `BEGIN AUTO` / `END AUTO` zones populated by `scripts/generate-surfaces.ts` from TSDoc `@surface` annotations on declarations. The auto-extraction work lives in the toolkit project at `/Users/node3/Documents/projects/toolkit/DESIGN.md` (M0/M1 deliverable). Until that ships, this doc is curated by hand at PR-time when surfaces are added/changed/removed.
>
> **Maintenance threshold:** add/edit when the surface (a) is something another agent would need to ask "where is X?" about, (b) has a stable identifier (file path, exported function/constant, storage key string), or (c) has non-obvious behaviour (TTL, contract, scope boundary). Skip implementation details internal to a module, things obvious from filename, and temporary/debug instrumentation.

---

## Caches

<!-- BEGIN CURATED · caches -->

### scan-cache *(scope: service-worker)*
IndexedDB scan cache. URL-keyed; cached chunks + verdict + ts. Default 24h TTL. Same-URL revisit reads cache and short-circuits the chunk extract + hunter + canary pipeline.

- **Defined at:** `src/service-worker/scan-cache.ts`
- **Storage:** IndexedDB `honeyllm-scan-cache` DB / `page-scans` object store
- **Key:** full URL (not host-only)
- **Gotcha:** "3 consecutive scans of same URL" without cache-clear = 1 fresh scan + 2 cache hits. To force fresh scans, clear cache via popup → Testing mode → Clear cache, OR delete the IndexedDB store via DevTools → Application → IndexedDB.

### page-scan result cache *(scope: service-worker, related N11)*
Caches verdict + report per origin in `chrome.storage.local` so popup opens fast on revisit. Separate from scan-cache; verdict cache is for popup/UI; scan-cache is for re-scan short-circuit.

- **Defined at:** `src/policy/storage.ts` (verdict persistence)
- **Storage key:** `honeyllm:verdict:<origin>` (per-origin)

### MLC model cache *(scope: offscreen, in-memory)*
WebLLM keeps the loaded canary model resident across scans. Recreating the offscreen doc destroys this cache; extension reload triggers offscreen-doc re-creation on next page load.

- **Lifecycle:** offscreen doc is **lazy** — created on first PAGE_SNAPSHOT after reload, not eagerly. Per project memory `project_offscreen_lazy_load`.

### transformers.js model cache *(scope: offscreen, IndexedDB)*
Embeddings + NER + (future) language detection models cache via transformers.js's built-in IndexedDB store. First load downloads from CDN; subsequent loads are fast.

- **Models loaded:** `intfloat/multilingual-e5-small` (#129 embeddings), NER model (#156)
- **Storage:** transformers.js's `transformers-cache` IndexedDB DB

<!-- END CURATED · caches -->

---

## Logging

<!-- BEGIN CURATED · logging -->

### Log viewer (in-extension UI) *(scope: log-viewer)*
Live tail of structured log events from SW + offscreen + content. The canonical surface for inspecting agent activity during manual testing.

- **URL:** `chrome-extension://immjocpajnooomnmdgecldcfimembndj/dist/log-viewer/log-viewer.html` (extension ID per project memory `project_chrome_extension_id`)
- **Defined at:** `src/log-viewer/log-viewer.ts` + `src/log-viewer/log-viewer.html`
- **Source pipeline:** `src/shared/log-bus.ts` (the LogBus) + `src/log-viewer/file-writer.ts` (per-session jsonl persistence)
- **Heartbeat:** opt-in via storage flag (see Storage keys §`honeyllm:logging-state`)

### Content → SW logging via Port (issue #236) *(scope: content + service-worker)*
**INVARIANT:** content-side logging uses `chrome.runtime.connect({name: LOG_PORT_NAME}) + port.postMessage(...)`, NOT `chrome.runtime.sendMessage(...).catch(...)`. Pre-fix on Officeworks: 266k closure leak + 160k V8 contexts. Post-fix at 9.5h: -4.49% edges. NEVER use `sendMessage` for periodic content-side telemetry.

- **Defined at:** `src/content/index.ts` (sink), `src/shared/log-bus.ts` (Port end)
- **Sink no-ops when `viewerConnected = false`:** SW broadcasts `SET_LOGGING_STATE` on log-viewer Port connect/disconnect; production has the viewer closed, sink is inert. Per project memory `project_content_logging_port_pattern`.

### Per-session jsonl files *(scope: log-viewer/file-writer)*
File writer persists a stream of LogEvents to disk per session, per page. Used by `/troubleshoot` to read post-hoc what each hunter/probe scored.

- **Defined at:** `src/log-viewer/file-writer.ts` (#222/#223), periodic flush from #225
- **Output:** `docs/logs/<session-id>/<page-slug>.jsonl` (untracked; gitignored)
- **Schema:** discriminated union `LogEvent` in `src/types/messages.ts`

### Diagnostic heartbeat (#224) *(scope: content)*
Live memory monitor (usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit, DOM node count, body children count, deltas per tick). Fires every 5s by default, logs to SW console. Used during the #217 Officeworks leak investigation.

- **Defined at:** `src/content/diagnostic-heartbeat.ts`
- **Trigger:** opt-in via `chrome.storage.local['honeyllm:logging-state'].heartbeat`

### Debug-level toggle (#280) *(scope: shared, applied at SW + offscreen + content)*
Logger source-side `minLevel` is hard-coded to `'info'` so #226 structured `hunter_run:` / `chunk_created` / `probe_run` / `verdict_emitted` events at `level='debug'` are dropped before reaching the LogBus. The bootstrap reads `chrome.storage.local['honeyllm:log-level']` at each entry-point init and registers a `chrome.storage.onChanged` listener so toggling debug capture does NOT require an extension reload.

- **Defined at:** `src/shared/log-level-bootstrap.ts`
- **Invoked at:** `src/service-worker/index.ts`, `src/offscreen/index.ts`, `src/content/index.ts` (immediately after `setLogSink`)
- **Toggle:** `chrome.storage.local.set({'honeyllm:log-level': 'debug'})` from any DevTools console (SW preferred); `chrome.storage.local.remove('honeyllm:log-level')` to revert. Default unset = `'info'`.

<!-- END CURATED · logging -->

---

## Hunters

<!-- BEGIN CURATED · hunters -->

The hunter tier runs deterministic detection in front of the LLM canary. Verdicts stack via k-of-N voting at `tier-router.ts:27`. Hunter tests live on the 23-page `test-pages/` corpus, NOT the 1250-corpus (per project memory `project_hunter_corpus_split`).

### Spider — regex hunter *(scope: shared, runs in service-worker)*
Deterministic pattern/signature matching. Catches known injection shapes instantly. Near-zero compute.

- **Defined at:** `src/hunters/spider/`
- **Score on match:** `SCORE_INSTRUCTION_DETECTION = 40` (in `src/shared/constants.ts`)

### Hawk — dialect classifier hunter *(scope: shared)*
Aggregated entity-type + dialect-pattern classifier. Catches commerce/retail/promotional shape collisions and dialect-specific patterns.

- **Defined at:** `src/hunters/hawk/`
- **Language router:** `src/hunters/hawk/language-router.ts:33` (currently graceful-fallback stub; full xlm-roberta integration tracked in #119)

### Embeddings — semantic similarity hunter *(scope: shared, requires offscreen doc)*
Vector-index match against curated injection corpus. transformers.js + `intfloat/multilingual-e5-small`. EN + ES + zh-CN coverage.

- **Defined at:** `src/hunters/embeddings/`
- **Threshold:** `EMBEDDING_COSINE_THRESHOLD = 0.85` in `vector-index.ts`
- **Corpus:** `data/injection-corpus.json` (regenerate via `npm run embed:corpus`)
- **Pre-warm:** offscreen doc pre-warms the embedding model alongside NER on creation

### DetermiLLM — pack-runtime hunter *(planned: Sprint 4 §4.1, issue #244)*
Dialect-aware pattern hunter wired as the 4th hunter. Stub initially; pack content (DM-B/C/D) authored in DetermiLLM phase. Hard gate: 0 changed verdicts on Phase 2 byte-locked baseline when packs empty.

- **Will be defined at:** `src/hunters/determillm/{index.ts, pack-runtime.ts}`
- **Pack format:** `packs/dialect-en.json`, `packs/dialect-es.json`, `packs/dialect-zh-CN.json`
- **Schema:** `packs/schema.json`

### Tier-router orchestration *(scope: service-worker)*
k-of-N voting + early-exit per HuntReport. Decides whether the LLM canary runs or hunters short-circuit to a verdict.

- **Defined at:** `src/service-worker/tier-router.ts:27`
- **Coordinator helpers:** evidence-packet probes (#118), early-exit (#145), language detection (#119) — all shipped Sprint pre-history

<!-- END CURATED · hunters -->

---

## Canaries

<!-- BEGIN CURATED · canaries -->

The canary tier is the LLM that runs probes against suspect chunks. Capability-gated dispatch via `requiredCapabilities` on the Probe interface (Phase 4G.1). Catalog at `src/shared/constants.ts` `CANARY_CATALOG`.

### Gemma-2-2b *(scope: offscreen, default canary, WebGPU MLC)*
Default canary. Runs locally via MLC WebLLM on WebGPU. Capabilities: `['text_input']`.

- **Adapter:** `src/offscreen/canaries/gemma-canary.ts` (or wherever the engine adapter lives)
- **Engine:** WebLLM via `@mlc-ai/web-llm`
- **Phase 2 byte-locked baseline** (`docs/testing/inbrowser-results.json`) is anchored on Gemma's outputs.

### Gemini Nano *(scope: offscreen, EPP-enrolled Chrome only)*
Chrome's built-in `LanguageModel` API. Capabilities: `['text_input', 'image_input']`. Multimodal ready (image probe #9 4G.3 dispatches via Nano).

- **Adapter:** `src/offscreen/canaries/nano-canary.ts`
- **Debug surface:** `chrome://on-device-internals/` → Event Logs tab (per CLAUDE.md)
- **Multimodal plumbing:** image bytes via `LanguageModel.create({expectedInputs: [{type: 'image'}]})` — pending 4G.5 USER smoke

### Wolf — Llama-3.2-1B *(planned: Sprint 4-6, issue #3)*
Third canary. Strength = over-refusal (Phase 3 Track A §4: 9/9 refusals on clean inputs). Refusal-as-detection signal at `SCORE_WOLF_REFUSAL = 30`. Default canary stays Gemma; Wolf only fires when explicitly selected.

- **Will be defined at:** `src/offscreen/canaries/wolf-canary.ts`
- **Catalog:** add `'llama-3.2-1b-mlc'` to `CANARY_CATALOG` with capabilities `['text_input']`
- **Refusal analyzer:** `src/analysis/wolf-refusal-analyzer.ts` (planned)

<!-- END CURATED · canaries -->

---

## Mitigations

<!-- BEGIN CURATED · mitigations -->

### apply-mitigations lifecycle dispatcher *(scope: content, issue #220 / PR #221)*
Receives verdict + previous mitigationsApplied; activates network-guard + redirect-blocker on COMPROMISED; deactivates both on downgrade to CLEAN/SUSPICIOUS/UNKNOWN. Lifecycle correctness pinned by 12-case test suite.

- **Defined at:** `src/content/apply-mitigations.ts`
- **Tests:** `src/content/apply-mitigations.test.ts`
- **Wire-up:** `src/content/index.ts` (extracted in PR #221)

### network-guard *(scope: content + main-world-inject)*
Wraps `window.fetch` and `XMLHttpRequest.prototype.open`; blocks outbound requests to a known-bad blocklist when COMPROMISED verdict reached.

- **Defined at:** `src/content/mitigation/network-guard.ts`
- **Main-world injection:** `src/content/main-world-inject.ts` (must run before page scripts; manifest `world: "MAIN"` declaration)
- **Deactivator:** `deactivateNetworkGuard()` — idempotent (active-flag guard)

### redirect-blocker *(scope: content)*
`beforeunload` listener; prevents navigation away from a COMPROMISED page without explicit user dismissal.

- **Defined at:** `src/content/mitigation/redirect-blocker.ts`
- **Deactivator:** `deactivateRedirectBlocker()` — idempotent (postMessage setter)

### DOM sanitize *(scope: content)*
Removes suspicious nodes (e.g. hidden-div injections) from the page when COMPROMISED. Returns count of sanitized nodes via `dom_sanitized:N` in `mitigationsApplied`.

- **Defined at:** `src/content/mitigation/sanitize-suspicious.ts` (path may vary)
- **Counter surface:** `mitigationsApplied: ['dom_sanitized:N', ...]`

<!-- END CURATED · mitigations -->

---

## Storage keys

<!-- BEGIN CURATED · storage-keys -->

All `chrome.storage.local` keys use the `honeyllm:` prefix. Privacy contract: IDs and hashes only — NO excerpt text, NO raw user content, NO secrets.

| Key | Shape | Defined / referenced |
|---|---|---|
| `honeyllm:scan-cache` | (IndexedDB DB, not chrome.storage) URL → {chunks, verdict, ts} | `src/service-worker/scan-cache.ts` |
| `honeyllm:verdict:<origin>` | per-origin SecurityVerdict | `src/policy/storage.ts` |
| `honeyllm:cache-telemetry` | #127 telemetry counters | `src/service-worker/scan-cache.ts` |
| `honeyllm:response-telemetry` | #126 portal response inspection counters | `src/content/portals/` |
| `honeyllm:intercept-overrides` | #130 user override events | `src/content/portals/` |
| `honeyllm:pending-intercept` | #130 pending decisions | same |
| `honeyllm:thinking-telemetry` | #131 thinking-block inspection counters | `src/content/portals/` |
| `honeyllm:registry` | signed site-structure registry bundle (SR-D/E) | `src/registry/lookup.ts` |
| `honeyllm:registry-telemetry` | SR-G hit/miss/verifyFailure counters | `src/registry/telemetry.ts` |
| `honeyllm:logging-state` | `{connected, heartbeat: {global, perTab: {[tabId]: bool}}}` (#236) | `src/content/index.ts`, `src/log-viewer/log-viewer.ts` |
| `honeyllm:log-level` | `'debug' \| 'info' \| 'warn' \| 'error'` (#280) — runtime logger threshold; absent = `'info'` default | `src/shared/log-level-bootstrap.ts` |
| `honeyllm:install-secret` | Ed25519 install secret (per-install) | `src/service-worker/install-secret.ts` |
| `honeyllm:pack-match-telemetry` | (planned DM-E #245) `{patternId, chunkId, language, score, ts}` | TBD `src/hunters/determillm/` |
| `honeyllm:isolate-preferences` | (planned #132) per-origin always-isolate flags | TBD |
| `honeyllm:agentic-telemetry` | (planned #5) gated-action log | TBD |
| `honeyllm:chat:<conversation-id>` | (planned #4) chat history | TBD `src/chat/` |

<!-- END CURATED · storage-keys -->

---

## Message types

<!-- BEGIN CURATED · message-types -->

Cross-context messaging uses a discriminated union `LogEvent` in `src/types/messages.ts` (extended by #218, #222, #226). Major message types:

| Type | Sender → Receiver | Purpose |
|---|---|---|
| `PAGE_SNAPSHOT` | content → SW | Snapshot of extracted DOM + metadata; triggers analysis |
| `VERDICT` | SW → content | Verdict + report + mitigationsApplied; content applies mitigations |
| `LOG_EVENT` (chunk_created, hunter_run, probe_selected, probe_run, verdict_emitted) | any → log-viewer (via Port) | Structured log entries (#226) |
| `EMBED_TEXT` / `EMBED_RESULT` | SW ↔ offscreen | Embeddings hunter delegate (#199-#200) |
| `SET_LOGGING_STATE` | log-viewer → SW (broadcast) | Gates content-side log sink (#236) |
| `STATE_QUERY` (planned, #227) | harness/devtools → SW | Read loadedCanary, mitigations, lastVerdict, telemetryCounters |
| `RESCAN` | popup → SW | User-triggered re-analysis (#114) |
| `TESTING_MODE_TOGGLE` | popup → SW | Override verdict for testing (#113) |
| `ISOLATE_PAGE` (planned, #132) | popup → SW | Open URL in incognito sandbox |

**Port-based channels** (long-lived, not sendMessage): LogBus (`src/shared/log-bus.ts`, #218/#236).

<!-- END CURATED · message-types -->

---

## Test pages + fixtures

<!-- BEGIN CURATED · test-pages -->

Canonical fixture directory: `test-pages/` at repo root. Manifest at `test-pages/manifest.json` lists all pages with expected verdicts.

| Path | Purpose |
|---|---|
| `test-pages/injected/` | Known prompt-injection fixtures (instruction-overt, hidden-div, etc.) |
| `test-pages/clean/` | False-positive controls + benign fixtures + regression pages (e.g. `marketplace-homepage.html` for #232) |
| `test-pages/injected-images/` | Multimodal attack fixtures (4G.4): `text-overlay.html`, `qr-injection.html`, `invisible-text.html`, `exif-injection.html`, `composition.html` |
| `test-pages/manifest.json` | Fixture registry — schema includes URL, expected verdict, falsePositiveRisk flag, technique enum (for image fixtures) |

The 23-page `test-pages/` corpus is the **Spider/Hawk evaluation set**. The 1250-corpus is DetermiLLM evaluation infrastructure (deferred, separate). Per project memory `project_hunter_corpus_split` — don't conflate.

**Fixture host:** `https://fixtures.host-things.online/test-pages/` mirrors the local `test-pages/` for B5 manual leg testing. Per project memory `project_test_infra_status`, this is provisioned and operational.

<!-- END CURATED · test-pages -->

---

## Probes

<!-- BEGIN CURATED · probes -->

Probes are LLM-canary-driven detection passes. Capability-gated via `Probe.requiredCapabilities` (since Phase 4G.1). Existing probes in `FULL_STACK_PROBES`:

| Probe | File | Score on hit | Capabilities |
|---|---|---|---|
| `instruction_detection` | `src/probes/instruction-detection.ts` | 40 | `['text_input']` |
| `adversarial_compliance` | `src/probes/adversarial-compliance.ts` | 65 (COMPROMISED-class) | `['text_input']` |
| `summarization` | `src/probes/summarization.ts` | (signal not score) | `['text_input']` |
| `evidence_review` | `src/probes/evidence-review.ts` (Phase 5 N12 #118) | 65 | `['text_input']` |
| `image_injection` | `src/probes/image-injection.ts` (#205, 4G.3) | 20 (conservative; SUSPICIOUS in isolation) | `['image_input']` (Nano-only) |

**Classifier versions** (per CLAUDE.md):
- `classifyOutput` (v1) — substring-based, byte-locked against 162 Phase 2 rows
- `classifyOutputV2` — JSON-aware, used by Phase 4+ runners
- `classifyOutputV3` — refusal-with-quoted-URL detection (#83 closed)

**Score constants** (`src/shared/constants.ts`):
- `THRESHOLD_SUSPICIOUS = 30`
- `THRESHOLD_COMPROMISED = 65`
- `SCORE_INSTRUCTION_DETECTION = 40`
- `SCORE_HIDDEN_CONTENT_INSTRUCTIONS = 20`
- `SCORE_IMAGE_INJECTION = 20`
- `SCORE_EXFIL_ENTITY_CONFIRMED` (issue #122)
- `SCORE_WOLF_REFUSAL = 30` (planned, Sprint 5 #3)

<!-- END CURATED · probes -->

---

## Byte-locked / contract files

<!-- BEGIN CURATED · byte-locked -->

Files that must NEVER be modified casually. Per CLAUDE.md "Domain-specific invariants" + project memories.

| File | Reason | Enforcement |
|---|---|---|
| `docs/testing/inbrowser-results.json` | Phase 2 canonical baseline (162 rows). Cross-phase delta comparison depends on byte-identity. | `/qa` Check E gates this; manual review for any PR that touches it |
| `scripts/fixtures/phase2-inputs.ts` (v1 classifier `classifyOutput` only) | Byte-identity contract with 162 baseline rows. v2 classifier and other functions in same file CAN be modified. | Test at `phase2-inputs.test.ts:57` enforces byte-identity of v1 output |
| `src/registry/keys.ts` `REGISTRY_PUBLIC_KEY_HEX` | Bundled trust root. Rotation requires regenerating + signing the bundle (SR-D/SR-H regression-safety asserts will fail-loud if drift). | SR-H tests in `build-assets.test.ts` |

Migration scripts that intentionally re-baseline operate on `inbrowser-results-affected.json` and `inbrowser-results-affected-replicates.json`, never the canonical file.

<!-- END CURATED · byte-locked -->

---

## Project references

<!-- BEGIN CURATED · project-refs -->

Quick references for agents working on the v0.1 → v1.0 plan:

| Surface | Pointer |
|---|---|
| Plan doc | `docs/plans/v0.1-completion.md` |
| Sprint files | `docs/plans/sprints/sprint-{1..12}-*.md` |
| Sprint README | `docs/plans/sprints/README.md` |
| Project board (canonical) | <https://github.com/users/JimmyCapps/projects/1> |
| Project board (linked to repo) | <https://github.com/JimmyCapps/zentropy/projects> |
| Epic tracking issue | #248 (do NOT close-from-PR; reference via `Refs #248`) |
| Long-running umbrella | #2 Phase 3 Track B (do NOT close-from-PR; reference via `Refs #2`) |
| Setup script | `scripts/setup-project.sh` (re-runnable; rebuilds project board from seed table) |
| Chrome extension ID (stable unpacked) | `immjocpajnooomnmdgecldcfimembndj` |
| Fixture host | `https://fixtures.host-things.online/test-pages/` |
| Toolkit project (future agent toolkit) | `/Users/node3/Documents/projects/toolkit/DESIGN.md` |
| Architecture deep-dive | `docs/ARCHITECTURE.md` |

<!-- END CURATED · project-refs -->

---

## AC verify-via keys (manual-AC surfaces)

<!-- BEGIN CURATED · ac-verify-keys -->

Cross-cutting surfaces cited by `Manual AC` `[manual] · ... · verify via <key>` clauses (per quantrix v0.2.0 ac-template). When `/quantrix:guide` walks a manual-test companion, it interpolates each key against this section to know *where to look*.

### Popup surfaces

| Key | Surface | Defined / referenced |
|---|---|---|
| `popup:verdict` | Headline verdict block in popup main view (CLEAN/SUSPICIOUS/COMPROMISED + score) | `src/popup/popup.html` `#verdict-summary` |
| `popup:accordion-image-injection` | `<details id="accordion-image-injection">` — image-injection probe findings (#9 4G.6a) | `src/popup/popup.html`, `src/popup/image-injection-findings.ts` |
| `popup:accordion-embeddings` | `<details id="accordion-embeddings">` — embeddings hunter rows (#129) | `src/popup/embeddings-findings.ts` |
| `popup:accordion-hunters` | `<details id="accordion-hunters">` — Spider/Hawk/embeddings/DetermiLLM rows + per-hunter scores | `src/popup/hunter-findings.ts` |
| `popup:accordion-canary` | `<details id="accordion-canary">` — selected canary engine + Wolf-refusal rows (#3) | `src/popup/canary-findings.ts` |
| `popup:accordion-mitigations` | `<details id="accordion-mitigations">` — active mitigation badges (network-guard, redirect-blocker, dom_sanitized) | `src/popup/mitigation-status.ts` |
| `popup:accordion-cache` | `<details id="accordion-cache">` — scan-cache stats (entries, size, TTL, hit rate) + dynamically-rendered "Clear cache" button inside `#cache-body`. Cache-clear is the canonical force-fresh-scan surface; required for any "N consecutive cache-cleared scans" Manual AC. | `src/popup/popup.html` `#accordion-cache` / `#cache-body`, `src/popup/popup.ts:538` `initCacheAccordion` |
| `popup:accordion-protectai` | `<details id="accordion-protectai">` — ProtectAI confirmer findings (#128, conditional on ship) | TBD `src/popup/` |
| `popup:accordion-agentic` | `<details id="accordion-agentic">` — agentic task results + verdict-gate violations (#5) | TBD `src/popup/` |
| `popup:byok-settings` | `<section id="byok-settings">` — BYOK provider keys + model selectors + per-origin policy editor (#19) | TBD `src/popup/byok-settings.ts` |
| `popup:chat-tab` | `<section id="chat-tab">` — local LLM chat surface (#4) | TBD `src/popup/chat-tab.ts` |
| `popup:isolate-button` | `<button id="isolate-this-page">` — manual one-click isolate trigger (#132) | TBD `src/popup/popup.html` |

### Browser-level surfaces

| Key | Surface | How to access |
|---|---|---|
| `browser:task-manager` | Chrome's per-process memory + CPU view; row matching the tab renderer's PID. Used for #217 Officeworks bound check + leak diagnostics. | `Window` → `Task Manager` (Chrome menu). |
| `browser:devtools-storage` | DevTools → Application → IndexedDB / chrome.storage panels for verifying privacy contracts (no PII in telemetry keys, BYOK keys NOT in `chrome.storage.local`/`sync`). | F12 → Application tab. |
| `browser:devtools-cookies` | DevTools → Application → Cookies panel for verifying isolate-mode containment (#132). | F12 → Application → Cookies. |
| `browser:devtools-network` | DevTools → Network tab for verifying chat (#4) makes no remote calls + observing dynamic-page request cascade (#217). | F12 → Network. |
| `browser:gpu-page` | `chrome://gpu/` — WebGPU rasterization + hardware acceleration check for #8 compat audit. | URL bar. |
| `browser:on-device-internals` | `chrome://on-device-internals/` — Gemini Nano availability + Event Logs (canonical Nano debug surface per CLAUDE.md). | EPP-enrolled Chrome only. |

### Console surfaces

| Key | Surface | How to access |
|---|---|---|
| `service-worker:console` | Service-worker DevTools — primary surface for storage reads (`chrome.storage.local.get(...)`), state queries, and SW-side log lines. Use this **not** the offscreen inspector for storage state per project memory `project_offscreen_lazy_load`. | `chrome://extensions/` → HoneyLLM → "Inspect views: service worker". |
| `offscreen:console` | Offscreen-document DevTools — engine init, canary-side log lines, refusal text inspection. Lazy: only available after first `PAGE_SNAPSHOT` post-reload. | `chrome://extensions/` → HoneyLLM → "Inspect views: offscreen document" (after first scan). |

### Harness surfaces

| Key | Surface | Defined / referenced |
|---|---|---|
| `harness:state-query` | `chrome.runtime.sendMessage({type: 'STATE_QUERY'})` returns `{loadedCanary, activeMitigations, lastVerdict, telemetryCounters: {cache, response, intercept, thinking, packMatch, registry}}` (#227) | `src/service-worker/index.ts` STATE_QUERY handler |
| `harness:nano-image-harness` | `chrome-extension://immjocpajnooomnmdgecldcfimembndj/dist/test-pages/phase4/nano-image-harness.html` — multimodal sweep harness UI (#9 4G.5) | `test-pages/phase4/nano-image-harness.html` |
| `harness:nano-replicates` | `chrome-extension://immjocpajnooomnmdgecldcfimembndj/dist/test-pages/phase4/nano-harness.html` — replicate-sampling harness UI (#14) | `test-pages/phase4/nano-harness.html` |

### Storage-key shells (privacy-contract surfaces)

When a Manual AC says `verify via <storage-key>`, run the corresponding `chrome.storage.local.get('<key>')` from `service-worker:console` and inspect the shape. The full key catalogue is in §Storage keys above; the most-cited keys for manual gates:

| Key | Used by Manual AC for | Privacy contract |
|---|---|---|
| `honeyllm:verdict:<origin>` | Per-origin verdict assertion (#217, #244, etc.) | Public-safe; no excerpt text |
| `honeyllm:pack-match-telemetry` | DetermiLLM telemetry privacy gate (#245) | IDs ONLY — no `text` / `excerpt` / `chunk` keys |
| `honeyllm:agentic-telemetry` | Agentic verdict-gate violation log (#5) | IDs + decisions; no PII |
| `honeyllm:isolate-preferences` | Per-origin always-isolate flag round-trip (#132) | per-origin flags only |
| `honeyllm:chat:<conversation-id>` | Chat history persistence + cap + clear (#4) | local-only; no sync |
| `honeyllm:agentic-results:<task-id>` | Agentic task summary (#5) | local-only |

<!-- END CURATED · ac-verify-keys -->

---

## Slash command integration

Each slash command consults this map differently:

- **`/sprint <N.M>`** — references the map for context when the kickoff prompt mentions a surface. Doesn't read it eagerly; spot-references on demand.
- **`/qa <PR#>`** — Check D (scope creep) uses the map as the authoritative scope boundary: "files touched outside the surfaces this issue's scope implicates." Future Check G (toolkit M0) will gate map currency.
- **`/troubleshoot [<N.M>]`** — Phase A reads this map as part of context loading on the first investigation move. Phase B's "ask before hunting" rule references the map: don't dispatch `Explore` for questions answerable here. Save the subagent for genuinely novel cross-cutting research.

## Reference

- **CLAUDE.md** — project-level context (high-level pointer map; this surfaces map is the deeper reference)
- **`docs/ARCHITECTURE.md`** — execution-context diagrams + per-module breakdown
- **Toolkit DESIGN.md** — `/Users/node3/Documents/projects/toolkit/DESIGN.md` — annotation schema for the future auto-extraction work
- **Project memory** — `~/.claude/projects/-Users-node3-Documents-projects-HoneyLLM/memory/` — feedback rules + project-specific facts
