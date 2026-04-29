// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

// Vite/vitest's `?raw` query loads the file's contents as a string at
// resolve time; the ambient declaration lives in test-shims.d.ts.
import popupHtml from './popup.html?raw';

function loadPopupDocument(): Document {
  return new DOMParser().parseFromString(popupHtml, 'text/html');
}

describe('popup.html accordion structure (issue #114)', () => {
  it('has a Verdict accordion that is open by default', () => {
    const doc = loadPopupDocument();
    const el = doc.getElementById('accordion-verdict');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('DETAILS');
    expect(el!.hasAttribute('open')).toBe(true);
  });

  it('has six other accordions, all closed by default', () => {
    const doc = loadPopupDocument();
    const ids = [
      'accordion-probes',
      'accordion-behavioral',
      'accordion-hunters',
      'accordion-mitigations',
      'accordion-engine',
      'accordion-policy',
    ];
    for (const id of ids) {
      const el = doc.getElementById(id);
      expect(el, `missing accordion #${id}`).not.toBeNull();
      expect(el!.tagName).toBe('DETAILS');
      expect(el!.hasAttribute('open')).toBe(false);
    }
  });

  it('preserves all inner verdict element ids that popup.ts queries', () => {
    const doc = loadPopupDocument();
    const requiredIds = [
      'confidence-value',
      'confidence-fill',
      'score-info',
      'probe-summarization',
      'probe-detection',
      'probe-adversarial',
      'flag-role-drift',
      'flag-exfiltration',
      'flag-instruction',
      'flags-card',
      'flags-container',
      'timestamp-info',
    ];
    for (const id of requiredIds) {
      expect(doc.getElementById(id), `inner element #${id} must remain accessible`).not.toBeNull();
    }
  });

  it('keeps testing-mode-card as a flat <div> (NOT a <details>) — #113 invariant', () => {
    const doc = loadPopupDocument();
    const el = doc.getElementById('testing-mode-card');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('DIV');
  });

  it('keeps the canary-options container outside any <details> — settings stay flat', () => {
    const doc = loadPopupDocument();
    const canary = doc.getElementById('canary-options');
    expect(canary).not.toBeNull();
    expect(canary!.closest('details')).toBeNull();
  });

  it('keeps site-card as a flat <div> (NOT a <details>) — settings stay flat', () => {
    const doc = loadPopupDocument();
    const el = doc.getElementById('site-card');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('DIV');
  });

  it('has a Rescan button in the header (disabled in HTML)', () => {
    const doc = loadPopupDocument();
    const btn = doc.getElementById('rescan-page-btn');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.hasAttribute('disabled')).toBe(true);
    const h1 = btn!.closest('h1');
    expect(h1, 'rescan-page-btn must live inside the popup <h1> header').not.toBeNull();
  });

  it('places hunter-findings placeholder element inside the Hunter findings accordion', () => {
    const doc = loadPopupDocument();
    const body = doc.getElementById('hunter-findings-body');
    expect(body).not.toBeNull();
    expect(body!.closest('#accordion-hunters')).not.toBeNull();
  });

  it('places mitigations-list element inside the Mitigations applied accordion', () => {
    const doc = loadPopupDocument();
    const list = doc.getElementById('mitigations-list');
    expect(list).not.toBeNull();
    expect(list!.closest('#accordion-mitigations')).not.toBeNull();
  });
});
