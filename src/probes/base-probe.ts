export interface ProbeAnalysis {
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly score: number;
}

/**
 * Issue #118 (N12) — focused-context packet built from a Hunter finding.
 * `before`/`after` are up to 200 chars of surrounding chunk text; `flagged`
 * is the located activation excerpt (or chunk-centre 400 when substring
 * search misses, see `evidence-builder.ts`). The packet is the input to
 * the `evidence-review` probe.
 */
export interface EvidencePacket {
  readonly hunterName: string;
  readonly featureName: string;
  readonly ruleId: string;
  readonly before: string;
  readonly flagged: string;
  readonly after: string;
  readonly fullChunkRef: string;
  readonly score: number;
}

export interface Probe {
  readonly name: string;
  readonly systemPrompt: string;
  /**
   * Issue #118 — when present, signals to the engine layer that the probe
   * wants Nano `responseConstraint` JSON-Schema enforcement. MLC adapter
   * ignores this field and falls back to the regex+JSON.parse pattern in
   * `analyzeResponse`. Closes #44 by absorbing it into the new probe path.
   */
  readonly responseConstraintSchema?: object;
  buildUserMessage(chunk: string): string;
  /**
   * Issue #118 — packet-aware probes (currently only `evidence_review`)
   * implement this to serialise an EvidencePacket as the user message.
   * The probe-runner short-circuits to this path when called with a
   * non-empty packets array.
   */
  buildPacketMessage?(packet: EvidencePacket): string;
  analyzeResponse(output: string, originalChunk: string): ProbeAnalysis;
}
