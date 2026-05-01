// Phase 4 Stage 4D — canary catalog for the dual-path architecture.
//
// Each canary entry describes a runnable model: its id, display name, engine
// transport (the mechanism used to invoke it), and capability set (what
// input modalities it accepts). The offscreen/engine.ts selector chooses
// which canary to load based on the user's STORAGE_KEY_CANARY preference and
// runtime availability. When a user-selected canary is unavailable the
// selector walks FALLBACK_ORDER until it finds one that works.
//
// This catalog is the source of truth. Popup UI, engine selector, verdict
// payload's canaryId field, and the Stage 4G capability-registration
// framework all consume it.
//
// Primary canary ('gemma-2-2b-mlc') matches the Phase 3 Track A §7 Q6 SHIP
// decision. Nano is opt-in and availability-gated (EPP enrollment required;
// see docs/testing/phase3/NANO_BASELINE_ADDENDUM.md §4).

export type CanaryId =
  | 'gemma-2-2b-mlc'
  | 'chrome-builtin-gemini-nano'
  | 'qwen2.5-0.5b-mlc'
  | 'auto';

export type EngineTransport =
  | 'mlc-webllm-webgpu'    // offscreen document via @mlc-ai/web-llm
  | 'chrome-prompt-api';   // SW-managed hidden tab via window.LanguageModel

export type CanaryCapability =
  | 'text_input'
  | 'image_input';

export interface CanaryDefinition {
  readonly id: CanaryId;
  readonly displayName: string;
  readonly engineTransport: EngineTransport;
  /**
   * Model id as passed to the transport. For MLC this is the WebLLM
   * model id; for the Prompt API this is the Nano sentinel (the API
   * selects the model itself).
   */
  readonly transportModelId: string;
  readonly capabilities: readonly CanaryCapability[];
  /**
   * True if this canary requires Early Preview Program enrollment or
   * similar out-of-band access grant. Used by the popup to explain
   * availability-gated state to the user.
   */
  readonly requiresEnrollment: boolean;
  readonly minChromeVersion: number;
  /**
   * Issue #25 — total context window in tokens (input + output) advertised
   * by the canary. Used by `effectiveChunkTokenBudget()` to size chunk
   * splits per-canary instead of capping every canary at Gemma's 4096.
   */
  readonly contextWindow: number;
}

export const CANARY_CATALOG: Readonly<Record<Exclude<CanaryId, 'auto'>, CanaryDefinition>> = {
  'gemma-2-2b-mlc': {
    id: 'gemma-2-2b-mlc',
    displayName: 'Gemma 2 (2B)',
    engineTransport: 'mlc-webllm-webgpu',
    transportModelId: 'gemma-2-2b-it-q4f16_1-MLC',
    capabilities: ['text_input'],
    requiresEnrollment: false,
    minChromeVersion: 113,
    contextWindow: 4096,
  },
  'chrome-builtin-gemini-nano': {
    id: 'chrome-builtin-gemini-nano',
    displayName: 'Gemini Nano (built-in)',
    engineTransport: 'chrome-prompt-api',
    transportModelId: 'chrome-builtin-gemini-nano',
    // Nano supports image inputs via expectedInputs, but the capability is
    // enabled per-session; Stage 4G registers 'image_input' conditionally
    // when the image probe is active. Keep declared at the catalog level.
    capabilities: ['text_input', 'image_input'],
    requiresEnrollment: true,
    minChromeVersion: 127,
    // Chrome 127+ Prompt API exposes ~4k tokens of effective context.
    contextWindow: 4096,
  },
  'qwen2.5-0.5b-mlc': {
    id: 'qwen2.5-0.5b-mlc',
    displayName: 'Qwen 2.5 (0.5B, fast-path fallback)',
    engineTransport: 'mlc-webllm-webgpu',
    transportModelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    capabilities: ['text_input'],
    requiresEnrollment: false,
    minChromeVersion: 113,
    contextWindow: 32_768,
  },
};

/**
 * Ordered fallback chain used by the engine selector when the user's
 * preferred canary is 'auto' or when the selected one becomes unavailable.
 * Order: Nano first (fastest inference when available) → Gemma (Phase 3
 * SHIP primary) → Qwen (fast-path last-resort per Track A §7 Q5).
 */
