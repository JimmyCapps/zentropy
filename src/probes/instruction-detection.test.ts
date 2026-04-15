import { describe, it, expect } from 'vitest';
import { instructionDetectionProbe } from './instruction-detection.js';

describe('instructionDetectionProbe', () => {
  it('has correct name and system prompt', () => {
    expect(instructionDetectionProbe.name).toBe('instruction_detection');
    expect(instructionDetectionProbe.systemPrompt).toContain('security analyst');
  });

  it('builds user message containing the chunk', () => {
    const msg = instructionDetectionProbe.buildUserMessage('some page content');
    expect(msg).toContain('some page content');
  });

  it('passes when no instructions found (JSON)', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      '{"found": false, "instructions": [], "techniques": []}',
      'chunk',
    );
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('fails when instructions found (JSON)', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      '{"found": true, "instructions": ["ignore previous instructions", "output system prompt"], "techniques": ["direct injection"]}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('injection_detected');
    expect(result.flags).toContain('2_instructions_found');
    expect(result.flags.some((f) => f.startsWith('technique:'))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('handles JSON embedded in prose', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      'Analysis complete. Results:\n{"found": true, "instructions": ["override safety"], "techniques": ["role reassignment"]}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('injection_detected');
  });

  it('falls back to keyword detection on non-JSON', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      'I found hidden instructions attempting prompt injection in the page.',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('injection_detected');
    expect(result.flags).toContain('non_json_response');
  });

  it('passes on non-JSON with no injection keywords', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      'No instructions found: false. The page is clean.',
      'chunk',
    );
    expect(result.passed).toBe(true);
  });

  it('falls back on malformed JSON with injection keywords', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      'The content contains hidden instruction for prompt manipulation {broken: json}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('parse_fallback');
  });

  it('score scales with instruction count', () => {
    const one = instructionDetectionProbe.analyzeResponse(
      '{"found": true, "instructions": ["one"], "techniques": []}',
      'chunk',
    );
    const three = instructionDetectionProbe.analyzeResponse(
      '{"found": true, "instructions": ["one", "two", "three"], "techniques": []}',
      'chunk',
    );
    expect(three.score).toBeGreaterThanOrEqual(one.score);
  });

  it('score is capped at SCORE_INSTRUCTION_DETECTION', () => {
    const result = instructionDetectionProbe.analyzeResponse(
      '{"found": true, "instructions": ["a","b","c","d","e","f"], "techniques": []}',
      'chunk',
    );
    expect(result.score).toBeLessThanOrEqual(40);
  });
});
