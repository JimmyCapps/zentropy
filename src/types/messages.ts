import type { PageSnapshot } from './snapshot.js';
import type { ProbeResult, SecurityStatus, SecurityVerdict, WebGPUAdapterMode } from './verdict.js';
import type { VerifyStampResult } from './page-stamp.js';
import type { CapturedResponse, CapturedThinking } from './portal-response.js';
import type { EvidencePacket } from '@/probes/base-probe.js';
import type { Entity } from '@/hunters/ner/types.js';
import type { LogEntry } from '@/shared/logger.js';

export type MessageType =
  | 'PAGE_SNAPSHOT'
  | 'RUN_PROBES'
  | 'PROBE_RESULTS'
  | 'VERDICT'
  | 'APPLY_MITIGATION'
  // Issue #233 — symmetric deactivate path. SW → content, dispatched
  // when a CLEAN/UNKNOWN verdict supersedes a prior COMPROMISED/SUSPICIOUS
  // for the same tab. Tells the content script to roll back active
  // mitigations (network guard, redirect blocker) and remove the stamp.
  | 'DEACTIVATE_MITIGATIONS'
  // Issue #236 — SW broadcasts the current logging state to each
  // content script: whether the log viewer is connected and whether the
  // heartbeat should be running for THIS tab (already-resolved
  // perTab[id] ?? global). Content uses it to gate its log sink and
  // start/stop the heartbeat.
  | 'SET_LOGGING_STATE'
  | 'ENGINE_STATUS'
  | 'ENGINE_READY'
  | 'PING_KEEPALIVE'
  | 'PONG_KEEPALIVE'
  // Phase 3 Track A — test-only message types. Handlers are gated on
  // `chrome.storage.local['honeyllm:test-mode'] === true` and inert otherwise.
  | 'RUN_PROBE_DIRECT'
  | 'PROBE_DIRECT_RESULT'
  | 'RUN_PROBE_BUILTIN'
  | 'PROBE_BUILTIN_RESULT'
  // Issue #117 (N13) — page-stamp verification. Internal-only channel
  // (registered on chrome.runtime.onMessage, NOT onMessageExternal —
  // see service-worker/index.ts for the security rationale).
  | 'VERIFY_STAMP'
  | 'VERIFY_STAMP_RESULT'
  // Issue #113 (N2) — testing-mode rescan flow. RESCAN_WITH_MITIGATION
  // is popup → SW; TRIGGER_RESCAN is SW → content. Both are internal
  // channels (chrome.runtime.onMessage / chrome.tabs.sendMessage).
  | 'RESCAN_WITH_MITIGATION'
  | 'TRIGGER_RESCAN'
  // Issue #114 (N3) — generic popup rescan. Re-runs the orchestrator
  // pipeline against the active tab without forcing mitigations; the
  // testing-mode gate in dispatchVerdictMessages applies normally.
  | 'RESCAN_PAGE'
  // Issue #119 (N14a) — language detection RPC. SW → offscreen request
  // with the chunk text; offscreen replies via sendResponse with a
  // LanguageResultMessage. The Chrome `LanguageDetector` API runs in
  // offscreen (DOM context); the SW-side `language-router.ts` caches by
  // sha256(text) so a repeated chunk doesn't re-cross the boundary.
  | 'DETECT_LANGUAGE'
  | 'LANGUAGE_RESULT'
  // Issue #156 — freeform NER RPC. SW (orchestrator chunk loop) → offscreen
  // request with chunk text + absolute offset; offscreen replies via
  // sendResponse with NerResultMessage carrying transformer-extracted
  // PER/ORG/LOC/MISC entities. The SW-side ner-router caches by
  // sha256(text) so a repeated chunk doesn't re-cross the boundary.
  | 'RUN_NER'
  | 'NER_RESULT'
  // Issue #129 Stage 4 — sentence-embedding RPC. SW (orchestrator chunk
  // loop, via `service-worker/embed-router.ts`) → offscreen request with
  // chunk text; offscreen replies with a 384-dim L2-normalised embedding
  // produced by `intfloat/multilingual-e5-small`. The router caches by
  // sha256(text) so repeated chunk text never re-crosses the boundary.
  // Embedding is serialised as `number[]` (chrome.runtime messages are
  // JSON-cloneable; Float32Array does not survive the bridge); the SW
  // router rehydrates to Float32Array on the receive side.
  | 'EMBED_TEXT'
  | 'EMBED_RESULT'
  // Issue #126 (N7a) — chat-portal observer dispatches RESPONSE_CAPTURED
  // when an assistant response finishes streaming. Handled by the SW's
  // response-analyzer; runs the existing 3-probe stack on the captured
  // text and writes a ResponseVerdict back via mergeWithStoredVerdict.
  | 'RESPONSE_CAPTURED'
  // Issue #130 (N7b) — pre-send URL intercept. Content-side observer
  // detects URLs in the chat-portal composer and dispatches
  // INTERCEPT_SCAN_REQUEST; SW's url-scanner replies with
  // INTERCEPT_VERDICT. Cache hit → instant; cache miss → fetch URL
  // (credentials:'omit' + Range cap) → offscreen DOMParser via
  // PARSE_HTML_REQUEST → analyzeSnapshot → cache write.
  | 'INTERCEPT_SCAN_REQUEST'
  | 'INTERCEPT_VERDICT'
  | 'PARSE_HTML_REQUEST'
  | 'PARSE_HTML_RESULT'
  // Issue #131 (N7c) — chat-portal thinking observer dispatches
  // THINKING_CAPTURED when an assistant reasoning block finishes
  // streaming. Handled by the SW's thinking-analyzer; runs the existing
  // 3-probe stack against the captured thinking text and writes a
  // ThinkingVerdict back via setThinkingVerdictForOrigin. Distinct from
  // RESPONSE_CAPTURED — separate analyzer, separate telemetry, separate
  // dedup cache, separate chunk-index offset.
  | 'THINKING_CAPTURED'
  // Issue #218 — log forwarding. Offscreen / content / popup contexts
  // can't reach the SW-side LogBus directly; they emit LOG_ENTRY via
  // chrome.runtime.sendMessage and the SW's onMessage handler routes
  // the entry into the bus for live streaming to the log-viewer page.
  | 'LOG_ENTRY';