export const CANARY_FALLBACK_ORDER: readonly Exclude<CanaryId, 'auto'>[] = [
  'chrome-builtin-gemini-nano',
  'gemma-2-2b-mlc',
  'qwen2.5-0.5b-mlc',
];

/**
 * Default canary when no user selection is persisted. Matches the Phase 3
 * Track A SHIP decision. 'auto' is preferred over a specific id to trigger
 * runtime availability detection.
 */
export const DEFAULT_CANARY_ID: CanaryId = 'auto';

// Legacy single-model constants, kept for back-compat while 4D.3 (engine
// selector integration) is in flight. After 4D.3 these become unused and
// can be removed; they exist now so intermediate commits compile.
export const MODEL_PRIMARY = 'gemma-2-2b-it-q4f16_1-MLC';
export const MODEL_FALLBACK = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

// Phase 4F interim fix (issue #10) — Gemma 2 2B has a 4096-token context
// window. Live probes ran `Prompt tokens exceed context window size: 4749`
// on Wikipedia-length prose with MAX_CHUNK_CHARS=14000. Gemma's tokenizer is
// pessimistic relative to the APPROX_CHARS_PER_TOKEN=4 heuristic — empirical
// tokenisation of English prose ran closer to 3.3–3.5 chars/token, not 4.
// Plus the wrapper prompt (system + probe scaffolding) consumes ~600 tokens
// of the 4096-token budget before the chunk even lands.
//
// Dropping to 11000 chars gives us ~3100–3300 prompt tokens under realistic
// tokenisation, leaving ~600–1000 tokens of headroom for the system prompt
// and response generation. Nano (used in EPP Chrome) has smaller chunks
// tolerated trivially; this ceiling is sized for Gemma, the bottleneck.
//
// Longer-term fix (Phase 8): tokeniser-aware chunking that queries the
// loaded canary's actual tokeniser rather than relying on a fixed ratio.
export const MAX_CHUNK_TOKENS = 2750;
export const APPROX_CHARS_PER_TOKEN = 4;
export const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

/**
 * Issue #25 — tokens reserved for the system prompt + response generation.
 * Subtracted from a canary's contextWindow to derive the chunk-input budget.
 * Sized so Gemma's 4096-token window yields exactly `MAX_CHUNK_TOKENS` (= 2750)
 * — preserves the Phase 4F #10 fix while letting larger-window canaries claim
 * proportionally more headroom.
 */
export const PROMPT_TOKEN_RESERVE = 1346;

/**
 * Issue #25 — hard upper bound on per-chunk input tokens regardless of canary
 * window. Bounds per-chunk inference latency: at ~10ms/token on Qwen 0.5B that
 * is still ~55s for a single chunk, ~220s per page under MAX_CHUNKS_PER_PAGE=4.
 * Larger canaries (e.g. future 7B-class) wouldn't benefit from larger chunks
 * without breaking the latency budget.
 */
export const MAX_CHUNK_TOKEN_CEILING = 5500;

/**
 * Issue #25 — derive the per-canary chunk-input token budget from its total
 * context window. Returns the smaller of (a) `MAX_CHUNK_TOKEN_CEILING` and
 * (b) `contextWindow - PROMPT_TOKEN_RESERVE`. For Gemma/Nano (4096) the
 * helper returns exactly `MAX_CHUNK_TOKENS` (preserving the Phase 4F #10
 * conservative interim cap); for Qwen (32k) it returns `MAX_CHUNK_TOKEN_CEILING`,
 * doubling the chunk budget without re-running into context-window overflow.
 *
 * `null` (no canary loaded yet) falls back to the historical default so the
 * orchestrator's pre-engine code path stays safe.
 */
export function effectiveChunkTokenBudget(contextWindow: number | null): number {
  if (contextWindow === null) return MAX_CHUNK_TOKENS;
  const fromWindow = contextWindow - PROMPT_TOKEN_RESERVE;
  return Math.max(0, Math.min(MAX_CHUNK_TOKEN_CEILING, fromWindow));
}

