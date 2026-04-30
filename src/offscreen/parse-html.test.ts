// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseHtmlToSnapshot } from './parse-html.js';

describe('parseHtmlToSnapshot', () => {
  it('returns a PageSnapshot with metadata derived from the URL parameter', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Example Domain</title>
      <meta name="description" content="Sample description">
      <meta property="og:title" content="OG Title">
    </head><body><p>hello world</p></body></html>`;
    const snap = parseHtmlToSnapshot(html, 'https://example.com/page?q=1');
    expect(snap.metadata.url).toBe('https://example.com/page?q=1');
    expect(snap.metadata.origin).toBe('https://example.com');
    expect(snap.metadata.title).toBe('Example Domain');
    expect(snap.metadata.description).toBe('Sample description');
    expect(snap.metadata.lang).toBe('en');
    expect(snap.metadata.ogTags.get('og:title')).toBe('OG Title');
  });

  it('extracts visible text from the body (no layout filter)', () => {
    const html = `<!doctype html><html><body>
      <h1>Welcome</h1>
      <p>This is <strong>bold</strong> text.</p>
      <script>console.log('skip me')</script>
      <style>.x{color:red}</style>
      <noscript>noscript content</noscript>
    </body></html>`;
    const snap = parseHtmlToSnapshot(html, 'https://x.example/');
    expect(snap.visibleText).toContain('Welcome');
    expect(snap.visibleText).toContain('bold');
    expect(snap.visibleText).not.toContain('skip me');
    expect(snap.visibleText).not.toContain('color:red');
    expect(snap.visibleText).not.toContain('noscript content');
  });

  it('extracts hidden text via attribute heuristics', () => {
    const html = `<!doctype html><html><body>
      <p>visible para</p>
      <div hidden>HIDDEN-ATTR</div>
      <div aria-hidden="true">ARIA-HIDDEN</div>
      <span style="display:none">STYLE-NONE</span>
      <span style="visibility: hidden">STYLE-VISHIDDEN</span>
      <span class="sr-only">SR-ONLY</span>
    </body></html>`;
    const snap = parseHtmlToSnapshot(html, 'https://x.example/');
    expect(snap.hiddenText).toContain('HIDDEN-ATTR');
    expect(snap.hiddenText).toContain('ARIA-HIDDEN');
    expect(snap.hiddenText).toContain('STYLE-NONE');
    expect(snap.hiddenText).toContain('STYLE-VISHIDDEN');
    expect(snap.hiddenText).toContain('SR-ONLY');
    expect(snap.visibleText).toContain('visible para');
    expect(snap.visibleText).not.toContain('HIDDEN-ATTR');
  });

  it('extracts script fingerprints with sha-256 hash and src', () => {
    const html = `<!doctype html><html><body>
      <script src="https://cdn.example/lib.js"></script>
      <script>console.log('inline')</script>
    </body></html>`;
    const snap = parseHtmlToSnapshot(html, 'https://x.example/');
    expect(snap.scriptFingerprints).toHaveLength(2);
    const external = snap.scriptFingerprints.find((s) => s.src !== null);
    expect(external?.src).toBe('https://cdn.example/lib.js');
    expect(external?.length).toBe(0);
    expect(external?.hash).toBe('');
    const inline = snap.scriptFingerprints.find((s) => s.src === null);
    expect(inline?.length).toBeGreaterThan(0);
    expect(inline?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inline?.preview).toContain('inline');
  });

  it('populates extractedAt and charCount', () => {
    const before = Date.now();
    const snap = parseHtmlToSnapshot(
      '<!doctype html><html><body><p>hi</p></body></html>',
      'https://x.example/',
    );
    expect(snap.extractedAt).toBeGreaterThanOrEqual(before);
    expect(snap.charCount).toBe(snap.visibleText.length + snap.hiddenText.length);
  });

  it('returns origin "null" sentinel when URL is not a parseable URL', () => {
    const snap = parseHtmlToSnapshot(
      '<!doctype html><html><body><p>x</p></body></html>',
      'not-a-url',
    );
    // We still return a snapshot; the origin is the raw URL fallback.
    expect(snap.metadata.url).toBe('not-a-url');
    expect(snap.metadata.origin).toBe('not-a-url');
  });

  it('returns empty extraction for a page with no <body>', () => {
    const snap = parseHtmlToSnapshot(
      '<!doctype html><html><head><title>t</title></head></html>',
      'https://x.example/',
    );
    expect(snap.visibleText).toBe('');
    expect(snap.hiddenText).toBe('');
    expect(snap.metadata.title).toBe('t');
  });
});
