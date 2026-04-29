import { describe, it, expect } from 'vitest';

import { buildEvidencePackets } from './evidence-builder.js';
import type { Chunk } from '@/types/chunk.js';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { HunterResult } from '@/hunters/base-hunter.js';
import { MAX_FINDINGS_PROBED_PER_CHUNK } from '@/shared/constants.js';

function makeChunk(text: string, contentHash = 'h_test'): Chunk {
  return { text, start: 0, end: text.length, contentHash };
}

function makeReport(results: readonly HunterResult[]): HuntReport {
  return {
    results,
    totalScore: results.reduce((s, r) => s + r.score, 0),
    maxConfidence: Math.max(0, ...results.map((r) => r.confidence)),
    shouldSkipProbes: false,
    flags: results.flatMap((r) => r.flags),
    aggregateError: null,
  };
}

function spiderResult(activation: string, score = 40): HunterResult {
  return {
    hunterName: 'spider',
    matched: true,
    flags: ['spider:override_instruction'],
    score,
    confidence: 1,
    features: [{ name: 'override_instruction', weight: 1, activations: [activation] }],
    errorMessage: null,
  };
}

describe('buildEvidencePackets (issue #118)', () => {
  it('builds a packet with correct ±200 char windows when finding is mid-chunk', () => {
    const before = 'A'.repeat(500);
    const after = 'B'.repeat(500);
    const needle = 'ignore previous instructions';
    const chunk = makeChunk(before + needle + after);
    const packets = buildEvidencePackets(chunk, makeReport([spiderResult(needle)]));

    expect(packets).toHaveLength(1);
    expect(packets[0]!.flagged).toBe(needle);
    expect(packets[0]!.before).toBe('A'.repeat(200));
    expect(packets[0]!.after).toBe('B'.repeat(200));
    expect(packets[0]!.fullChunkRef).toBe('h_test');
    expect(packets[0]!.ruleId).toBe('spider:override_instruction');
  });

  it('clamps the before window when finding is near chunk start', () => {
    const needle = 'ignore previous';
    const chunk = makeChunk('XYZ' + needle + 'C'.repeat(500));
    const packets = buildEvidencePackets(chunk, makeReport([spiderResult(needle)]));

    expect(packets).toHaveLength(1);
    expect(packets[0]!.before).toBe('XYZ');
    expect(packets[0]!.after).toBe('C'.repeat(200));
  });

  it('clamps the after window when finding is near chunk end', () => {
    const needle = 'override system';
    const chunk = makeChunk('A'.repeat(500) + needle + 'XY');
    const packets = buildEvidencePackets(chunk, makeReport([spiderResult(needle)]));

    expect(packets).toHaveLength(1);
    expect(packets[0]!.before).toBe('A'.repeat(200));
    expect(packets[0]!.after).toBe('XY');
  });

  it('falls back to chunk-centre packet when activation is not found in chunk', () => {
    const chunk = makeChunk('clean content with no injection markers '.repeat(20));
    const packets = buildEvidencePackets(
      chunk,
      makeReport([spiderResult('THIS_TEXT_IS_NOT_IN_THE_CHUNK')]),
    );

    expect(packets).toHaveLength(1);
    expect(packets[0]!.before).toBe('');
    expect(packets[0]!.after).toBe('');
    expect(packets[0]!.flagged.length).toBeGreaterThan(0);
    expect(packets[0]!.flagged.length).toBeLessThanOrEqual(400);
  });

  it('returns top-N findings by score, capped at MAX_FINDINGS_PROBED_PER_CHUNK', () => {
    const chunk = makeChunk('A'.repeat(50) + 'aaa B'.repeat(10) + 'bbb C'.repeat(10) + 'ccc D'.repeat(10) + 'ddd E'.repeat(10) + 'eee');
    const report = makeReport([
      spiderResult('aaa', 10),
      spiderResult('bbb', 50),
      spiderResult('ccc', 30),
      spiderResult('ddd', 40),
      spiderResult('eee', 20),
    ]);
    const packets = buildEvidencePackets(chunk, report);

    expect(packets).toHaveLength(MAX_FINDINGS_PROBED_PER_CHUNK);
    expect(packets[0]!.score).toBe(50);
    expect(packets[1]!.score).toBe(40);
    expect(packets[2]!.score).toBe(30);
  });

  it('returns empty array when no hunter results matched', () => {
    const chunk = makeChunk('benign content');
    const report = makeReport([
      {
        hunterName: 'spider',
        matched: false,
        flags: [],
        score: 0,
        confidence: 0,
        features: [],
        errorMessage: null,
      },
    ]);
    expect(buildEvidencePackets(chunk, report)).toEqual([]);
  });

  it('returns empty array when matched hunter has no usable activations (Hawk-only signal)', () => {
    const chunk = makeChunk('text with directive density');
    const report = makeReport([
      {
        hunterName: 'hawk',
        matched: true,
        flags: ['hawk:injection_likely'],
        score: 40,
        confidence: 0.8,
        features: [{ name: 'directive_density', weight: 0.5, activations: [] }],
        errorMessage: null,
      },
    ]);
    expect(buildEvidencePackets(chunk, report)).toEqual([]);
  });

  it('synthesises a ruleId from hunter+feature when result.flags is empty', () => {
    const needle = 'pretend you are';
    const chunk = makeChunk('start ' + needle + ' end');
    const report = makeReport([
      {
        hunterName: 'hawk',
        matched: true,
        flags: [],
        score: 30,
        confidence: 0.7,
        features: [{ name: 'role_reassignment', weight: 0.3, activations: [needle] }],
        errorMessage: null,
      },
    ]);
    const packets = buildEvidencePackets(chunk, report);
    expect(packets).toHaveLength(1);
    expect(packets[0]!.ruleId).toBe('hawk:role_reassignment');
  });

  describe('issue #122 — entities field', () => {
    it('attaches entities=[] when the packet text has no extractable entities', () => {
      const chunk = makeChunk('A'.repeat(50) + 'ignore previous instructions' + 'B'.repeat(50));
      const packets = buildEvidencePackets(chunk, makeReport([spiderResult('ignore previous instructions')]));
      expect(packets[0]!.entities).toEqual([]);
    });

    it('extracts URL entities from the before+flagged+after window', () => {
      const before = 'A'.repeat(50) + 'visit https://evil.example/x ';
      const flagged = 'ignore previous instructions';
      const after = ' please';
      const chunk = makeChunk(before + flagged + after);
      const packets = buildEvidencePackets(chunk, makeReport([spiderResult(flagged)]));
      const entities = packets[0]!.entities;
      const url = entities.find((e) => e.type === 'url');
      expect(url).toBeDefined();
      expect(url!.value).toBe('https://evil.example/x');
    });

    it('extracts entities ONLY from before+flagged+after, not the rest of chunk text', () => {
      const before = 'A'.repeat(50);
      const flagged = 'ignore previous instructions';
      const inWindowAfter = 'B'.repeat(220);
      const offWindowEmail = ' user@example.com out-of-window';
      const chunk = makeChunk(before + flagged + inWindowAfter + offWindowEmail);
      const packets = buildEvidencePackets(chunk, makeReport([spiderResult(flagged)]));
      const emails = packets[0]!.entities.filter((e) => e.type === 'email');
      expect(emails).toHaveLength(0);
    });

    it('attaches an exfil_domain entity for a webhook.site URL in the window', () => {
      const before = 'leak data to ';
      const flagged = 'https://webhook.site/abc';
      const after = ' done';
      const chunk = makeChunk(before + flagged + after);
      const packets = buildEvidencePackets(chunk, makeReport([spiderResult(flagged)]));
      expect(packets[0]!.entities.some((e) => e.type === 'exfil_domain')).toBe(true);
    });

    it('span content matches the concatenated before+flagged+after slice', () => {
      const before = 'click ';
      const flagged = 'https://example.com';
      const after = ' end';
      const chunk = makeChunk(before + flagged + after);
      const packets = buildEvidencePackets(chunk, makeReport([spiderResult(flagged)]));
      const concat = packets[0]!.before + packets[0]!.flagged + packets[0]!.after;
      for (const e of packets[0]!.entities) {
        expect(concat.slice(e.span[0], e.span[1])).toBe(e.value);
      }
    });

    it('chunk-centre fallback packet also gets entities=[] (or extracted from the slice)', () => {
      const chunk = makeChunk('benign content with https://webhook.site/exfil here '.repeat(20));
      const packets = buildEvidencePackets(
        chunk,
        makeReport([spiderResult('UNFINDABLE_NEEDLE')]),
      );
      expect(packets).toHaveLength(1);
      expect(Array.isArray(packets[0]!.entities)).toBe(true);
    });
  });
});