// Per-language chars-per-token calibration. Empirical headroom buffer over the
// Gemma 2 SentencePiece tokenizer: EN at 4.0 (vs. ~3.3-3.5 measured); CJK at
// 2.0 (vs. ~1.0-1.5 measured); KO at 2.5 (Hangul jamo merge); AR/HE at 3.5
// (Arabic diacritics produce multi-token characters). Values stay conservative
// to keep prompt-token usage well within Gemma's 4096-token window.
export const CHARS_PER_TOKEN_TABLE: Readonly<Record<string, number>> = Object.freeze({
  en: 4.0,
  es: 4.0,
  de: 4.0,
  fr: 4.0,
  pt: 4.0,
  it: 4.0,
  zh: 2.0,
  'zh-cn': 2.0,
  'zh-tw': 2.0,
  ja: 2.0,
  ko: 2.5,
  ar: 3.5,
  he: 3.5,
  und: 4.0,
});

// Phase 4 Stage 4B — cap on concurrent MLC inference to avoid the
// sustained-warm-engine failure mode observed on Gemma-2-2b in Track B.
// Chunks beyond this cap are truncated and the verdict carries
// analysisError='chunk_count_capped' so downstream analysis doesn't treat
// the truncation as lost signal. Chunks are serialized (see orchestrator),
// so total page latency scales ~linearly with chunk count up to the cap.
export const MAX_CHUNKS_PER_PAGE = 4;

export const MAX_VISIBLE_TEXT_CHARS = 50_000;
export const MAX_HIDDEN_TEXT_CHARS = 10_000;
export const SCRIPT_PREVIEW_LENGTH = 200;

export const KEEPALIVE_ALARM_NAME = 'honeyllm-keepalive';
export const KEEPALIVE_ALARM_PERIOD_SECONDS = 24;
export const CONTENT_PING_INTERVAL_MS = 20_000;

export const OFFSCREEN_URL = 'dist/offscreen/offscreen.html';
export const OFFSCREEN_REASON = 'WORKERS' as chrome.offscreen.Reason;

export const SCORE_SUMMARIZATION_ANOMALY = 20;
export const SCORE_INSTRUCTION_DETECTION = 40;
export const SCORE_ADVERSARIAL_DIVERGENCE = 30;
export const SCORE_ROLE_DRIFT = 15;
export const SCORE_EXFILTRATION_INTENT = 25;
export const SCORE_HIDDEN_CONTENT_INSTRUCTIONS = 20;

// Issue #118 (N12) — evidence-review confirms a Hunter-flagged span.
// Mirrors SCORE_INSTRUCTION_DETECTION so a confirmed packet hits the
// same band as today's full-chunk instruction detection. Non-confirmation
// contributes 0; the additive-only model means "non-confirmation
// downgrades SUSPICIOUS to noise" emerges naturally because evidence-
// review *replaces* instruction-detection + adversarial-compliance on
// finding-carrying chunks.
export const SCORE_EVIDENCE_REVIEW_CONFIRMED = 40;

// Issue #122 (N14d) — deterministic score contribution emitted as a
// synthetic 'ner_exfil_fast_path' ProbeResult when an evidence packet
// carries at least one high-confidence (>=0.95) exfiltration entity:
// exfil_domain, credential, or credit_card. Sized to stack on the
// typical Hunter-flagged chunk's score (40+) and cross
// THRESHOLD_COMPROMISED (65) without depending on LLM confirmation.
// The evidence-review LLM probe still runs alongside for
// explainability — the fast-path is additive, not replacement.
export const SCORE_EXFIL_ENTITY_CONFIRMED = 30;

// Issue #9 Stage 4G.3 — score contribution for a confirmed image-injection
// finding by the multimodal probe. Conservative by design: a single image
// flagged as "injection_present:true" must NOT cross THRESHOLD_COMPROMISED
// (65) alone. Sized to land at SUSPICIOUS in isolation; stacks with Hunter
// or other-probe signal to escalate to COMPROMISED on a multi-evidence page.
export const SCORE_IMAGE_INJECTION = 20;

// Issue #122 — confidence floor for an entity to count as
// "high-confidence" for fast-path routing. Named-shape api_key,
// luhn-validated credit_card, and BLOCKED_PATTERNS exfil_domain hits
// all emit at 0.95; generic high-entropy api_key (0.6) and http URLs
// (0.85) intentionally fall below this threshold.
export const HIGH_CONF_ENTITY_THRESHOLD = 0.95;

