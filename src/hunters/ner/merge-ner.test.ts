import { describe, it, expect } from 'vitest';
import { mergeNerIntoPackets } from './merge-ner.js';
import type { Entity } from './types.js';
import type { EvidencePacket } from '@/probes/base-probe.js';

function packet(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    hunterName: 'spider',
    featureName: 'override_instruction',
    ruleId: 'spider:override_instruction',
    before: 'AAA',
    flagged: 'BBB',
    after: 'CCC',
    fullChunkRef: 'h_test',
    score: 40,
    entities: [],
    flaggedAbsStart: 100,
    ...overrides,
  };
}

function nerEntity(span: readonly [number, number], type: 'person' | 'organization' | 'location' = 'person'): Entity {
  return {
    type,
    value: 'X',
    span,
    confidence: 0.95,
  };
}

describe('mergeNerIntoPackets (issue #156)', () => {
  it('T14: merges NER entity inside packet window with packet-relative span', () => {
    // packet window: [100, 109)  (before+flagged+after = 3+3+3=9 chars)
    const p = packet({ before: 'AAA', flagged: 'BBB', after: 'CCC', flaggedAbsStart: 100 });
    const ner: readonly Entity[] = [nerEntity([102, 105], 'person')];
    const out = mergeNerIntoPackets([p], ner);
    expect(out).toHaveLength(1);
    expect(out[0]!.entities).toHaveLength(1);
    // 102-100 = 2, 105-100 = 5 → packet-relative
    expect(out[0]!.entities[0]!.span).toEqual([2, 5]);
    expect(out[0]!.entities[0]!.type).toBe('person');
  });

  it('T15: drops NER entity outside the packet window', () => {
    const p = packet({ before: 'AAA', flagged: 'BBB', after: 'CCC', flaggedAbsStart: 100 });
    const ner: readonly Entity[] = [
      nerEntity([50, 55], 'person'), // before window
      nerEntity([200, 210], 'organization'), // after window
    ];
    const out = mergeNerIntoPackets([p], ner);
    expect(out[0]!.entities).toEqual([]);
  });

  it('T16: empty NER → returns input reference unchanged', () => {
    const p = packet();
    const out = mergeNerIntoPackets([p], []);
    expect(out).toEqual([p]);
  });

  it('appends NER entities AFTER existing regex entities (does not replace)', () => {
    const regexEntity: Entity = {
      type: 'url',
      value: 'https://x.test',
      span: [0, 14],
      confidence: 0.9,
    };
    const p = packet({
      before: 'visit ',
      flagged: 'https://x.test',
      after: '',
      flaggedAbsStart: 100,
      entities: [regexEntity],
    });
    const ner: readonly Entity[] = [nerEntity([102, 108], 'organization')];
    const out = mergeNerIntoPackets([p], ner);
    expect(out[0]!.entities).toHaveLength(2);
    expect(out[0]!.entities[0]!.type).toBe('url');
    expect(out[0]!.entities[1]!.type).toBe('organization');
  });

  it('handles multi-packet pages: each packet receives only its own window NER', () => {
    const p1 = packet({ before: 'AAA', flagged: 'BBB', after: 'CCC', flaggedAbsStart: 100 });
    const p2 = packet({ before: 'DDD', flagged: 'EEE', after: 'FFF', flaggedAbsStart: 500 });
    const ner: readonly Entity[] = [
      nerEntity([102, 105], 'person'), // in p1
      nerEntity([501, 504], 'location'), // in p2
    ];
    const out = mergeNerIntoPackets([p1, p2], ner);
    expect(out[0]!.entities).toHaveLength(1);
    expect(out[0]!.entities[0]!.type).toBe('person');
    expect(out[1]!.entities).toHaveLength(1);
    expect(out[1]!.entities[0]!.type).toBe('location');
  });

  it('drops NER entity that straddles the window boundary', () => {
    // packet window: [100, 109)
    const p = packet({ before: 'AAA', flagged: 'BBB', after: 'CCC', flaggedAbsStart: 100 });
    const ner: readonly Entity[] = [
      nerEntity([95, 105], 'person'), // starts before window
      nerEntity([105, 115], 'person'), // ends after window
    ];
    const out = mergeNerIntoPackets([p], ner);
    expect(out[0]!.entities).toEqual([]);
  });

  it('preserves the packet structure (only entities field changes)', () => {
    const p = packet({ flaggedAbsStart: 0, before: 'A', flagged: 'B', after: 'C' });
    const ner: readonly Entity[] = [nerEntity([0, 1], 'person')];
    const out = mergeNerIntoPackets([p], ner);
    expect(out[0]!.hunterName).toBe(p.hunterName);
    expect(out[0]!.score).toBe(p.score);
    expect(out[0]!.fullChunkRef).toBe(p.fullChunkRef);
    expect(out[0]!.flaggedAbsStart).toBe(p.flaggedAbsStart);
  });
});
