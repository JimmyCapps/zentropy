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
  },
  'qwen2.5-0.5b-mlc': {
    id: 'qwen2.5-0.5b-mlc',
    displayName: 'Qwen 2.5 (0.5B, fast-path fallback)',
    engineTransport: 'mlc-webllm-webgpu',
    transportModelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    capabilities: ['text_input'],
    requiresEnrollment: false,
    minChromeVersion: 113,
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
export const STORAGE_KEY_TEST_MODE = 'honeyllm:test-mode';