// Issue #118 — cap on evidence-review probes per chunk. Findings are
// sorted by score desc and the top-N are probed. Bounds the per-page
// probe budget at 4 chunks × (3 findings + 1 summarization) = 16.
export const MAX_FINDINGS_PROBED_PER_CHUNK = 3;

export const THRESHOLD_SUSPICIOUS = 30;
export const THRESHOLD_COMPROMISED = 65;

export const STORAGE_KEY_PREFIX = 'honeyllm:verdict:';
export const STORAGE_KEY_ENGINE = 'honeyllm:engine';
export const STORAGE_KEY_MODEL = 'honeyllm:model';
/**
 * Phase 4 Stage 4D — user's preferred canary id. Stored in
 * chrome.storage.sync so the selection follows them across devices.
 * Values are CanaryId (including 'auto'). Unset → DEFAULT_CANARY_ID.
 */
export const STORAGE_KEY_CANARY = 'honeyllm:canary';
/**
 * Phase 4 Stage 4D — per-device cache of Nano availability. Stored in
 * chrome.storage.local because availability depends on the specific
 * Chrome profile (EPP enrollment, component download state) rather
 * than the user's account. Cache value: the last observed
 * LanguageModel.availability() return. Refreshed when the popup opens
 * or when the engine selector runs.
 */
export const STORAGE_KEY_NANO_AVAILABILITY = 'honeyllm:nano-availability';
/**
 * Issue #20 — per-origin scan overrides. Stored in chrome.storage.sync so
 * user's skip/scan preferences follow across devices. Value shape:
 * `Record<hostname, 'scan' | 'skip'>`. Keyed by hostname (lowercased).
 * Absent key means "no override" — resolution falls through to the built-in
 * deny-list.
 */
export const STORAGE_KEY_ORIGIN_OVERRIDES = 'honeyllm:origin-overrides';

// Test-only gate. When `chrome.storage.local[STORAGE_KEY_TEST_MODE]` is
// strictly `true`, Phase 3 Track A handlers (`RUN_PROBES_DIRECT` in offscreen,
// `RUN_PROBES_BUILTIN` in the builtin-harness page) will accept requests.
// Absent or any non-true value => handlers are inert. Never persisted by
// production code; the Playwright runner toggles it for the duration of a
// sweep and unsets it afterwards. `local` is used over `sync` because sync
// is eventually consistent across contexts even on a single device.
//
// NOTE: distinct from `STORAGE_KEY_TESTING_MODE` (issue #113) — that key
// is the user-facing observe-only toggle persisted from the popup.
export const STORAGE_KEY_TEST_MODE = 'honeyllm:test-mode';

/**
 * Issue #113 (N2) — observe-only mode. When
 * `chrome.storage.local[STORAGE_KEY_TESTING_MODE]` is strictly `true`,
 * the service worker still runs the full analysis pipeline (snapshot →
 * probes → verdict → persistence → window-globals → meta tag → toolbar
 * icon → page stamp) but suppresses the `APPLY_MITIGATION` dispatch so
 * the content script does not modify the DOM, activate the network
 * guard, or arm the redirect blocker. Default `false`. Stored in
 * `local` (per-device debugging affordance, synchronously consistent).
 *
 * NOTE: distinct from `STORAGE_KEY_TEST_MODE` above — that key gates
 * the Phase 3 Track A direct-probe test harness, a different concern.
 */
export const STORAGE_KEY_TESTING_MODE = 'honeyllm:testing-mode';

/**
 * Issue #117 (N13) — per-install HMAC secret used to sign page stamps.
 * Stored in `chrome.storage.local` (not sync) so the secret stays
 * device-local and never traverses Google's sync layer. Generated lazily
 * on first call to `ensureInstallSecret()`; never rotated by the
 * extension itself (uninstall+reinstall or storage wipe rotates).
 */
export const STORAGE_KEY_INSTALL_SECRET = 'honeyllm:install-secret';

/**
 * Issue #117 (N13) — page-stamp schema version. Bumped only on
 * incompatible canonical-form changes. The verifier rejects stamps with
 * `v !== STAMP_VERSION` as `unknown-version` before touching crypto.
 */
export const STAMP_VERSION = 1 as const;