interface BaseMessage {
  readonly type: MessageType;
}

export interface PageSnapshotMessage extends BaseMessage {
  readonly type: 'PAGE_SNAPSHOT';
  readonly tabId: number;
  readonly snapshot: PageSnapshot;
  /**
   * Issue #113 (N2) — set only by the TRIGGER_RESCAN path. When `true`,
   * the SW dispatches APPLY_MITIGATION for SUSPICIOUS/COMPROMISED
   * verdicts even if testing-mode is enabled. The flag affects this
   * single verdict only; the persisted testing-mode toggle is not
   * mutated. Absent on the normal page-load snapshot path.
   */
  readonly forceMitigation?: boolean;
}

export interface RunProbesMessage extends BaseMessage {
  readonly type: 'RUN_PROBES';
  readonly tabId: number;
  readonly chunk: string;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly metadata: { readonly url: string; readonly origin: string };
  // Issue #118 (N12) — when non-empty, the offscreen probe-runner runs
  // evidence-review on each packet (replacing instruction-detection +
  // adversarial-compliance for this chunk) plus summarization. When
  // empty/absent, runs the existing 3-probe stack on the full chunk.
  readonly evidencePackets?: readonly EvidencePacket[];
}

export interface ProbeResultsMessage extends BaseMessage {
  readonly type: 'PROBE_RESULTS';
  readonly tabId: number;
  readonly chunkIndex: number;
  readonly results: readonly ProbeResult[];
  // Phase 4 Stage 4D.3 — identifies which canary produced these results so
  // the orchestrator can stamp it onto the resulting SecurityVerdict.
  // Null if the offscreen couldn't determine the canary (shouldn't happen
  // in practice; kept nullable for legacy/error paths).
  readonly canaryId: string | null;
  // Issue #59 — WebGPU adapter mode from the most recent initEngine() call.
  // Null when introspection hasn't run yet or navigator.gpu was unavailable.
  readonly webgpuAdapterMode: WebGPUAdapterMode | null;
}

export interface VerdictMessage extends BaseMessage {
  readonly type: 'VERDICT';
  readonly verdict: SecurityVerdict;
}

export interface ApplyMitigationMessage extends BaseMessage {
  readonly type: 'APPLY_MITIGATION';
  readonly verdict: SecurityVerdict;
}

/**
 * Issue #233 — sent by the SW when a CLEAN or UNKNOWN verdict
 * supersedes a prior COMPROMISED/SUSPICIOUS for the same tab. The
 * content script deactivates the network guard, detaches the redirect
 * blocker, and tears down the page-stamp lifecycle. No payload is
 * needed — the trigger condition is decided in dispatch.ts.
 */
export interface DeactivateMitigationsMessage extends BaseMessage {
  readonly type: 'DEACTIVATE_MITIGATIONS';
}

