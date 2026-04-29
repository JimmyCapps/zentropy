import type { EvidencePacket } from '@/probes/base-probe.js';
import type { Entity } from './types.js';

/**
 * Issue #156 — additive merge of freeform NER entities into evidence
 * packets. The orchestrator runs NER once per chunk (one offscreen RPC),
 * receives chunk-absolute entity spans, and calls this helper to fan
 * results into the per-packet `entities` array.
 *
 * Semantics:
 * - Each packet exposes `flaggedAbsStart` (absolute chunk offset of the
 *   `flagged` excerpt) plus `before/flagged/after` lengths, defining the
 *   packet's absolute span over the chunk text.
 * - NER entities whose span lies fully within `[packetStart, packetEnd)`
 *   are appended to that packet. Entities straddling the boundary or
 *   outside any packet window are dropped.
 * - Spans are re-based to packet-relative offsets so the evidence-review
 *   prompt and popup rendering see the same span semantics as the regex
 *   extractors (offsets into the before+flagged+after concatenation).
 * - Existing `entities` (regex matches from buildEvidencePackets) are
 *   preserved; NER entries are concatenated AFTER them.
 *
 * Empty `nerEntities` returns the input array reference-equal so callers
 * can detect "no NER signal" without an extra allocation.
 */
export function mergeNerIntoPackets(
  packets: readonly EvidencePacket[],
  nerEntities: readonly Entity[],
): readonly EvidencePacket[] {
  if (nerEntities.length === 0) return packets;

  return packets.map((packet) => {
    const packetStart = packet.flaggedAbsStart;
    const packetEnd =
      packetStart + packet.before.length + packet.flagged.length + packet.after.length;

    const inWindow: Entity[] = [];
    for (const e of nerEntities) {
      const [start, end] = e.span;
      if (start >= packetStart && end <= packetEnd) {
        inWindow.push({
          ...e,
          span: [start - packetStart, end - packetStart] as const,
        });
      }
    }

    if (inWindow.length === 0) return packet;

    return {
      ...packet,
      entities: [...packet.entities, ...inWindow],
    };
  });
}