/**
 * Issue #145 — analysisError literal set when the orchestrator short-circuits
 * the chunk loop because a HuntReport reached compromise-band confidence+score
 * (HuntReport.shouldSkipProbes). Centralised here so producer (orchestrator)
 * and consumers (popup, future telemetry) share one source of truth and can
 * match by full string equality.
 */
export const EARLY_EXIT_ANALYSIS_ERROR = 'early_exit_high_confidence';

/**
 * Issue #127 (N11) — Hunter rules version. Bumped whenever Spider's pattern
 * catalog or Hawk's classifier changes in a way that could produce a
 * different verdict for the same chunk text. Page-scan cache entries are
 * keyed against this string; a bump invalidates every cached entry on the
 * next read so stale Hunter findings can never produce a stale verdict.
 *
 * Bump procedure: change the constant in the same PR that ships the rule
 * change. Use semver for human readability ('1.0.0' → '1.1.0' for additive
 * pattern adds, '2.0.0' for breaking classifier-output shape changes).
 */
export const HUNTER_RULES_VERSION = '1.0.0' as const;

/**
 * Issue #127 (N11) — page-scan cache schema version. Bumped only on
 * incompatible CachedScan shape changes (field add/remove/rename, or a
 * change that breaks deserialization of older records). Records carrying
 * a different schemaVersion are treated as cache misses and dropped on
 * next access. Distinct from HUNTER_RULES_VERSION (rule semantics) and
 * llmModelId (engine identity).
 */
export const CACHE_SCHEMA_VERSION = 1 as const;

/**
 * Issue #127 (N11) — IndexedDB database name + version + object store
 * for the page-scan cache. The object store is keyed by the page URL
 * (full URL string); each record carries the per-chunk results plus the
 * version triple (schema/hunter-rules/llm-model) used for invalidation.
 */
export const CACHE_DB_NAME = 'honeyllm-scan-cache';
export const CACHE_DB_VERSION = 1 as const;
export const CACHE_STORE_NAME = 'page-scans';

/**
 * Issue #127 (N11) — default TTL for cache entries. Per-entry TTL is
 * checked at read time: if `Date.now() - record.fetchedAt > ttlMs`, the
 * record is treated as a miss and lazily evicted. 24h default; tunable
 * via `chrome.storage.local[STORAGE_KEY_CACHE_TTL_MS]`.
 */
export const CACHE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Issue #127 (N11) — default LRU max bytes. Eviction is on write: if
 * the post-write store size exceeds this budget, the oldest entries by
 * `fetchedAt` are deleted until the store fits. Tunable via
 * `chrome.storage.local[STORAGE_KEY_CACHE_MAX_BYTES]`.
 *
 * 100 MB is a soft target; IndexedDB in Chrome has no hard origin quota
 * for extensions but exceeding 100 MB starts to bloat the user's profile.
 */
export const CACHE_DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export const STORAGE_KEY_CACHE_TTL_MS = 'honeyllm:cache-ttl-ms';
export const STORAGE_KEY_CACHE_MAX_BYTES = 'honeyllm:cache-max-bytes';

/**
 * Issue #127 (N11) — telemetry counter for cache hit/miss rate. Persisted
 * in chrome.storage.local so the popup can render a hit-rate stat without
 * a message round-trip to the SW. Shape: `{ hits: number; misses: number;
 * resetAt: number }`. Reset by clear-cache and by version-mismatch global
 * invalidation.
 */
export const STORAGE_KEY_CACHE_TELEMETRY = 'honeyllm:cache-telemetry';

/**
 * Issue #126 (N7a) — telemetry counter for chat-portal response analysis.
 * Persisted in chrome.storage.local so the popup can surface per-portal
 * capture/analysis rates and the post-merge telemetry-review agent can
 * detect selector regressions. Distinct namespace from
 * STORAGE_KEY_CACHE_TELEMETRY — never colliding keys.
 *
 * Shape: `{ captured: PerPortalCounts; analysed: PerPortalCounts;
 *           suspicious: number; compromised: number; errors: number;
 *           lastResetAt: number }`.
 */
export const STORAGE_KEY_RESPONSE_TELEMETRY = 'honeyllm:response-telemetry';

