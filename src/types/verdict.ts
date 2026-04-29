import type { PageStamp } from './page-stamp.js';

export type SecurityStatus = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';

// Phase 4 Stage 4E — mirrors AdapterMode in src/offscreen/webgpu-introspection.ts.
// Kept as a type-only duplicate here so src/types/ stays dependency-free
// (offscreen/ pulls @mlc-ai/web-llm, which doesn't load in consumers that only
// need the verdict shape, e.g. content/popup).
export type WebGPUAdapterMode = 'core' | 'compatibility' | 'none' | 'unknown';

export interface ProbeResult {
  readonly probeName: string;
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly rawOutput: string;
  readonly score: number;
  // Phase 4 Stage 4A — engine-failure propagation.
  // Populated when the probe invocation threw (engine failure, timeout, etc.).
  // Null on successful probes. `passed: false, flags: [], score: 0` accompanies
  // a non-null errorMessage so downstream consumers can detect it structurally
  // without parsing the flags array.
  readonly errorMessage: string | null;
}

// Issue #112 (N1) — per-chunk tier routing produced by Hunters before the
// LLM tier runs. BENIGN chunks skip probes entirely; UNCERTAIN/FLAGGED
// chunks proceed to runChunkProbes for confirmation.
export type TierDecision = 'BENIGN' | 'UNCERTAIN' | 'FLAGGED';

export interface TierRouting {
  readonly decision: TierDecision;
  readonly primitiveCount: number;
  readonly contributingHunters: readonly string[];
}

export interface ChunkAnalysis {
  readonly index: number;
  readonly contentHash: string;
  readonly tierRouting: TierRouting;
  // Null when the chunk was routed BENIGN and probes were intentionally skipped.
  readonly probeResults: readonly ProbeResult[] | null;
  // Issue #145 — true when the chunk loop short-circuited on a prior chunk's
  // HuntReport.shouldSkipProbes and this entry was padded out so
  // perChunkAnalysis.length === chunks.length. Hunters never ran on this
  // chunk; probeResults is null. tierRouting is reused from the trigger
  // chunk and should be excluded from hunterSummary tier counts.
  readonly notScanned?: true;
}

export interface BehavioralFlags {
  readonly roleDrift: boolean;
  readonly exfiltrationIntent: boolean;
  readonly instructionFollowing: boolean;
  readonly hiddenContentAwareness: boolean;
}

export interface SecurityVerdict {
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: BehavioralFlags;
  readonly mitigationsApplied: readonly string[];
  readonly timestamp: number;
  readonly url: string;
  // Phase 4 Stage 4A — aggregate error signal across the probe pipeline.
  // Null when at least one probe on at least one chunk produced real output.
  // Non-null when every probe on every chunk errored; status will be 'UNKNOWN'
  // with confidence=0. In the mixed case (some probes errored, others produced
  // output), analysisError is populated *and* a score-derived status is kept
  // so operators see both signals.
  readonly analysisError: string | null;
  // Phase 4 Stage 4D.3 — records which canary actually produced this verdict.
  // May differ from the user's preference if the selector's fallback chain
  // kicked in (e.g. user chose Nano but their profile has no EPP access, so
  // the selector fell back to Gemma). Null on verdicts produced before 4D.3,
  // or when the engine's canary id wasn't available at verdict time.
  readonly canaryId: string | null;
  // Issue #59 — WebGPU adapter mode observed at engine init, forwarded here
  // so #8's Chromium-family audit can tabulate verdicts per adapter class
  // without a console scrape. Null on verdicts produced before #59, on the
  // Nano-only path where no WebGPU probe ran, or when the introspection
  // result wasn't available at verdict-assembly time.
  readonly webgpuAdapterMode: WebGPUAdapterMode | null;
  // Issue #117 (N13) — HMAC-SHA256 page stamp produced after the verdict
  // was scored. Null when no stamp was issued: origin-skipped verdicts
  // (the scan was not attempted) and verdicts where ensureInstallSecret
  // failed (we couldn't issue a stamp for operational reasons). Engine-
  // failure UNKNOWN verdicts (a scan was attempted) DO carry a stamp.
  readonly stamp: PageStamp | null;
  // Issue #112 (N1) — per-chunk tier-routing records produced by the
  // Hunter pre-pass. Sized to chunks.length on attempted scans. Null on
  // origin-skipped verdicts where the chunk loop never ran.
  readonly perChunkAnalysis: readonly ChunkAnalysis[] | null;
}

export interface AISecurityReport {
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly timestamp: number;
  readonly url: string;
  readonly probes: {
    readonly summarization: { readonly passed: boolean; readonly flags: readonly string[] };
    readonly instructionDetection: { readonly passed: boolean; readonly found: readonly string[] };
    readonly adversarialCompliance: { readonly passed: boolean; readonly flags: readonly string[] };
  };
  readonly analysis: {
    readonly roleDrift: boolean;
    readonly exfiltrationIntent: boolean;
    readonly instructionFollowing: boolean;
  };
  readonly mitigationsApplied: readonly string[];
  // Phase 4 Stage 4A — surfaces analysisError from the underlying verdict so
  // content-script consumers of `__AI_SECURITY_REPORT__` can distinguish a
  // legitimate CLEAN from a failure-masked CLEAN.
  readonly analysisError: string | null;
  // Phase 4 Stage 4D.3 — mirrors SecurityVerdict.canaryId so page scripts can
  // see which on-device canary produced the analysis.
  readonly canaryId: string | null;
  // Issue #59 — mirrors SecurityVerdict.webgpuAdapterMode for page scripts.
  readonly webgpuAdapterMode: WebGPUAdapterMode | null;
}
