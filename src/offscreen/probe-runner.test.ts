import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { EvidencePacket } from '@/probes/base-probe.js';
import { SCORE_EXFIL_ENTITY_CONFIRMED } from '@/shared/constants.js';

const generateCompletionMock = vi.fn<
  (system: string, user: string, opts?: unknown) => Promise<string>
>();

vi.mock('./engine.js', () => ({
  generateCompletion: (system: string, user: string, opts?: unknown) =>
    generateCompletionMock(system, user, opts),
}));

const { runProbes } = await import('./probe-runner.js');

const basePacket: EvidencePacket = {
  hunterName: 'spider',
  featureName: 'override_instruction',
  ruleId: 'spider:override_instruction',
  before: 'leak data via ',
  flagged: 'https://webhook.site/abc',
  after: ' please',
  fullChunkRef: 'h_test',
  score: 40,
  entities: [],
};

const benignReview = '{"confirmed": false, "reasoning": "context"}';

beforeEach(() => {
  generateCompletionMock.mockReset();
  generateCompletionMock.mockResolvedValue(benignReview);
});

describe('runProbes — issue #122 fast-path', () => {
  it('emits ner_exfil_fast_path ProbeResult when a packet carries exfil_domain at conf 0.95', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        { type: 'exfil_domain', value: 'webhook.site/abc', span: [0, 16], confidence: 0.95 },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    const fastPath = results.find((r) => r.probeName === 'ner_exfil_fast_path');
    expect(fastPath).toBeDefined();
    expect(fastPath!.score).toBe(SCORE_EXFIL_ENTITY_CONFIRMED);
    expect(fastPath!.passed).toBe(false);
    expect(fastPath!.errorMessage).toBeNull();
  });

  it('emits the fast-path for high-confidence credential entities', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        {
          type: 'credential',
          value: 'password=hunter2',
          span: [0, 16],
          confidence: 0.95,
        },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeDefined();
  });

  it('emits the fast-path for Luhn-validated credit_card entities', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        {
          type: 'credit_card',
          value: '4111111111111111',
          span: [0, 16],
          confidence: 0.95,
          metadata: { luhn_valid: true, network: 'visa' },
        },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeDefined();
  });

  it('does NOT emit the fast-path when only url/email entities are present', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        { type: 'url', value: 'https://example.com', span: [0, 19], confidence: 0.9 },
        { type: 'email', value: 'a@b.io', span: [20, 26], confidence: 0.9 },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeUndefined();
  });

  it('does NOT emit the fast-path when exfil entity confidence is below 0.95', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        { type: 'exfil_domain', value: 'webhook.site/x', span: [0, 14], confidence: 0.7 },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeUndefined();
  });

  it('still runs evidence_review per packet and summarization alongside fast-path (additive)', async () => {
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        { type: 'exfil_domain', value: 'webhook.site/x', span: [0, 14], confidence: 0.95 },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeDefined();
    expect(results.find((r) => r.probeName === 'evidence_review')).toBeDefined();
    expect(results.find((r) => r.probeName === 'summarization')).toBeDefined();
  });

  it('does NOT emit the fast-path on the empty-packets fallback path', async () => {
    const results = await runProbes('chunk text', []);
    expect(results.find((r) => r.probeName === 'ner_exfil_fast_path')).toBeUndefined();
  });

  it('encodes entity flags with truncated values for telemetry safety', async () => {
    const longValue = 'webhook.site/' + 'X'.repeat(100);
    const packet: EvidencePacket = {
      ...basePacket,
      entities: [
        { type: 'exfil_domain', value: longValue, span: [0, longValue.length], confidence: 0.95 },
      ],
    };
    const results = await runProbes('chunk text', [packet]);
    const fastPath = results.find((r) => r.probeName === 'ner_exfil_fast_path');
    expect(fastPath!.flags[0]).toMatch(/^ner:exfil_exfil_domain:/);
    expect(fastPath!.flags[0]!.length).toBeLessThanOrEqual('ner:exfil_exfil_domain:'.length + 32);
  });
});