/**
 * Issue #126 (N7a) — chunkIndex offset applied to every response chunk
 * dispatched via runChunkProbes. The runChunkProbes listener filter at
 * `service-worker/orchestrator.ts:535` is `(tabId, chunkIndex)` only,
 * so a concurrent page-scan and response-scan on the same tab would
 * route PROBE_RESULTS to the wrong listener. Page scans cap at single
 * digits per page; this 1M offset eliminates collision risk while
 * staying well under JS Number.MAX_SAFE_INTEGER.
 */
export const RESPONSE_CHUNK_INDEX_OFFSET = 1_000_000;

/**
 * Issue #126 (N7a) — hard cap on captured response text length before
 * truncation. Beyond this size the analyzer truncates and surfaces
 * `analysisError = 'response_truncated'`. Keeps a single response from
 * dominating chunk-loop time on the offscreen engine.
 */
export const MAX_RESPONSE_TEXT_CHARS = 80_000;

/**
 * Issue #130 (N7b) — pre-send URL intercept storage + tuning.
 *
 * STORAGE_KEY_INTERCEPT_OVERRIDES: per-(portalId, domain) record of
 * Send-anyway events. Shape: Record<"portalId:domain", InterceptOverrideRecord>.
 * Stored in chrome.storage.local (per-device); the popup queries this to
 * surface a "Whitelist this domain?" CTA when count-in-window crosses the
 * threshold.
 *
 * STORAGE_KEY_PENDING_INTERCEPT: transient record set by the SW while a
 * scan is in flight or awaiting user action; cleared on Send-anyway /
 * Cancel / verdict-CLEAN. The popup reads this on open and subscribes via
 * chrome.storage.onChanged for live updates.
 */
export const STORAGE_KEY_INTERCEPT_OVERRIDES = 'honeyllm:intercept-overrides';
export const STORAGE_KEY_PENDING_INTERCEPT = 'honeyllm:pending-intercept';

/**
 * Issue #130 — input observer debounces keystrokes by this much before
 * extracting URLs and dispatching INTERCEPT_SCAN_REQUEST. Reuses the
 * portal/debounce.ts pattern from #126. 200ms is short enough that the
 * user perceives the gate as instant for paste; long enough to avoid
 * dispatching mid-typing on each keystroke.
 */
export const INTERCEPT_INPUT_DEBOUNCE_MS = 200;

/**
 * Issue #130 — cache-miss latency budget before the URL scanner returns
 * UNKNOWN+'intercept_timeout'. The popup pending-intercept panel offers
 * a Wait button that extends this budget once by the same amount;
 * second timeout is final and offers only Send-anyway / Cancel.
 */
export const MAX_INTERCEPT_LATENCY_MS = 30_000;
export const MAX_INTERCEPT_LATENCY_EXTENSION_MS = 30_000;

/**
 * Issue #130 — fetch size cap on the SW's URL scanner. Set via
 * `Range: bytes=0-524287` (512 KB). Servers that ignore Range and
 * stream a larger body are aborted via AbortController; the verdict
 * surfaces UNKNOWN+'response_too_large'. 512 KB comfortably contains
 * the visible HTML of >99% of legit pages while bounding the cost of
 * a hostile or accidentally-huge response.
 */
export const MAX_INTERCEPT_FETCH_BYTES = 524_288;

/**
 * Issue #130 — cap on URLs scanned per prompt. Most prompts have one;
 * the cap prevents abuse (e.g. paste-bomb a thousand URLs).
 */
export const MAX_INTERCEPT_URLS_PER_PROMPT = 3;

/**
 * Issue #130 — rolling window for override count. When a (portalId,
 * domain) tuple accumulates ≥INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD
 * Send-anyway events within this window, the popup surfaces a
 * "Whitelist this domain?" CTA.
 */
export const INTERCEPT_OVERRIDE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD = 3;

/**
 * Issue #130 — chunkIndex offset applied to every intercept-scan chunk
 * dispatched via runChunkProbes. Mirrors RESPONSE_CHUNK_INDEX_OFFSET
 * (#126, =1_000_000) to avoid PROBE_RESULTS listener collision when a
 * page-scan, response-scan, and intercept-scan all run on the same
 * tabId. 2_000_000 stays well under Number.MAX_SAFE_INTEGER.
 */
export const INTERCEPT_CHUNK_INDEX_OFFSET = 2_000_000;

