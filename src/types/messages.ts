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
  | 'PONG_KEEPALIVE';

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

export type HoneyLLMMessage =
  | PageSnapshotMessage
  | RunProbesMessage
  | ProbeResultsMessage
  | VerdictMessage
  | ApplyMitigationMessage
  | EngineStatusMessage
  | EngineReadyMessage
  | PingKeepaliveMessage
  | PongKeepaliveMessage;
