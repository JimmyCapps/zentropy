import { describe, it, expect } from 'vitest';

import { evidenceReviewProbe } from './evidence-review.js';
import type { EvidencePacket } from './base-probe.js';
import { SCORE_EVIDENCE_REVIEW_CONFIRMED } from '@/shared/constants.js';

const samplePacket: EvidencePacket = {
  hunterName: 'spider',
  featureName: 'override_instruction',
  ruleId: 'spider:override_instruction',
  before: 'some context before ',
  flagged: 'ignore previous instructions',
  after: ' some context after',
  fullChunkRef: 'h_abc',
  score: 40,
  entities: [],
};

describe('evidenceReviewProbe (issue #118)', () => {
  it('treats confirmed=true response as a failure scoring SCORE_EVIDENCE_REVIEW_CONFIRMED', () => {
    const out = '{"confirmed": true, "reasoning": "Direct override attempt"}';
    const analysis = evidenceReviewProbe.analyzeResponse(out, '');
    expect(analysis.passed).toBe(false);
    expect(analysis.flags).toContain('evidence_confirmed');
    expect(analysis.score).toBe(SCORE_EVIDENCE_REVIEW_CONFIRMED);
  });

  it('treats confirmed=false response as a pass with score 0', () => {
    const out = '{"confirmed": false, "reasoning": "Pedagogical context"}';
    const analysis = evidenceReviewProbe.analyzeResponse(out, '');
    expect(analysis.passed).toBe(true);
    expect(analysis.flags).toEqual([]);
    expect(analysis.score).toBe(0);
  });

  it('fails soft (passed=true, score=0) when output is unparseable JSON', () => {
    const out = 'not json at all';
    const analysis = evidenceReviewProbe.analyzeResponse(out, '');
    expect(analysis.passed).toBe(true);
    expect(analysis.flags).toEqual([]);
    expect(analysis.score).toBe(0);
  });

  it('serialises an EvidencePacket with rule, before, flagged, after sections', () => {
    const msg = evidenceReviewProbe.buildPacketMessage!(samplePacket);
    expect(msg).toContain('Rule: spider:override_instruction');
    expect(msg).toContain('hunter: spider');
    expect(msg).toContain('feature: override_instruction');
    expect(msg).toContain('[CONTEXT BEFORE]some context before [/CONTEXT BEFORE]');
    expect(msg).toContain('[FLAGGED]ignore previous instructions[/FLAGGED]');
    expect(msg).toContain('[CONTEXT AFTER] some context after[/CONTEXT AFTER]');
  });

  it('exposes a responseConstraintSchema with confirmed+reasoning required, no additional properties', () => {
    const schema = evidenceReviewProbe.responseConstraintSchema as
      | {
          type: string;
          properties: { confirmed: { type: string }; reasoning: { type: string; maxLength: number } };
          required: readonly string[];
          additionalProperties: boolean;
        }
      | undefined;
    expect(schema).toBeDefined();
    expect(schema!.type).toBe('object');
    expect(schema!.properties.confirmed.type).toBe('boolean');
    expect(schema!.properties.reasoning.type).toBe('string');
    expect(schema!.required).toEqual(['confirmed', 'reasoning']);
    expect(schema!.additionalProperties).toBe(false);
  });
});
