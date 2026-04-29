// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import type { ResponseVerdict } from '@/types/portal-response.js';
import { renderResponseVerdict } from './response-analysis.js';

const VALID: ResponseVerdict = {
  portalId: 'chatgpt',
  status: 'CLEAN',
  confidence: 0.94,
  totalScore: 0,
  probeResults: [
    { probeName: 'summarization', passed: true, flags: [], rawOutput: 'ok', score: 0, errorMessage: null },
    { probeName: 'instruction_detection', passed: true, flags: [], rawOutput: 'ok', score: 0, errorMessage: null },
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

afterEach(() => {
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
});

function makeBody(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.id = 'response-analysis-body';
  document.body.appendChild(div);
  return div;
}

describe('renderResponseVerdict', () => {
  it('renders the placeholder when verdict is undefined', () => {
    const body = makeBody();
    renderResponseVerdict(body, undefined);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No response');
  });

  it('renders the placeholder when verdict is null', () => {
    const body = makeBody();
    renderResponseVerdict(body, null);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No response');
  });

  it('renders a CLEAN verdict with portal name and char count', () => {
    const body = makeBody();
    renderResponseVerdict(body, VALID);
    expect(body.className).toBe('');
    expect(body.textContent).toContain('CLEAN');
    expect(body.textContent).toContain('ChatGPT');
    expect(body.textContent).toContain('1240');
  });

  it('renders a SUSPICIOUS verdict with the badge class', () => {
    const body = makeBody();
    renderResponseVerdict(body, { ...VALID, status: 'SUSPICIOUS', totalScore: 40 });
    expect(body.querySelector('.response-status-suspicious')).not.toBeNull();
  });

  it('renders a COMPROMISED verdict with the badge class', () => {
    const body = makeBody();
    renderResponseVerdict(body, { ...VALID, status: 'COMPROMISED', totalScore: 80 });
    expect(body.querySelector('.response-status-compromised')).not.toBeNull();
  });

  it('renders an UNKNOWN+error verdict with the analysisError message', () => {
    const body = makeBody();
    renderResponseVerdict(body, { ...VALID, status: 'UNKNOWN', analysisError: 'engine_failure' });
    expect(body.textContent).toContain('engine_failure');
  });

  it('shows the per-probe rows from probeResults', () => {
    const body = makeBody();
    renderResponseVerdict(body, VALID);
    expect(body.textContent).toContain('summarization');
    expect(body.textContent).toContain('instruction_detection');
  });

  it('renders a privacy note about local on-device analysis', () => {
    const body = makeBody();
    renderResponseVerdict(body, VALID);
    expect(body.textContent?.toLowerCase()).toContain('on-device');
  });

  it('shows the right portal display name for claude and gemini', () => {
    const body1 = makeBody();
    renderResponseVerdict(body1, { ...VALID, portalId: 'claude' });
    expect(body1.textContent).toContain('Claude');
    while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
    const body2 = makeBody();
    renderResponseVerdict(body2, { ...VALID, portalId: 'gemini' });
    expect(body2.textContent).toContain('Gemini');
  });

  it('replaces previous DOM on re-render (idempotency)', () => {
    const body = makeBody();
    renderResponseVerdict(body, VALID);
    const firstHtml = body.innerHTML;
    renderResponseVerdict(body, VALID);
    expect(body.innerHTML).toBe(firstHtml);
  });
});
