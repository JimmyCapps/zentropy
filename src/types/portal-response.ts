import type {
  BehavioralFlags,
  ProbeResult,
  SecurityStatus,
} from './verdict.js';

// Issue #126 (N7a) — chat-portal response inspection contract.
//
// HoneyLLM has zero visibility into the URL that ChatGPT / Claude.ai / Gemini
// fetched on the user's behalf, but it can observe the assistant's rendered
// reply. The portal content scripts capture that reply text via a
// MutationObserver, and the SW response-analyzer runs the existing 3-probe
// stack against it to surface a distinct ResponseVerdict in the popup.

export type PortalId = 'chatgpt' | 'claude' | 'gemini';

const PORTAL_IDS: ReadonlySet<PortalId> = new Set<PortalId>(['chatgpt', 'claude', 'gemini']);

const SECURITY_STATUSES: ReadonlySet<SecurityStatus> = new Set<SecurityStatus>([
  'CLEAN',
  'SUSPICIOUS',
  'COMPROMISED',
  'UNKNOWN',
]);

/**
 * Single portal-side capture event. Built by a portal adapter when a
 * streaming response settles (debounce + completion-marker hybrid).
 *
 * `messageId` is adapter-derived: `data-message-id` for ChatGPT,
 * `data-test-render-count` fallback for Claude, synthesized for Gemini.
 * `streamComplete` is always true in Stage 2 — kept on the shape for
 * forward-compat with #131 (view-thinking, mid-stream snapshots).
 */
export interface CapturedResponse {
  readonly portalId: PortalId;
  readonly text: string;
  readonly capturedAt: number;
  readonly conversationId: string | null;
  readonly messageId: string;
  readonly streamComplete: boolean;
}

/**
 * Verdict from running the 3-probe stack against a captured response.
 * Lives on `SecurityVerdict.responseVerdict` (additive optional). Latest
 * capture wins per-origin; conversation history is out of scope for #126.
 *
 * Deliberately omits `webgpuAdapterMode` (parent verdict carries it),
 * `mitigationsApplied` (response mitigations not in scope — see plan §D6),
 * `stamp` / `entitySummary` / `perChunkAnalysis` (page-level fields).
 */
export interface ResponseVerdict {
  readonly portalId: PortalId;
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: BehavioralFlags;
  readonly timestamp: number;
  /** Full SHA-256 hex of the response text (64 lowercase hex chars). */
  readonly responseTextHash: string;
  readonly responseTextLength: number;
  readonly conversationId: string | null;
  readonly messageId: string;
  readonly analysisError: string | null;
  readonly canaryId: string | null;
}

/**
 * Adapter contract every portal implementation satisfies. Adapters READ
 * DOM only — never inject UI into the portal page (CSP friction +
 * portal-detection signal).
 */
export interface PortalAdapter {
  readonly portalId: PortalId;
  matchesHost(hostname: string): boolean;
  findAssistantResponses(root: ParentNode): readonly HTMLElement[];
  /**
   * Begin observing the portal DOM for completed assistant responses.
   * Returns a disposer that detaches the observer.
   */
  attachResponseObserver(
    root: ParentNode,
    callback: (cap: CapturedResponse) => void,
  ): () => void;
}

// Issue #131 (N7c) — chat-portal thinking/reasoning inspection contract.
//
// Same portals as #126 (ChatGPT o1/o3 reasoning summaries, Claude.ai
// extended-thinking blocks, Gemini <model-thoughts>/<thinking-block>)
// expose the model's deliberation in DOM subtrees that #126's response
// observers explicitly skip. The thinking observer captures those
// subtrees, the SW thinking-analyzer runs the same 3-probe stack on the
// captured text, and the popup renders a third accordion alongside
// pageScanVerdict and responseVerdict. Distinct storage slot, distinct
// telemetry key, distinct chunk-index offset. No mitigations.

