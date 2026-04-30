import { describe, it, expect } from 'vitest';
import {
  extractVisibleText,
  geminiCallConfig,
  GEMINI_PRO_TIMEOUT_MS,
  GEMINI_DEFAULT_TIMEOUT_MS,
} from './run-b5-agent-simulation-helpers.js';

describe('extractVisibleText (issue #84)', () => {
  it('drops <script> blocks including their inner JS', () => {
    const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const out = extractVisibleText(html);
    expect(out).not.toContain('alert');
    expect(out).toContain('Hello');
    expect(out).toContain('World');
  });

  it('drops <style> blocks including their inner CSS', () => {
    const html = '<style>body { color: red; font-family: comic-sans; }</style><p>Visible</p>';
    const out = extractVisibleText(html);
    expect(out).not.toContain('color');
    expect(out).not.toContain('comic-sans');
    expect(out).toContain('Visible');
  });

  it('strips remaining HTML tags', () => {
    const html = '<div class="x"><p>Para <span>span</span></p></div>';
    const out = extractVisibleText(html);
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toContain('Para');
    expect(out).toContain('span');
  });

  it('collapses whitespace runs to single spaces', () => {
    const html = '<p>A   B\n\nC\t\tD</p>';
    const out = extractVisibleText(html);
    expect(out).toBe('A B C D');
  });

  it('produces meaningfully shorter output than the source HTML on a realistic page', () => {
    const html = `<html><head><style>${'x'.repeat(500)}</style></head><body><script>${'y'.repeat(500)}</script><p>The visible body is short.</p></body></html>`;
    const out = extractVisibleText(html);
    expect(out.length).toBeLessThan(html.length / 4);
    expect(out).toContain('The visible body is short.');
  });

  it('handles empty / whitespace-only input without throwing', () => {
    expect(extractVisibleText('')).toBe('');
    expect(extractVisibleText('   ')).toBe('');
  });
});

describe('geminiCallConfig (issue #84)', () => {
  const HTML = '<html><body><p>Page contents.</p></body></html>';

  it('flash models keep raw HTML and use the default 120s timeout', () => {
    const cfg = geminiCallConfig('gemini-3-flash-preview', HTML);
    expect(cfg.timeoutMs).toBe(GEMINI_DEFAULT_TIMEOUT_MS);
    expect(cfg.payloadHtml).toBe(HTML);
  });

  it('pro models pre-extract visible text to shrink the prompt', () => {
    const cfg = geminiCallConfig('gemini-3.1-pro-preview', HTML);
    expect(cfg.payloadHtml).not.toContain('<html>');
    expect(cfg.payloadHtml).toContain('Page contents.');
  });

  it('pro models bump the timeout to GEMINI_PRO_TIMEOUT_MS so unbounded thinking does not silently stall', () => {
    const cfg = geminiCallConfig('gemini-3.1-pro-preview', HTML);
    expect(cfg.timeoutMs).toBe(GEMINI_PRO_TIMEOUT_MS);
    expect(GEMINI_PRO_TIMEOUT_MS).toBeGreaterThan(GEMINI_DEFAULT_TIMEOUT_MS);
  });

  it('matches the /pro/ heuristic (any model id containing "pro" gets the pro path)', () => {
    const variants = ['gemini-3-pro', 'gemini-3.1-pro-preview', 'GEMINI-PRO'];
    for (const v of variants) {
      const cfg = geminiCallConfig(v, HTML);
      expect(cfg.timeoutMs, `model=${v}`).toBe(GEMINI_PRO_TIMEOUT_MS);
    }
  });
});
