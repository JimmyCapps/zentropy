import { describe, expect, it } from 'vitest';

import {
  isResponseVerdict,
  isThinkingVerdict,
  type ResponseVerdict,
  type ThinkingVerdict,
} from './portal-response.js';

const VALID: ResponseVerdict = {
  portalId: 'chatgpt',
  status: 'CLEAN',
  confidence: 0.92,
  totalScore: 12,
  probeResults: [
    { probeName: 'summarization', passed: true, flags: [], rawOutput: 'ok', score: 0, errorMessage: null },
  ],
  behavioralFlags: {
    roleDrift: false,
    exfiltrationIntent: false,
    instructionFollowing: false,
    hiddenContentAwareness: false,
  },
  timestamp: 1714400000000,
  responseTextHash: 'a'.repeat(64),
  responseTextLength: 1240,
  conversationId: 'abc-123',
  messageId: 'msg-1',
  analysisError: null,
  canaryId: 'gemma-2-2b-mlc',
};

describe('isResponseVerdict', () => {
  it('returns true for a fully populated record', () => {
    expect(isResponseVerdict(VALID)).toBe(true);
  });

  it('returns true when conversationId is null', () => {
    expect(isResponseVerdict({ ...VALID, conversationId: null })).toBe(true);
  });

  it('returns true when analysisError is a string', () => {
    expect(isResponseVerdict({ ...VALID, analysisError: 'engine_failure' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isResponseVerdict(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isResponseVerdict(undefined)).toBe(false);
  });

  it('returns false for non-object primitives', () => {
    expect(isResponseVerdict('string')).toBe(false);
    expect(isResponseVerdict(42)).toBe(false);
    expect(isResponseVerdict(true)).toBe(false);
  });

  it('returns false when portalId is an unknown literal', () => {
    expect(isResponseVerdict({ ...VALID, portalId: 'mystery' })).toBe(false);
  });

  it('returns false when status is not a SecurityStatus', () => {
    expect(isResponseVerdict({ ...VALID, status: 'WAT' })).toBe(false);
  });

  it('returns false when responseTextHash is missing', () => {
    const { responseTextHash: _drop, ...rest } = VALID;
    expect(isResponseVerdict(rest)).toBe(false);
  });

  it('returns false when responseTextHash is the wrong length', () => {
    expect(isResponseVerdict({ ...VALID, responseTextHash: 'abc' })).toBe(false);
  });

  it('returns false when responseTextLength is negative', () => {
    expect(isResponseVerdict({ ...VALID, responseTextLength: -1 })).toBe(false);
  });

  it('returns false when probeResults is not an array', () => {
    expect(isResponseVerdict({ ...VALID, probeResults: 'oops' })).toBe(false);
  });

  it('returns false when behavioralFlags is missing fields', () => {
    expect(
      isResponseVerdict({
        ...VALID,
        behavioralFlags: { roleDrift: false, exfiltrationIntent: false, instructionFollowing: false },
      }),
    ).toBe(false);
  });

  it('returns false when canaryId is not string-or-null', () => {
    expect(isResponseVerdict({ ...VALID, canaryId: 42 })).toBe(false);
  });
});

const VALID_THINKING: ThinkingVerdict = {
  portalId: 'gemini',
  status: 'SUSPICIOUS',
  confidence: 0.61,
  totalScore: 38,
  probeResults: [
    { probeName: 'instruction_detection', passed: false, flags: ['injection_detected'], rawOutput: 'ok', score: 25, errorMessage: null },
  ],
  behavioralFlags: {
    roleDrift: true,
    exfiltrationIntent: false,
    instructionFollowing: false,
    hiddenContentAwareness: false,
  },
  timestamp: 1714400500000,
  thinkingTextHash: 'b'.repeat(64),
  thinkingTextLength: 482,
  conversationId: null,
  messageId: 'gemini-thinking:fallback:I_should_consider',
  analysisError: null,
  canaryId: 'gemma-2-2b-mlc',
};

describe('isThinkingVerdict', () => {
  it('returns true for a fully populated record', () => {
    expect(isThinkingVerdict(VALID_THINKING)).toBe(true);
  });

  it('returns true when conversationId is null', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, conversationId: null })).toBe(true);
  });

  it('returns true when analysisError is a string', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, analysisError: 'thinking_truncated' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isThinkingVerdict(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isThinkingVerdict(undefined)).toBe(false);
  });

  it('returns false when thinkingTextHash is the wrong length', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, thinkingTextHash: 'too short' })).toBe(false);
  });

  it('returns false when thinkingTextLength is negative', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, thinkingTextLength: -2 })).toBe(false);
  });

  it('returns false when portalId is an unknown literal', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, portalId: 'mystery' })).toBe(false);
  });

  it('returns false when probeResults is not an array', () => {
    expect(isThinkingVerdict({ ...VALID_THINKING, probeResults: 'oops' })).toBe(false);
  });

  it('rejects a ResponseVerdict that lacks thinkingTextHash', () => {
    expect(isThinkingVerdict(VALID)).toBe(false);
  });
});
