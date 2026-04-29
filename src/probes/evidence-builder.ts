import type { Chunk } from '@/types/chunk.js';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { EvidencePacket } from './base-probe.js';
import { MAX_FINDINGS_PROBED_PER_CHUNK } from '@/shared/constants.js';

const CONTEXT_WINDOW_CHARS = 200;
const CENTRE_FALLBACK_CHARS = 400;

/**
 * Issue #118 (N12) — slice ±200 chars of context around each Hunter
 * finding to build evidence packets. Findings carry text excerpts in
 * `HunterFeature.activations` but no span offsets, so we substring-
 * search the chunk text. If the activation isn't found (extraction
 * normalisation drift), fall back to a chunk-centre packet so the LLM
 * still gets focused context to reason over.
 *
 * Findings without usable activations (Hawk-only feature names, or
 * feature.activations === []) are skipped entirely; the orchestrator's
 * empty-array branch falls through to the existing 3-probe stack.
 *
 * Top-N by hunter score; cap is MAX_FINDINGS_PROBED_PER_CHUNK.
 */
export function buildEvidencePackets(
  chunk: Chunk,
  huntReport: HuntReport,
): readonly EvidencePacket[] {
  const candidates: EvidencePacket[] = [];
  for (const result of huntReport.results) {
    if (!result.matched) continue;
    for (const feature of result.features) {
      const activation = feature.activations[0];
      if (!activation) continue;
      const pos = chunk.text.indexOf(activation);
      if (pos === -1) {
        const centre = Math.floor(chunk.text.length / 2);
        const sliceStart = Math.max(0, centre - CENTRE_FALLBACK_CHARS / 2);
        const sliceEnd = Math.min(chunk.text.length, centre + CENTRE_FALLBACK_CHARS / 2);
        candidates.push({
          hunterName: result.hunterName,
          featureName: feature.name,
          ruleId: result.flags[0] ?? `${result.hunterName}:${feature.name}`,
          before: '',
          flagged: chunk.text.slice(sliceStart, sliceEnd),
          after: '',
          fullChunkRef: chunk.contentHash,
          score: result.score,
        });
        continue;
      }
      const beforeStart = Math.max(0, pos - CONTEXT_WINDOW_CHARS);
      const afterEnd = Math.min(chunk.text.length, pos + activation.length + CONTEXT_WINDOW_CHARS);
      candidates.push({
        hunterName: result.hunterName,
        featureName: feature.name,
        ruleId: result.flags[0] ?? `${result.hunterName}:${feature.name}`,
        before: chunk.text.slice(beforeStart, pos),
        flagged: activation,
        after: chunk.text.slice(pos + activation.length, afterEnd),
        fullChunkRef: chunk.contentHash,
        score: result.score,
      });
    }
  }
  return candidates
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FINDINGS_PROBED_PER_CHUNK);
}
