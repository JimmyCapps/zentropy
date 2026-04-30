# Site-Structure Registry — Architecture RFC

**Status:** Stage 1 design lock (2026-04-30 brainstorm) — Stages 2..N feed master plan item 13 sub-sequence
**Plan reference:** `~/.claude/plans/no-scheduling-now-please-valiant-feigenbaum.md` §"Master execution sequence" item 13
**Issue:** [#51](https://github.com/JimmyCapps/zentropy/issues/51) — stays open until SR-A through SR-H ship
**Scope:** Design-only RFC; no production code lands this session

---

## TL;DR

A **server-side site-structure registry** ships pre-computed structural fingerprints of popular sites alongside the extension. On each page visit, the service worker diffs the live DOM against the registry's known-good fingerprint per zone. Zones that match → skip analysis. Zones that diverge → fall through to the existing analyse pipeline. The registry is a **comparison baseline**, never an allowlist; it confirms content is unchanged since server-side analysis, but does not authorise content.

Three things make this defensible:

1. **Static-frame-only coverage.** The registry covers chrome UI, navigation, headers, footers — never user-content zones (post bodies, messages, comments). Per-origin opt-out (#20) still applies in full to content zones.
2. **Bundled distribution.** Registry ships in the extension package; visiting a covered site does not trigger a registry-fetch GET (no per-visit network leak).
3. **Fail-safe.** Missing / stale / unsigned registry → full analysis. The registry only ever **escalates** to the existing analyse path; it cannot cause a false-clean verdict.

Sequenced after item 12 (Phase 8 Sprint B) and runs in parallel with the gated telemetry windows for items 3/4/5. ~9 sessions across 8 work items (SR-A through SR-H).

---

## Scope clarification (load-bearing)

Issue #51 frames the registry as a "scan-cost reduction strategy." That framing is correct but understates the design surface. Three boundary clarifications:

- **Registry vs. allowlist.** An allowlist authorises content unconditionally. The registry only confirms a zone matches its server-side-vetted fingerprint *for this visit*. A divergent fingerprint immediately routes the zone to full analysis — it is not whitelisted away.
- **Registry vs. delta-cache (#6).** #6 caches *per-user, per-page* verdicts ("this user already analysed this page"). The registry caches *cross-user, per-site* fingerprints ("the project has confirmed this scaffolding"). Different scope, different cache key, different invalidation. Both can hit on the same chunk via different paths.
- **Registry vs. Spider (#3).** Spider deterministically crawls from-scratch on the user's machine. The registry presupposes a server-side crawl has already happened. Could feed Spider's trust model ("these zones already deterministically vetted"); does not share storage.

These boundaries are documented in §Q8 below.

---

## Q1. Zones in scope → **Static frame only; user-content excluded**

**Decision.** Registry coverage is restricted to **static frame zones**: chrome UI, navigation, sidebars, headers, footers, settings panels, login UI, page scaffolding. Excluded: any zone whose content originates from another user (email body, message, comment, post, search result, AI assistant response) or from the current user (drafts, composed content).

**Zone selectors.** Each registry entry for a covered site declares an array of `frameZones` and an array of `excludedZones` (CSS selectors). At runtime, the SW extracts the union of `frameZones` minus the union of `excludedZones`, hashes per-zone, and diffs against the registry.

**Greenfield gap.** Per Explore agent finding 2, `PageSnapshot` (`src/types/snapshot.ts:18-25`) is a binary visible/hidden split with no frame segmentation. `parseHtmlToSnapshot()` (`src/offscreen/parse-html.ts:24-37`) labels hidden content but does not isolate frame zones. Zone extraction is **net-new work** scoped under SR-A.

**Why.** The privacy-defensibility argument depends on the registry never observing content. Static-frame-only coverage (a) survives per-origin opt-out (#20) — opted-out origins still benefit from frame-zone skips because their *frame* is not content the user is protecting; (b) keeps the trust model honest — what the registry vouches for is what the registry has actually seen.

**Rejected alternatives.**
- **Whole-page coverage.** Forces the registry to include user-content zones, which (i) breaks privacy (server-side crawler sees content the registry's user has not consented to share), (ii) breaks #20 (opted-out origins lose all skip benefit), (iii) makes fingerprints volatile to legitimate content variation.
- **Heuristic zone classification (treat anything in `<nav>` / `<header>` / `<aside>` as frame).** Brittle: many sites build nav with `<div role="navigation">`; comment threads sit inside `<article>`. Registry-curated selectors per site are deterministic and auditable.

---

## Q2. Fingerprint scheme → **Multi-factor: structural + tokenised + version-hint**

**Decision.** Each zone fingerprint is a tuple `{ structural, tokens, version }`:

- **structural** — SHA-256 of the zone's tag/class skeleton with text content stripped. Captures DOM shape; insensitive to text translation, A/B copy, signed-in-vs-out badge content.
- **tokens** — SHA-256 of a frozen set of *expected text tokens* extracted from the zone (button labels, ARIA labels, role names) hashed against an i18n-canonical lookup. A registry zone may carry multiple acceptable `tokens` hashes (one per locale / chrome variant).
- **version** — opaque server-supplied marker the live page can echo (e.g. `<meta name="x-frame-version">`); not required, used only when the site cooperates.

A zone matches if `structural` is in the registry's known-good set AND `tokens` is in the registry's known-good set AND (if `version` is registered) `version` matches.

**Reuses.** `sha256Hex()` (`src/shared/hash.ts:1-8`) and `createContentHash()` (`src/service-worker/content-hash.ts:12-18`) cover both factors. No new hashing primitive needed — multi-factor is implemented as multiple invocations of existing helpers over different normalised inputs.

**Validation before publishing.** The server-side crawler runs from N≥3 geographic locations and N≥3 chrome variants (signed-out, signed-in-locale-A, signed-in-locale-B). A zone's fingerprint set is published only if the union has ≤K (configurable, default 8) distinct values. Higher diversity → site is too volatile for static-frame coverage; the entry is dropped.

**Why.** Single-hash fingerprints fail two ways: too strict (every locale variation is a "miss") or too loose (any text is acceptable, defeating injection detection). Multi-factor splits the concerns: structural captures injection at the DOM level (an inserted `<script>` or `<div>` shows up); tokens captures injection at the text level (a phishing button label that didn't exist in any locale shows up); version captures cooperative sites that want to opt-in to faster invalidation.

**Rejected alternatives.**
- **Single SHA-256 over zone HTML.** Too strict; trivially invalidates on locale or A/B variation.
- **TF-IDF / semantic embedding fingerprint.** Non-deterministic at the embedding level; conflicts with the "registry as evidence baseline" framing; introduces ML dependencies HoneyLLM's threat model has explicitly avoided.

---

## Q3. Server-side crawler → **Project-operated cloud crawler; daily for top-N, weekly for tail**

**Decision.** The crawler runs as a scheduled GitHub Action (initial home, low ops cost) hitting registered sites from N≥3 geographic locations. Daily cadence for the top-N sites by user count; weekly for the tail. WAF / rate-limit responses (HTTP 429, 403, captcha-page detection) trigger exponential backoff (1d → 2d → 4d, capped at 7d). Persistent failures > 14 days drop the site from the registry **with the entry marked stale**, which routes all visits to that site to full analysis (fail-safe).

**Validation gate.** Per Q2, only zones whose multi-location fingerprint set agrees within the diversity bound get published. This protects against IP-geo-bias (CDN serving different chrome to crawler IP) and against single-location compromise.

**Operational cost.** Top-100 sites at daily cadence × 3 locations × ~5 zones per site × ~10s crawl time ≈ 4 GH-Actions-hours/day. Within free tier; budget-trivial.

**Why.** Project-operated crawler is the simplest trust model — the same maintainer who signs the registry runs the crawler. Community contribution is a v2 question (deferred — see §Deferred). Cloud crawler avoids local-user IP exposure and is easier to scale to N locations.

**Rejected alternatives.**
- **Distributed peer-to-peer crawl (extension users contribute fingerprints).** Defeats the "server-side vetted" promise — a user-submitted fingerprint may originate from a compromised browser. Adds anti-Sybil overhead.
- **CDN-hosted serverless crawler (Cloudflare Workers etc.).** Equivalent ops profile to GitHub Actions for the v1 cadence; deferred until volume justifies migration.

---

## Q4. Distribution model → **Bundled at extension release; v1 fetch-on-demand explicitly excluded**

**Decision.** The registry ships **inside the extension package**. Each weekly Chrome Web Store update carries the latest registry. No runtime fetch of registry data. Visiting a covered site triggers zero network requests beyond what the page already triggers.

**Refresh cadence.** Weekly extension update is acceptable — top sites' static frames change at most a few times per quarter; daily refresh value is marginal vs. the privacy regression of fetch-on-demand.

**Hybrid path deferred.** A signed-bundle-fetch model (extension fetches the registry from a CDN endpoint over HTTPS, verifies signature, caches locally) would deliver fresher data but the GET request itself leaks the visit pattern (`GET /registry/gmail.com` → server learns user uses Gmail). v1 explicitly excludes this. v2 may revisit (see §Deferred).

**Bundle size.** Top-100 sites × ~5 zones × multi-factor fingerprint ~= 100 × 5 × 256B = ~125KB un-compressed; ~50KB gzipped. Negligible against current extension bundle.

**Why.** The privacy property "the registry never reveals which sites a user visits" is one of the project's strongest selling points. Bundled distribution preserves it categorically. The fetch-on-demand path is a *future optimisation* — the project should not commit to it before measuring (a) whether any covered site needs sub-weekly refresh (data we don't have yet), (b) whether per-visit GETs can be made privacy-preserving (oblivious HTTP, etc.).

**Rejected alternatives.**
- **Fetch-on-demand only.** Privacy regression as above.
- **Hybrid (bundled + opportunistic refresh).** Reasonable for v2 but premature; locks in two distribution paths before either is proven.

---

## Q5. Failure mode → **Registry missing / stale / unsigned ⇒ full analysis (enforceable in SW orchestrator)**

**Decision.** The SW orchestrator's registry-skip path is gated by a single positive check: **only** if `(registry.lookup(origin) !== null) AND (signature.verify(entry) === true) AND (entry.expiresAt > now) AND (zone.fingerprint matches entry.zones[i].acceptableFingerprints)` does the orchestrator skip analysis. Any failure routes the chunk to the existing analyse pipeline — which is exactly what runs today.

**Insertion point.** `src/service-worker/orchestrator.ts` (~30KB; the pipeline entry); registry-skip lands as a one-line short-circuit at the start of the per-chunk loop. No existing path is removed; new code is purely additive. Tier-router (`tier-router.ts`), Hunters (Spider/Hawk), probes are unchanged.

**Enforceability.** The "registry is purely an optimisation" property is enforced structurally: there is no code path where a registry-hit *replaces* an analyse-fail verdict. A registry-hit only means "skip analysis for this zone"; the rest of the page is analysed as today. Even if every guard fails simultaneously (catastrophic registry corruption), the worst case is `registry.lookup() returns null` everywhere → 100% of chunks go through full analysis → identical behaviour to today.

**Why.** This is the property that makes the registry sellable — users can trust that adding the registry never makes the extension *less* protective. The fail-safe direction is the only acceptable failure mode for a security tool.

**Rejected alternatives.**
- **Registry-as-blocker (registry stale ⇒ block page).** Wrong direction; would make the registry a denial-of-service vector against the user.
- **Registry-as-stand-in (registry stale ⇒ guess "probably clean").** Defeats the entire purpose; registry stops being evidence and becomes wishful thinking.

---

## Q6. Trust + signing → **Ed25519 via @noble/ed25519; single-maintainer signing key with annual rotation**

**Decision.** The registry artefact is signed with Ed25519 using `@noble/ed25519` (active, audited, zero-dep, browser-native — no Node fallback path needed for SW runtime). The signing key is held by the project maintainer (currently @JimmyCapps) on hardware separate from the build server. Key rotation: new signing key per annual release; old public key valid through a 30-day overlap window.

**Greenfield.** Per Explore agent finding 3, no signing dependency currently exists in `package.json`. `@noble/ed25519` is the smallest credible addition (~5KB minified, browser-native). Web Crypto's Ed25519 is now widely supported but not universal in Chrome's SW runtime; `@noble/ed25519` provides a portable fallback.

**Verification flow.** SW startup → load bundled registry artefact → verify Ed25519 signature against the embedded public key (also bundled — the extension trust root is itself part of the extension binary, signed by the Chrome Web Store's review process). On verification failure → registry is treated as missing → fail-safe to full analysis.

**Revocation.** Two channels:
1. **Per-entry expiry** — every registry entry carries `expiresAt` (default 30d from issue). Expired entries are ignored; the SW falls back to full analysis for that origin until the next extension update.
2. **Emergency revocation** — fast-tracked Chrome Web Store update with the compromised entry removed. Chrome auto-updates extensions; propagation typically <24h.

**Compromise recovery.** If the signing key is exfiltrated: (a) revoke the public key in the next release, (b) push every entry signed by the old key to expired, (c) re-sign with the new key. The 30-day overlap window covers users who haven't auto-updated within 24h.

**Why.** Ed25519 is the modern default; @noble is auditable, single-purpose, and self-contained. Single-maintainer signing matches the project's current scale (one maintainer, no team); multi-sig becomes a v2 question once contributor count justifies it.

**Rejected alternatives.**
- **tweetnacl / TweetNaCl-js.** Older API; @noble is actively maintained and produces smaller bundles.
- **Web Crypto Ed25519.** Browser support inconsistency in SW context (Firefox SW lags); @noble portable fallback removes the variability without measurable cost.
- **Multi-signature / quorum signing.** Premature for current contributor count; adds operational overhead without proportional security gain.

---

## Q7. Privacy — telemetry-free hit-rate → **Mirror existing chrome.storage.local counter pattern**

**Decision.** Hit-rate, miss-rate, and stale-skip counters are recorded in `chrome.storage.local` under a new key `STORAGE_KEY_REGISTRY_TELEMETRY`. The pattern mirrors `STORAGE_KEY_CACHE_TELEMETRY` (`src/service-worker/scan-cache.ts:254-297`) and the response/thinking/composer telemetry shapes from issues #126/#127/#130/#131. Counters bump locally; nothing leaves the device.

**Surfaced where.** Popup UI displays an aggregate "registry skip rate" line; advanced users can `chrome.storage.local.get(STORAGE_KEY_REGISTRY_TELEMETRY)` from the SW devtools console to see per-origin breakdown.

**Per-origin opt-out (#20) composition.** The registry's hit-skip path **does not observe content** — by construction it operates on zone fingerprints, never zone text. Therefore the opt-out preference (which gates content scanning) does not need to gate the registry skip. Opted-out origins still benefit from registry skips on their static frame; they just never had content scanning anyway. The opt-out boundary is documented at the orchestrator entry: `if (originOptedOut) skip everything; else if (registryHit) skip this zone; else analyse`.

**Why.** The chrome.storage.local pattern is already proven across three telemetry surfaces in the codebase. Reusing it means zero new privacy surface; the registry's telemetry is identical in shape to the cache telemetry already shipping.

**Rejected alternatives.**
- **No telemetry at all.** Loses observability into whether the registry is delivering value; first sign of trouble (cache hit rate cratering) is invisible.
- **Phone-home aggregation.** Categorical privacy regression; conflicts with project's no-network-egress promise.

---

## Q8. Composition with #6 (delta-cache) and #3 (Spider)

**Decision.** Three caching primitives compose in a defined order in `orchestrator.analyzeSnapshot()`:

```
For each chunk:
  1. (NEW) Registry zone-skip — cross-user, per-site, per-zone fingerprint hit ⇒ skip
  2. #6 delta-cache lookup — per-user, per-page, content-hash hit ⇒ reuse verdict
  3. Full Hunter + probe analysis (Spider, Hawk, DetermiLLM eventually, then probes)
```

**Boundaries.**
- **Registry vs. #6.** Registry covers static-frame zones (cross-user); #6 covers full-page verdicts (per-user). A signed-out home page benefits from registry only. A logged-in page benefits from registry on its frame and from #6 on its repeat-visit content. No shared cache key — registry indexes by `(origin, zoneId, fingerprint)`; #6 indexes by `(userId, url, contentHash)`.
- **Registry vs. Spider (#3).** Spider deterministically vets content on-device; registry deterministically vets static-frame on-server. Both are deterministic but operate at different ends of the trust pipeline. Registry can *seed* Spider's trust ("these zones already vetted server-side, Spider can mark them clean without re-deriving") but the storage and invalidation paths differ. v2 question: should Spider read registry entries directly? Deferred.
- **#20 per-origin opt-out.** Composes by gating step 2 and step 3 (content-touching steps) per Q7. Registry's step 1 is content-blind and runs regardless.

**Why.** Sequencing cheapest-first means cross-user wins precede per-user wins precede full analysis. Cache key disjointness means registry hits never invalidate #6 entries and vice versa.

---

## Q9. Adversarial robustness → **Stales harmlessly; signing + multi-location validation prevent active misleading**

**Threat model.** Three vectors:

1. **Registered site is compromised** (CDN takeover, supply-chain JS injection, DNS hijack). The attacker injects content into a registered site's static frame *after* the registry crawl has run.
2. **Registry actively misleads** (attacker controls the registry artefact). The attacker forges a fingerprint that matches injected-content state.
3. **Crawler capture** (attacker MitMs the crawler's fetch). The attacker poisons the registry at publication time.

**Defenses.**

- **vs. (1).** Live DOM diverges from the registry fingerprint → registry MISS → orchestrator routes the zone to full analysis → Hunters + probes catch the injection (if the injection is in the user-content zone, it never overlapped with registry coverage to begin with; if it's in the static frame, fingerprint diff catches it). Registry stales harmlessly.
- **vs. (2).** Ed25519 signature verification (Q6) prevents arbitrary registry forgery. The attacker would need to either (a) compromise the signing key (out-of-band attack on the maintainer's hardware), or (b) compromise the Chrome Web Store review pipeline. Both are categorically harder than DOM injection.
- **vs. (3).** Multi-location crawl + diversity gate (Q3) detects single-location MitM — only fingerprints that agree across N≥3 locations get published. A region-targeted CDN compromise that happens to match all N crawler locations is a sophisticated targeted attack; not a generic threat. Mitigated by adding more locations or relocating crawlers periodically.

**Adversarial property.** The registry can never cause a **false-clean** verdict on injected content, only a missed hit. The fail-safe direction (Q5) is structural: any verification failure → full analysis. The worst the attacker can achieve is degrading the registry to "always misses" (DoS on the optimisation), which is identical to today's behaviour (no registry).

**Why.** The structural symmetry "registry only escalates" mirrors the DetermiLLM Hunter's structural symmetry ("Hunters only escalate") — both are designed so the failure mode is a graceful degradation, never a regression.

**Rejected alternatives.**
- **Cryptographic proofs of crawl freshness (transparency log etc.).** Over-engineering for v1 threat model; deferred to v2 if registry coverage grows large enough to justify.

---

## Decision log (rejected branches, summarised)

- **Q1 Static-frame-only (vs. whole-page).** Privacy and #20-composition both demand zones the registry never sees content for.
- **Q2 Multi-factor fingerprint (vs. single SHA / embedding).** Splits structural-injection signal from text-injection signal; deterministic; reuses existing hash primitive.
- **Q3 Project-operated cloud crawler (vs. P2P).** P2P breaks server-side-vetted promise.
- **Q4 Bundled distribution (vs. fetch-on-demand).** Bundled preserves privacy categorically; fetch-on-demand deferred to v2 once OHTTP-style options mature.
- **Q5 Fail-safe to full analysis (vs. block / guess).** Block is DoS; guess is wishful thinking.
- **Q6 Ed25519 / @noble (vs. tweetnacl / Web Crypto).** Active maintenance, smallest bundle, browser-native.
- **Q7 Local-only telemetry (vs. phone-home).** Mirrors three existing telemetry surfaces.
- **Q8 Sequenced primitives (vs. shared cache key).** Disjoint keys preserve invalidation independence.
- **Q9 Multi-location validation (vs. transparency log).** v2 question.
- **Action-authority extension to registered-site verdict (out of scope).** Registry vouches for *unchanged-since-vetting*, not for *content correctness*; any extension to verdict-binding is a different design problem.

---

## Implementation sub-sequence (master plan item 13 expansion)

Each item lists: **scope** | **anchors** | **session estimate** | **gate** | **dependencies**.

### SR-A. Zone-extraction primitive + registry schema — 1 session

- **Scope.** Define `RegistryEntry` TypeScript type (origin, zones, fingerprints, expiresAt, signature). Implement `extractZones(snapshot, frameSelectors, excludedSelectors): ZoneText[]` reusing existing snapshot infrastructure.
- **Anchors.** `src/types/snapshot.ts:18-25` (`PageSnapshot` shape); `src/offscreen/parse-html.ts:24-37` (selector-based segmentation prior art); `src/types/registry.ts` (new).
- **Gate.** Unit tests demonstrate zone extraction is deterministic across signed-in / signed-out / locale-A / locale-B chrome variants for one fixture site (gmail.com or similar).
- **Dependencies.** None.

### SR-B. Multi-factor fingerprint hasher — 1 session

- **Scope.** Implement `fingerprintZone(zoneText, zoneStructure): { structural, tokens, version? }` using existing `sha256Hex()` and `createContentHash()`.
- **Anchors.** `src/shared/hash.ts:1-8` (`sha256Hex`); `src/service-worker/content-hash.ts:12-18` (`createContentHash`); `src/registry/fingerprint.ts` (new).
- **Gate.** Unit tests confirm structural hash is invariant under text translation; tokens hash is invariant under DOM-shape variation; both diverge on injected content.
- **Dependencies.** SR-A.

### SR-C. Server-side crawler MVP (top-10 sites) — 2 sessions

- **Scope.** GitHub Action that crawls top-10 covered sites (gmail, gdocs, twitter/x, slack, notion, linkedin, github, chatgpt, claude.ai, gemini) from N≥3 locations, validates diversity gate (Q2), publishes `registry-unsigned.json` to a build artefact.
- **Anchors.** `.github/workflows/registry-crawl.yml` (new); `scripts/crawl-registry.ts` (new); manual zone-selector authoring per site under `registry/sites/*.json`.
- **Gate.** Crawler completes within 4 GH-Actions-hours; diversity gate rejects ≥1 over-volatile zone (proves the gate works); produced `registry-unsigned.json` validates against the SR-A schema.
- **Dependencies.** SR-A, SR-B.

### SR-D. Ed25519 signing pipeline — 1 session

- **Scope.** Add `@noble/ed25519` dependency. Implement `signRegistry()` (offline tool the maintainer runs locally) and `verifyRegistry()` (in-extension SW). Generate v1 signing keypair; commit public key into the extension source.
- **Anchors.** `package.json` (new dep); `scripts/sign-registry.ts` (new); `src/registry/verify.ts` (new); `src/registry/keys.ts` (public key constant).
- **Gate.** Round-trip: sign `registry-unsigned.json` → `registry.json` → verify in unit test → tamper-test (modify one byte → verification fails).
- **Dependencies.** SR-C.

### SR-E. Bundled distribution — 1 session

- **Scope.** Wire `registry.json` into the extension build (`build.ts`) so it ships in `dist/`. Verify bundle size impact against the ~50KB target.
- **Anchors.** `build.ts` (extend asset-copy step); `manifest.json` `web_accessible_resources` if SW must `getURL()` it.
- **Gate.** Built extension contains `registry.json`; SW can load and verify it on startup; bundle size delta measured and reported in PR body.
- **Dependencies.** SR-D.

### SR-F. SW orchestrator integration — 1 session

- **Scope.** Add registry-skip short-circuit to `analyzeSnapshot()` per Q5/Q8. Compose with #20 opt-out per Q7.
- **Anchors.** `src/service-worker/orchestrator.ts` (per-chunk loop entry); `src/registry/lookup.ts` (new); existing #20 opt-out boundary.
- **Gate.** Phase 2 byte-locked baseline (`docs/testing/inbrowser-results.json`, 162 rows) verdicts unchanged when registry is empty / all-miss. Integration test: registry hit on gmail.com static frame → analyse pipeline skipped → verdict matches today's clean verdict.
- **Dependencies.** SR-A, SR-B, SR-D, SR-E.

### SR-G. Privacy telemetry (local counters) — 1 session

- **Scope.** Implement `STORAGE_KEY_REGISTRY_TELEMETRY` mirroring `STORAGE_KEY_CACHE_TELEMETRY`. Surface aggregate hit/miss/stale counters in popup.
- **Anchors.** `src/service-worker/scan-cache.ts:254-297` (telemetry pattern exemplar); `src/shared/constants.ts` (storage-key constants); `src/popup/` (aggregate display).
- **Gate.** Telemetry persists across SW restarts; popup displays non-zero hit-rate after manual smoke test on a covered site; no network egress observed (DevTools network tab).
- **Dependencies.** SR-F.

### SR-H. Adversarial robustness regression suite + first production release — 1 session

- **Scope.** Add tests demonstrating the Q9 properties: tampered registry → verification fails; expired entry → fail-safe; stale fingerprint (DOM mutation) → registry MISS + full analysis runs. Cut a release with the registry shipping for the first time. Record post-launch hit-rate after one week as a §Drift entry on the master plan.
- **Anchors.** `src/registry/__tests__/adversarial.test.ts` (new); release branch + Chrome Web Store update.
- **Gate.** Full test suite green (existing 1140+ new ~30 registry tests); npm audit clean; manual smoke on gmail.com / chatgpt.com confirms registry hits in production build.
- **Dependencies.** SR-A through SR-G all merged.
- **Refs (eventual):** [#51](https://github.com/JimmyCapps/zentropy/issues/51) closes when SR-H ships.

**Total:** 8 work items, ~9 sessions.

---

## Decisions deferred to v2

- **Fetch-on-demand distribution** (Q4). Reconsider once OHTTP / oblivious HTTP libraries are mature enough to deliver per-visit registry fetches without leaking visit patterns.
- **Hybrid distribution** (Q4). Same gate as fetch-on-demand.
- **Community-contributed crawler nodes** (Q3). Anti-Sybil + signing-key delegation are non-trivial; v1 is single-maintainer.
- **Multi-signature / quorum signing** (Q6). Reconsider when contributor count justifies the operational overhead.
- **Crawler-freshness transparency log** (Q9). Defer until coverage breadth justifies the trust-rooting cost.
- **Spider direct registry consumption** (Q8). Spider's deterministic-vetting pipeline could read registry entries directly; design is open until #3 lands.
- **Per-coding-language packs cross-pollination** (cross-cut with #75). Registry is per-natural-language-locale; #75 is per-programming-language. Sibling tracks; cross-pollination question deferred.
- **ES / zh-CN dialect coverage in registry tokens hash** (Q2 cross-cut with #48). v1 token hash uses i18n-canonical inputs; per-dialect variants are a v2 expansion if observed FPR justifies.
- **Site additions beyond top-10** (SR-C). v1 ships top-10; additions tracked as a recurring sub-issue under #51.

---

## Cross-references

- Master plan item 13 (this doc replaces the placeholder): `~/.claude/plans/no-scheduling-now-please-valiant-feigenbaum.md`
- Issue [#51](https://github.com/JimmyCapps/zentropy/issues/51) — design questions and privacy framing
- Issue [#6](https://github.com/JimmyCapps/zentropy/issues/6) — delta-cache (composes; see Q8)
- Issue [#3](https://github.com/JimmyCapps/zentropy/issues/3) — Spider (composes; see Q8)
- Issue [#20](https://github.com/JimmyCapps/zentropy/issues/20) — per-origin opt-out (composes; see Q7)
- Issue [#48](https://github.com/JimmyCapps/zentropy/issues/48) — Language Detector (registry tokens cross-cut)
- Existing primitives: `src/shared/hash.ts:1-8` (`sha256Hex`); `src/service-worker/content-hash.ts:12-18` (`createContentHash`); `src/service-worker/scan-cache.ts:1-370` (cache + telemetry pattern); `src/service-worker/orchestrator.ts` (insertion point); `src/types/snapshot.ts:18-25` (snapshot shape); `src/offscreen/parse-html.ts:24-37` (selector-based segmentation prior art).
- Greenfield gaps: zone extraction, registry schema, signing dependency, manifest host_permissions (only required for v2 fetch-on-demand path).
- Pattern exemplar: `docs/determillm/ARCHITECTURE.md` — same brainstorm structure mirrored here.
- Project memories: `feedback_branch_pr_issue_workflow.md` (issue → branch → PR), `feedback_auto_merge_after_ci.md` (squash-merge once CI green), `project_offscreen_lazy_load.md` (SW vs. offscreen execution context).