/**
 * Issue #236 — broadcast by the SW to every content script when the log
 * viewer connects/disconnects or when the heartbeat preference changes.
 *
 * `connected` — true while a viewer Port is open on the SW. Content
 *   uses this to gate its log sink: when false, log lines drop without
 *   touching `chrome.runtime` (eliminating the closure-leak class
 *   identified in #236 root-cause analysis).
 *
 * `heartbeat` — already-resolved per-tab value
 *   (`perTab[tabId] ?? global`). Content starts/stops its heartbeat in
 *   response. The SW resolves per-tab so content doesn't need to know
 *   its own tabId.
 */
export interface SetLoggingStateMessage extends BaseMessage {
  readonly type: 'SET_LOGGING_STATE';
  readonly connected: boolean;
  readonly heartbeat: boolean;
}

export interface EngineStatusMessage extends BaseMessage {
  readonly type: 'ENGINE_STATUS';
  readonly status: 'loading' | 'ready' | 'error';
  readonly progress?: number;
  readonly error?: string;
  readonly modelId?: string;
}

export interface EngineReadyMessage extends BaseMessage {
  readonly type: 'ENGINE_READY';
}

export interface PingKeepaliveMessage extends BaseMessage {
  readonly type: 'PING_KEEPALIVE';
}

export interface PongKeepaliveMessage extends BaseMessage {
  readonly type: 'PONG_KEEPALIVE';
}

// Phase 3 Track A — test-only messages. See src/shared/constants.ts
// (STORAGE_KEY_TEST_MODE) for the gate contract. Each message carries a
// single probe call (system prompt + user message) and returns raw output.
// The runner sends one per (model, input, probe) cell.

export interface RunProbeDirectMessage extends BaseMessage {
  readonly type: 'RUN_PROBE_DIRECT';
  readonly requestId: string;
  readonly probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance';
  readonly systemPrompt: string;
  readonly userMessage: string;
}

export interface ProbeDirectResultMessage extends BaseMessage {
  readonly type: 'PROBE_DIRECT_RESULT';
  readonly requestId: string;
  readonly probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance';
  readonly engineRuntime: 'mlc-webllm-webgpu';
  readonly engineModel: string;
  readonly rawOutput: string;
  readonly inferenceMs: number;
  readonly firstLoadMs: number | null;
  readonly webgpuBackendDetected: string | null;
  // `skipped` indicates the handler declined to run the probe (gate off,
  // engine not initialised, etc.). `errorMessage` is populated when the
  // handler attempted the probe but the engine threw. At most one of
  // `skipped` and `errorMessage !== null` is true per row.
  readonly skipped: boolean;
  readonly skippedReason: string | null;
  readonly errorMessage: string | null;
}

export interface RunProbeBuiltinMessage extends BaseMessage {
  readonly type: 'RUN_PROBE_BUILTIN';
  readonly requestId: string;
  readonly probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance';
  readonly systemPrompt: string;
  readonly userMessage: string;
}

export interface ProbeBuiltinResultMessage extends BaseMessage {
  readonly type: 'PROBE_BUILTIN_RESULT';
  readonly requestId: string;
  readonly probeName: 'summarization' | 'instruction_detection' | 'adversarial_compliance';
  readonly engineRuntime: 'chrome-builtin-prompt-api';
  readonly engineModel: 'chrome-builtin-gemini-nano';
  readonly rawOutput: string;
  readonly inferenceMs: number;
  readonly firstCreateMs: number | null;
  // Chrome's `availability()` has returned both the spec values
  // ('readily-available' | 'after-download' | 'downloading' | 'unavailable')
  // and the collapsed Stable value 'available' (Chrome 147). Accept all.
  readonly availability: 'available' | 'readily-available' | 'after-download' | 'downloading' | 'unavailable' | null;
  // `skipped` indicates the handler declined to run the probe (gate off, API
  // absent, availability = 'unavailable'). `errorMessage` is populated when
  // the handler attempted the probe but create/prompt threw. At most one of
  // `skipped` and `errorMessage !== null` is true per row.
  readonly skipped: boolean;
  readonly skippedReason: string | null;
  readonly errorMessage: string | null;
}

// Issue #117 (N13) — VERIFY_STAMP is dispatched from the popup or
// internal test harness via `chrome.runtime.sendMessage`. The `stamp`
// field is `unknown` because it's untrusted input (the LLM's returned
// payload, possibly tampered); `verifyStamp` narrows it via runtime
// shape checks before any crypto compute. `currentUrl` is the URL the
// caller wants to verify the stamp against — its match against
// `stamp.url` (after normalisation) is what makes the URL check
// meaningful rather than tautological.
export interface VerifyStampMessage extends BaseMessage {
  readonly type: 'VERIFY_STAMP';
  readonly stamp: unknown;
  readonly currentUrl: string;
}

