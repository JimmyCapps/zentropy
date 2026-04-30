import { describe, it, expect } from 'vitest';
import { htmlToText } from '../extract/html-to-text.js';

describe('htmlToText', () => {
  it('strips simple HTML tags', () => {
    expect(htmlToText('<p>hello world</p>')).toBe('hello world');
  });

  it('preserves text from nested elements with whitespace separation', () => {
    const html = '<div><h1>Title</h1><p>Body text.</p></div>';
    const result = htmlToText(html);
    expect(result).toContain('Title');
    expect(result).toContain('Body text.');
  });

  it('drops <script> and <style> contents entirely', () => {
    const html =
      '<div>visible<script>alert("xss")</script><style>.a{color:red}</style>after</div>';
    const result = htmlToText(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color:red');
    expect(result).toContain('visible');
    expect(result).toContain('after');
  });

  it('drops <noscript> contents (often duplicates the script payload)', () => {
    const html = '<div>shown<noscript>hidden</noscript></div>';
    const result = htmlToText(html);
    expect(result).toContain('shown');
    expect(result).not.toContain('hidden');
  });

  it('decodes the common named HTML entities', () => {
    expect(htmlToText('a &amp; b &lt; c &gt; d &quot;e&quot; f&apos;g')).toBe(
      'a & b < c > d "e" f\'g',
    );
  });

  it('decodes &nbsp; to whitespace (collapsed by the trimming pass)', () => {
    expect(htmlToText('a&nbsp;b')).toBe('a b');
  });

  it('decodes numeric character references', () => {
    expect(htmlToText('&#65;&#x42;')).toBe('AB');
  });

  it('collapses runs of whitespace', () => {
    const html = '<p>a   b\n\n\tc</p>';
    expect(htmlToText(html)).toBe('a b c');
  });

  it('returns empty string on empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('returns the input verbatim when there are no tags or entities (whitespace-collapsed)', () => {
    expect(htmlToText('plain text  with  spaces')).toBe('plain text with spaces');
  });
});
