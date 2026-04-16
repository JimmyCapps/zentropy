import type { PageSnapshot } from './snapshot.js';
import type { ProbeResult, SecurityVerdict } from './verdict.js';

export type MessageType =
  | 'PAGE_SNAPSHOT'
  | 'RUN_PROBES'
  | 'PROBE_RESULTS'
  | 'VERDICT'
  | 'APPLY_MITIGATION'
  | 'ENGINE_STATUS'
  | 'ENGINE_READY'
  | 'PING_KEEPALIVE'
  | 'PONG_KEEPALIVE'
  // Phase 3 Track A — test-only message types. Handlers are gated on
  // `chrome.storage.local['honeyllm:test-mode'] === true` and inert otherwise.
  | 'RUN_PROBE_DIRECT'
  | 'PROBE_DIRECT_RESULT'
  | 'RUN_PROBE_BUILTIN'
  | 'PROBE_BUILTIN_RESULT';

interface BaseMessage {
  readonly type: MessageType;
}

export interface PageSnapshotMessage extends BaseMessage {
  readonly type: 'PAGE_SNAPSHOT';
  readonly tabId: number;
  readonly snapshot: PageSnapshot;
}

export interface RunProbesMessage extends BaseMessage {
  readonly type: 'RUN_PROBES';
  readonly tabId: number;
  readonly chunk: string;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly metadata: { readonly url: string; readonly origin: string };
}

export interface ProbeResultsMessage extends BaseMessage {
  readonly type: 'PROBE_RESULTS';
  readonly tabId: number;
  readonly chunkIndex: number;
  readonly results: readonly ProbeResult[];
}

export interface VerdictMessage extends BaseMessage {
  readonly type: 'VERDICT';
  readonly verdict: SecurityVerdict;
}

export interface ApplyMitigationMessage extends BaseMessage {
  readonly type: 'APPLY_MITIGATION';
  readonly verdict: SecurityVerdict;
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

export type HoneyLLMMessage =
  | PageSnapshotMessage
  | RunProbesMessage
  | ProbeResultsMessage
  | VerdictMessage
  | ApplyMitigationMessage
  | EngineStatusMessage
  | EngineReadyMessage
  | PingKeepaliveMessage
  | PongKeepaliveMessage
  | RunProbeDirectMessage
  | ProbeDirectResultMessage
  | RunProbeBuiltinMessage
  | ProbeBuiltinResultMessage;