export interface VerifyStampResultMessage extends BaseMessage {
  readonly type: 'VERIFY_STAMP_RESULT';
  readonly result: VerifyStampResult;
}

// Issue #113 (N2) — observe-only rescan-with-prevention. The popup
// dispatches RescanWithMitigationMessage for the active tab; the SW
// fans out a TriggerRescanMessage to that tab's content script, which
// re-extracts the snapshot and re-sends PAGE_SNAPSHOT with
// `forceMitigation: true`. The override applies for that one verdict
// only; the persisted testing-mode toggle is not mutated.
export interface RescanWithMitigationMessage extends BaseMessage {
  readonly type: 'RESCAN_WITH_MITIGATION';
  readonly tabId: number;
}

export interface TriggerRescanMessage extends BaseMessage {
  readonly type: 'TRIGGER_RESCAN';
  readonly forceMitigation: boolean;
}

// Issue #114 (N3) — popup → SW. The SW handler fans out
// TriggerRescanMessage with `forceMitigation: false`; the content
// script re-extracts and re-sends PAGE_SNAPSHOT, and the testing-mode
// gate applies normally. Distinct from RescanWithMitigationMessage
// which is testing-mode-only and forces mitigations on for one run.
export interface RescanPageMessage extends BaseMessage {
  readonly type: 'RESCAN_PAGE';
  readonly tabId: number;
}

// Issue #119 (N14a) — language detection RPC. The `source` field
// distinguishes the Chrome built-in `LanguageDetector` API path from the
// transformers.js xlm-roberta fallback. `lang` follows the Chrome API's
// BCP-47 shape (`en`, `es`, `zh`, …); `und` is the ISO 639-3 sentinel
// for "undetermined" used when both detection paths fail or input is too
// short to be meaningful.
export interface LanguageDetectionResult {
  readonly lang: string;
  readonly confidence: number;
  readonly source: 'chrome-api' | 'xlm-roberta';
}

export interface DetectLanguageMessage extends BaseMessage {
  readonly type: 'DETECT_LANGUAGE';
  readonly text: string;
}

export interface LanguageResultMessage extends BaseMessage {
  readonly type: 'LANGUAGE_RESULT';
  readonly result: LanguageDetectionResult;
}

// Issue #156 — RUN_NER carries a chunk's full text + the chunk's absolute
// offset within the page text. The offscreen handler invokes
// `handleRunNer(text, deadlineMs, chunkOffset)`, so returned
// `NerResultMessage.entities[].span` are absolute over the page text and
// `mergeNerIntoPackets` (Phase 5) can intersect them with each evidence
// packet's window without further bookkeeping.
export interface RunNerMessage extends BaseMessage {
  readonly type: 'RUN_NER';
  readonly text: string;
  readonly chunkOffset: number;
  readonly deadlineMs?: number;
}

export interface NerResultMessage extends BaseMessage {
  readonly type: 'NER_RESULT';
  readonly entities: readonly Entity[];
  readonly inferenceMs: number;
}

// Issue #129 Stage 4 — embedding RPC. `mode` selects the e5 instruction
// prefix: `passage` for corpus/document text (default; chunks the
// orchestrator routes here), `query` for retrieval queries against the
// corpus index. `embedding` on the reply is `number[]` of length 384
// (`EMBEDDING_DIM`) or `null` on init/inference failure — the SW router
// wraps null into the embeddings hunter's "no signal" path.
export interface EmbedTextMessage extends BaseMessage {
  readonly type: 'EMBED_TEXT';
  readonly text: string;
  readonly mode?: 'passage' | 'query';
}

export interface EmbedResultMessage extends BaseMessage {
  readonly type: 'EMBED_RESULT';
  readonly embedding: readonly number[] | null;
  readonly inferenceMs: number;
}

// Issue #126 (N7a) — content-script dispatches RESPONSE_CAPTURED to the
// SW when a chat-portal assistant response finishes streaming. The SW
// response-analyzer reads `tabId` from `sender.tab?.id ?? message.tabId`
// (mirrors the PageSnapshotMessage convention) and routes to
// `analyzeResponse(tabId, message.capture)`. The page URL/origin
// travels in `metadata` so the analyzer never needs `chrome.tabs.get`.
export interface ResponseCapturedMessage extends BaseMessage {
  readonly type: 'RESPONSE_CAPTURED';
  readonly tabId: number;
  readonly capture: CapturedResponse;
  readonly metadata: { readonly url: string; readonly origin: string };
}

