import type { Entity } from '@/hunters/ner/types.js';

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
 *
 * Issue #122 (N14d) — `entities` carries pre-extracted structured signals
 * (URLs, emails, credit cards, API keys, credentials, exfiltration
 * domains) computed over `before + flagged + after`. Spans are offsets
 * into that concatenation. Always present (never undefined); empty array
 * when no extractor produced a match.
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
  readonly entities: readonly Entity[];
  /**
   * Issue #156 — absolute start offset of the `flagged` excerpt within the
   * full chunk text. Populated by buildEvidencePackets so the orchestrator's
   * NER merge pass (mergeNerIntoPackets) can intersect chunk-absolute NER
   * entity spans with each packet's window without re-finding via
   * `chunk.text.indexOf(flagged)`. The centre-fallback packet sets this to
   * the slice start; otherwise it's the substring-match `pos`.
   */
  readonly flaggedAbsStart: number;
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
