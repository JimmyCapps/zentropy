// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import type { ThinkingVerdict } from '@/types/portal-response.js';
import { renderThinkingVerdict } from './thinking-analysis.js';

const VALID: ThinkingVerdict = {
  portalId: 'gemini',
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
  thinkingTextHash: 'a'.repeat(64),
  thinkingTextLength: 482,
  conversationId: 'abc-123',
  messageId: 'gemini-thinking:I_should_consider',
  analysisError: null,
  canaryId: 'gemma-2-2b-mlc',
};

afterEach(() => {
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
});

function makeBody(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.id = 'thinking-analysis-body';
  document.body.appendChild(div);
  return div;
}

describe('renderThinkingVerdict', () => {
  it('renders the placeholder when verdict is undefined', () => {
    const body = makeBody();
    renderThinkingVerdict(body, undefined);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No thinking');
  });

  it('renders the placeholder when verdict is null', () => {
    const body = makeBody();
    renderThinkingVerdict(body, null);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No thinking');
  });

  it('renders a CLEAN verdict with portal name and char count', () => {
    const body = makeBody();
    renderThinkingVerdict(body, VALID);
    expect(body.className).toBe('');
    expect(body.textContent).toContain('CLEAN');
    expect(body.textContent).toContain('Gemini');
    expect(body.textContent).toContain('482');
  });

  it('renders a SUSPICIOUS verdict with the badge class', () => {
    const body = makeBody();
    renderThinkingVerdict(body, { ...VALID, status: 'SUSPICIOUS', totalScore: 40 });
    expect(body.querySelector('.thinking-status-suspicious')).not.toBeNull();
  });

  it('renders a COMPROMISED verdict with the badge class', () => {
    const body = makeBody();
    renderThinkingVerdict(body, { ...VALID, status: 'COMPROMISED', totalScore: 80 });
    expect(body.querySelector('.thinking-status-compromised')).not.toBeNull();
  });

  it('renders an UNKNOWN+error verdict with the analysisError message', () => {
    const body = makeBody();
    renderThinkingVerdict(body, {
      ...VALID,
      status: 'UNKNOWN',
      probeResults: [],
      analysisError: 'engine_failure: timeout',
    });
    const err = body.querySelector('.thinking-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('engine_failure: timeout');
  });

  it('renders per-probe rows', () => {
    const body = makeBody();
    renderThinkingVerdict(body, VALID);
    const rows = body.querySelectorAll('.thinking-probe-row');
    expect(rows.length).toBe(2);
  });

  it('does not render captured thinking text in the default render', () => {
    // Privacy posture: thinking text is sensitive enough that the popup
    // never rolls out an excerpt by default. The accordion shows portal,
    // chars, score, per-probe rows, and a privacy note — but no body text.
    const body = makeBody();
    renderThinkingVerdict(body, {
      ...VALID,
      messageId: 'gemini-thinking:secret_user_prompt_text_should_not_render',
    });
    expect(body.textContent ?? '').not.toContain('secret_user_prompt_text_should_not_render');
  });

  it('uses thinking- prefix on every CSS class (no collision with response-)', () => {
    const body = makeBody();
    renderThinkingVerdict(body, VALID);
    expect(body.querySelector('.response-header')).toBeNull();
    expect(body.querySelector('.response-portal-name')).toBeNull();
    expect(body.querySelector('.thinking-header')).not.toBeNull();
    expect(body.querySelector('.thinking-portal-name')).not.toBeNull();
    expect(body.querySelector('.thinking-privacy-note')).not.toBeNull();
  });
});