// Issue #130 (N7b) — pre-send URL intercept. The portal-side observer
// dispatches one INTERCEPT_SCAN_REQUEST per URL detected (capped at
// MAX_INTERCEPT_URLS_PER_PROMPT). The SW replies via
// chrome.tabs.sendMessage with INTERCEPT_VERDICT correlated by
// requestId. Send-button gating runs on the content side; the SW only
// produces verdicts.
export type PortalId = 'chatgpt' | 'claude' | 'gemini';

export interface InterceptVerdict {
  readonly status: SecurityStatus;
  readonly scannedUrl: string;
  readonly probeBreakdown: {
    readonly totalProbes: number;
    readonly suspiciousProbes: number;
    readonly compromisedProbes: number;
  };
  readonly totalScore: number;
  readonly cacheHit: boolean;
  readonly timestamp: number;
  readonly analysisError: string | null;
}

export interface InterceptScanRequestMessage extends BaseMessage {
  readonly type: 'INTERCEPT_SCAN_REQUEST';
  readonly tabId: number;
  readonly portalId: PortalId;
  readonly url: string;
  readonly requestId: string;
  readonly origin: string;
}

export interface InterceptVerdictMessage extends BaseMessage {
  readonly type: 'INTERCEPT_VERDICT';
  readonly requestId: string;
  readonly verdict: InterceptVerdict;
}

// Issue #130 (N7b) — offscreen-mediated HTML parse RPC. The SW has no
// DOMParser; parseHtmlToSnapshot lives in the offscreen document and
// builds a synthetic PageSnapshot from fetched HTML so analyzeSnapshot
// can run unchanged. Reduced-fidelity layout filtering — the parsed
// document has no viewport, so visibility heuristics are attribute-
// based only (no getComputedStyle). Acceptable for pre-send URL scans.
export interface ParseHtmlRequestMessage extends BaseMessage {
  readonly type: 'PARSE_HTML_REQUEST';
  readonly requestId: string;
  readonly html: string;
  readonly url: string;
}

export interface ParseHtmlResultMessage extends BaseMessage {
  readonly type: 'PARSE_HTML_RESULT';
  readonly requestId: string;
  readonly snapshot: PageSnapshot | null;
  readonly errorMessage: string | null;
}

// Issue #131 (N7c) — content-script dispatches THINKING_CAPTURED to the
// SW when a chat-portal assistant thinking/reasoning block finishes
// streaming. Same dispatch shape as ResponseCapturedMessage; the SW
// thinking-analyzer reads `tabId` from `sender.tab?.id ?? message.tabId`
// (mirrors the PageSnapshotMessage convention) and routes to
// `analyzeThinking(tabId, message.capture)`. Page URL/origin travels in
// `metadata` so the analyzer never needs `chrome.tabs.get`.
export interface ThinkingCapturedMessage extends BaseMessage {
  readonly type: 'THINKING_CAPTURED';
  readonly tabId: number;
  readonly capture: CapturedThinking;
  readonly metadata: { readonly url: string; readonly origin: string };
}

// Issue #218 — log forwarding from non-SW contexts. The sender attaches
// its already-formatted LogEntry (assigned source, context, level,
// serialized args) and the SW pipes it into the LogBus. No reply.
export interface LogEntryMessage extends BaseMessage {
  readonly type: 'LOG_ENTRY';
  readonly entry: LogEntry;
}

export type HoneyLLMMessage =
  | PageSnapshotMessage
  | RunProbesMessage
  | ProbeResultsMessage
  | VerdictMessage
  | ApplyMitigationMessage
  | DeactivateMitigationsMessage
  | SetLoggingStateMessage
  | EngineStatusMessage
  | EngineReadyMessage
  | PingKeepaliveMessage
  | PongKeepaliveMessage
  | RunProbeDirectMessage
  | ProbeDirectResultMessage
  | RunProbeBuiltinMessage
  | ProbeBuiltinResultMessage
  | VerifyStampMessage
  | VerifyStampResultMessage
  | RescanWithMitigationMessage
  | TriggerRescanMessage
  | RescanPageMessage
  | DetectLanguageMessage
  | LanguageResultMessage
  | RunNerMessage
  | NerResultMessage
  | EmbedTextMessage
  | EmbedResultMessage
  | ResponseCapturedMessage
  | InterceptScanRequestMessage
  | InterceptVerdictMessage
  | ParseHtmlRequestMessage
  | ParseHtmlResultMessage
  | ThinkingCapturedMessage
  | LogEntryMessage;