/**
 * Issue #131 (N7c) — chat-portal thinking-block (reasoning) inspection
 * storage + tuning.
 *
 * STORAGE_KEY_THINKING_TELEMETRY: per-portal capture/analysis counts for
 * the thinking observer. Same shape as STORAGE_KEY_RESPONSE_TELEMETRY but
 * a distinct key so the response and thinking surfaces don't trample each
 * other on read-modify-write.
 *
 * THINKING_CHUNK_INDEX_OFFSET: stratifies PROBE_RESULTS routing alongside
 * RESPONSE_CHUNK_INDEX_OFFSET (1M) and INTERCEPT_CHUNK_INDEX_OFFSET (2M).
 * 3M stays well under Number.MAX_SAFE_INTEGER and reserves 4M+ for future
 * observer surfaces.
 *
 * MAX_THINKING_TEXT_CHARS: hard cap on captured thinking text length
 * before truncation. Beyond this size the analyzer truncates and surfaces
 * `analysisError = 'thinking_truncated'`. Mirrors MAX_RESPONSE_TEXT_CHARS.
 */
export const STORAGE_KEY_THINKING_TELEMETRY = 'honeyllm:thinking-telemetry';
export const THINKING_CHUNK_INDEX_OFFSET = 3_000_000;
export const MAX_THINKING_TEXT_CHARS = 80_000;

/**
 * SR-G (registry-#51) — privacy telemetry for site-structure registry
 * lookups. Persisted in chrome.storage.local so the popup can render
 * registry hit/miss/stale metadata without a message round-trip to the SW
 * and so counters survive SW termination. Distinct namespace from
 * STORAGE_KEY_CACHE_TELEMETRY; the registry sits in front of the cache in
 * `analyzeSnapshot` and the two surfaces have independent reset semantics.
 *
 * Shape: `{
 *   hits: number;
 *   misses: number;
 *   verifyFailures: number;
 *   bundleSignedAt: number | null;
 *   bundleLoadedAt: number | null;
 *   perOrigin: Record<origin, { hits: number; misses: number; lastSeenAt: number }>;
 *   lastResetAt: number;
 * }`.
 *
 * `verifyFailures` is global (the load happens before any origin is in
 * play). `perOrigin` is bucketed for the popup so the user can see which
 * origins contributed to the hit-rate; bounded by REGISTRY_MAX_ORIGINS_TRACKED
 * with LRU eviction by `lastSeenAt` so a long-tail of one-off origins can't
 * dominate the storage payload.
 */
export const STORAGE_KEY_REGISTRY_TELEMETRY = 'honeyllm:registry-telemetry';

/**
 * SR-G (registry-#51) — LRU cap on per-origin registry telemetry buckets.
 * 50 covers the realistic top-N most-visited origins for any one user
 * without unbounded growth from one-off visits. Eviction picks the entry
 * with the oldest `lastSeenAt` when a new origin would overflow the cap.
 */
export const REGISTRY_MAX_ORIGINS_TRACKED = 50;

/**
 * SR-G (registry-#51) — staleness threshold for the bundled registry's
 * `signedAt` timestamp. The popup renders an amber warning when
 * `now() - bundleSignedAt > REGISTRY_STALE_BUNDLE_THRESHOLD_MS`. 60 days
 * is a soft signal ahead of SR-H's hard signing-cadence gate; the
 * warning is informational, not blocking.
 */
export const REGISTRY_STALE_BUNDLE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Issue #48 — set of page languages where the LLM probe stack is known to
 * produce signal. The orchestrator pre-flight calls detectLanguage() and
 * short-circuits with a synthetic `unsupported_language: <lang>` verdict
 * when the detected language is outside this set.
 *
 * English-only because the v1 / v2 classifier strings (e.g. "I have been
 * compromised", "DAN mode enabled") are English idioms — they do not catch
 * compliance phrasing in other languages, so running probes on a Japanese
 * Wikipedia page produces a confusing UNKNOWN cascade rather than useful
 * signal. `'und'` (returned by detectLanguage for short text or detector
 * failure) is intentionally NOT pre-judged: the gate proceeds on `'und'`
 * to avoid false-skipping short pages.
 */
export const SUPPORTED_PROBE_LANGUAGES = ['en'] as const;
export type SupportedProbeLanguage = (typeof SUPPORTED_PROBE_LANGUAGES)[number];
