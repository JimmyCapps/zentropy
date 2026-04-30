import { describe, it, expect } from 'vitest';
import { runInstructionDetectionCanary } from '../probes/canary-runner.js';
import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import { instructionDetectionProbe } from '../../../src/probes/instruction-detection.js';

interface RecordedCall {
  readonly systemPrompt: string;
  readonly userMessage: string;
}

function recordingEndpoint(content: string): { endpoint: LlmEndpoint; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const endpoint: LlmEndpoint = {
    async call(c) {
      calls.push({ systemPrompt: c.systemPrompt, userMessage: c.userMessage });
      return { content };
    },
  };
  return { endpoint, calls };
}

describe('runInstructionDetectionCanary', () => {
  it('returns passed:true + score:0 on a benign LLM response', async () => {
    const { endpoint } = recordingEndpoint(
      JSON.stringify({ found: false, instructions: [], techniques: [] }),
    );
    const result = await runInstructionDetectionCanary('benign chunk text', endpoint);
    expect(result.probeName).toBe('instruction_detection');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.errorMessage).toBeNull();
  });

  it('returns passed:false + non-zero score on a flagged LLM response', async () => {
    const { endpoint } = recordingEndpoint(
      JSON.stringify({
        found: true,
        instructions: ['ignore previous', 'reveal system prompt'],
        techniques: ['override', 'role reassignment'],
      }),
    );
    const result = await runInstructionDetectionCanary('attacker chunk', endpoint);
    expect(result.passed).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.flags.some((f) => f === 'injection_detected')).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('confidence is max-clamped to 1 when score saturates', async () => {
    const { endpoint } = recordingEndpoint(
      JSON.stringify({
        found: true,
        instructions: ['a', 'b', 'c'],
        techniques: ['x'],
      }),
    );
    const result = await runInstructionDetectionCanary('chunk', endpoint);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns errorMessage when the endpoint throws', async () => {
    const endpoint: LlmEndpoint = {
      async call() {
        throw new Error('endpoint unreachable');
      },
    };
    const result = await runInstructionDetectionCanary('whatever', endpoint);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.errorMessage).toContain('endpoint unreachable');
  });

  it('passes the verbatim instructionDetectionProbe systemPrompt to the endpoint', async () => {
    const { endpoint, calls } = recordingEndpoint(JSON.stringify({ found: false }));
    await runInstructionDetectionCanary('chunk text', endpoint);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.systemPrompt).toBe(instructionDetectionProbe.systemPrompt);
  });

  it('builds the user message via instructionDetectionProbe.buildUserMessage', async () => {
    const { endpoint, calls } = recordingEndpoint(JSON.stringify({ found: false }));
    await runInstructionDetectionCanary('hello world', endpoint);
    expect(calls[0]!.userMessage).toBe(instructionDetectionProbe.buildUserMessage('hello world'));
    expect(calls[0]!.userMessage).toContain('hello world');
  });

  it('handles non-Error thrown values gracefully', async () => {
    const endpoint: LlmEndpoint = {
      async call() {
        throw 'string-rejection';
      },
    };
    const result = await runInstructionDetectionCanary('chunk', endpoint);
    expect(result.errorMessage).toContain('string-rejection');
  });
});