/**
 * Single portal-side thinking-block capture event. Built by a thinking
 * adapter when a streaming thinking section settles (debounce + portal-
 * specific completion-marker hybrid; Claude reuses data-is-streaming
 * from the turn container, Gemini reuses the response copy button,
 * ChatGPT falls back to debounce alone).
 *
 * `messageId` is adapter-derived in the same shape as CapturedResponse
 * but namespaced (e.g. `chatgpt-thinking:fallback:<prefix>`) so a thinking
 * capture and a response capture for the same logical assistant turn
 * cannot collide in the SW dedup cache.
 */
export interface CapturedThinking {
  readonly portalId: PortalId;
  readonly text: string;
  readonly capturedAt: number;
  readonly conversationId: string | null;
  readonly messageId: string;
  readonly streamComplete: boolean;
}

/**
 * Verdict from running the 3-probe stack against a captured thinking
 * block. Lives on `SecurityVerdict.thinkingVerdict` (additive optional).
 * Latest capture wins per-origin; conversation history is out of scope.
 *
 * Identical shape to ResponseVerdict apart from the `thinkingTextHash` /
 * `thinkingTextLength` field names — the renamed pair signals to popup
 * and storage code that this verdict reflects deliberation rather than
 * the visible reply.
 */
export interface ThinkingVerdict {
  readonly portalId: PortalId;
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: BehavioralFlags;
  readonly timestamp: number;
  /** Full SHA-256 hex of the thinking text (64 lowercase hex chars). */
  readonly thinkingTextHash: string;
  readonly thinkingTextLength: number;
  readonly conversationId: string | null;
  readonly messageId: string;
  readonly analysisError: string | null;
  readonly canaryId: string | null;
}

function isBehavioralFlags(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.roleDrift === 'boolean' &&
    typeof v.exfiltrationIntent === 'boolean' &&
    typeof v.instructionFollowing === 'boolean' &&
    typeof v.hiddenContentAwareness === 'boolean'
  );
}

export function isResponseVerdict(value: unknown): value is ResponseVerdict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.portalId !== 'string' || !PORTAL_IDS.has(v.portalId as PortalId)) return false;
  if (typeof v.status !== 'string' || !SECURITY_STATUSES.has(v.status as SecurityStatus)) return false;
  if (typeof v.confidence !== 'number') return false;
  if (typeof v.totalScore !== 'number') return false;
  if (!Array.isArray(v.probeResults)) return false;
  if (!isBehavioralFlags(v.behavioralFlags)) return false;
  if (typeof v.timestamp !== 'number') return false;
  if (typeof v.responseTextHash !== 'string' || v.responseTextHash.length !== 64) return false;
  if (typeof v.responseTextLength !== 'number' || v.responseTextLength < 0) return false;
  if (v.conversationId !== null && typeof v.conversationId !== 'string') return false;
  if (typeof v.messageId !== 'string') return false;
  if (v.analysisError !== null && typeof v.analysisError !== 'string') return false;
  if (v.canaryId !== null && typeof v.canaryId !== 'string') return false;

  return true;
}

export function isThinkingVerdict(value: unknown): value is ThinkingVerdict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.portalId !== 'string' || !PORTAL_IDS.has(v.portalId as PortalId)) return false;
  if (typeof v.status !== 'string' || !SECURITY_STATUSES.has(v.status as SecurityStatus)) return false;
  if (typeof v.confidence !== 'number') return false;
  if (typeof v.totalScore !== 'number') return false;
  if (!Array.isArray(v.probeResults)) return false;
  if (!isBehavioralFlags(v.behavioralFlags)) return false;
  if (typeof v.timestamp !== 'number') return false;
  if (typeof v.thinkingTextHash !== 'string' || v.thinkingTextHash.length !== 64) return false;
  if (typeof v.thinkingTextLength !== 'number' || v.thinkingTextLength < 0) return false;
  if (v.conversationId !== null && typeof v.conversationId !== 'string') return false;
  if (typeof v.messageId !== 'string') return false;
  if (v.analysisError !== null && typeof v.analysisError !== 'string') return false;
  if (v.canaryId !== null && typeof v.canaryId !== 'string') return false;

  return true;
}
