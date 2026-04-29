// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { renderEntitySummary, rollupEntities } from './entities.js';
import type { Entity } from '@/hunters/ner/types.js';

function makeBody(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'entities-body';
  div.className = 'placeholder';
  div.textContent = 'No entity data yet.';
  return div;
}

describe('renderEntitySummary (issue #122)', () => {
  it('shows "No entity data yet." when summary is undefined (legacy verdict)', () => {
    const body = makeBody();
    renderEntitySummary(body, undefined);
    expect(body.textContent).toBe('No entity data yet.');
    expect(body.className).toBe('placeholder');
  });

  it('shows "No entities extracted." when summary is null', () => {
    const body = makeBody();
    renderEntitySummary(body, null);
    expect(body.textContent).toBe('No entities extracted.');
    expect(body.className).toBe('placeholder');
  });

  it('shows the empty placeholder when counts total to zero', () => {
    const body = makeBody();
    renderEntitySummary(body, { counts: {}, samples: [] });
    expect(body.textContent).toBe('No entities extracted.');
  });

  it('renders count chips and a sample list with type-prefixed labels', () => {
    const body = makeBody();
    const samples: readonly Entity[] = [
      { type: 'url', value: 'https://example.com', span: [0, 19], confidence: 0.9 },
      { type: 'email', value: 'a@b.io', span: [20, 26], confidence: 0.9 },
    ];
    renderEntitySummary(body, {
      counts: { url: 1, email: 1 },
      samples,
    });
    expect(body.querySelector('.entity-counts')).not.toBeNull();
    expect(body.textContent).toContain('URL: 1');
    expect(body.textContent).toContain('Email: 1');
    const sampleItems = body.querySelectorAll('.entity-sample');
    expect(sampleItems).toHaveLength(2);
    expect(body.textContent).toContain('https://example.com');
    expect(body.textContent).toContain('a@b.io');
  });

  it('masks credit_card to **** **** **** <last4>', () => {
    const body = makeBody();
    renderEntitySummary(body, {
      counts: { credit_card: 1 },
      samples: [{
        type: 'credit_card',
        value: '4111111111111111',
        span: [0, 16],
        confidence: 0.95,
        metadata: { luhn_valid: true, network: 'visa' },
      }],
    });
    expect(body.textContent).toContain('**** **** **** 1111');
    expect(body.textContent).not.toContain('4111111111111111');
  });

  it('masks api_key to <head>…<tail>', () => {
    const body = makeBody();
    renderEntitySummary(body, {
      counts: { api_key: 1 },
      samples: [{
        type: 'api_key',
        value: 'AKIAIOSFODNN7EXAMPLE',
        span: [0, 20],
        confidence: 0.95,
      }],
    });
    expect(body.textContent).toContain('AKIA…MPLE');
    expect(body.textContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks credential value-after-= to ***', () => {
    const body = makeBody();
    renderEntitySummary(body, {
      counts: { credential: 1 },
      samples: [{
        type: 'credential',
        value: 'password=hunter2',
        span: [0, 16],
        confidence: 0.9,
      }],
    });
    expect(body.textContent).toContain('password=***');
    expect(body.textContent).not.toContain('hunter2');
  });

  it('T18: renders person entities with raw values (no masking)', () => {
    const body = makeBody();
    const samples: readonly Entity[] = [
      { type: 'person', value: 'Alice Smith', span: [0, 11], confidence: 0.99 },
      { type: 'organization', value: 'Acme Corp', span: [13, 22], confidence: 0.95 },
      { type: 'location', value: 'Tokyo', span: [25, 30], confidence: 0.97 },
      { type: 'misc', value: 'Olympics', span: [35, 43], confidence: 0.9 },
    ];
    renderEntitySummary(body, {
      counts: { person: 1, organization: 1, location: 1, misc: 1 },
      samples,
    });
    expect(body.textContent).toContain('People: 1');
    expect(body.textContent).toContain('Organizations: 1');
    expect(body.textContent).toContain('Locations: 1');
    expect(body.textContent).toContain('Other entities: 1');
    expect(body.textContent).toContain('Alice Smith');
    expect(body.textContent).toContain('Acme Corp');
    expect(body.textContent).toContain('Tokyo');
    expect(body.textContent).toContain('Olympics');
  });

  it('T19: regex-only entities (no NER) — only regex labels appear, no PER/LOC/ORG chips', () => {
    const body = makeBody();
    renderEntitySummary(body, {
      counts: { url: 1, exfil_domain: 1 },
      samples: [
        { type: 'url', value: 'https://x.io', span: [0, 12], confidence: 0.9 },
        { type: 'exfil_domain', value: 'webhook.site', span: [13, 25], confidence: 0.95 },
      ],
    });
    expect(body.textContent).toContain('URL: 1');
    expect(body.textContent).toContain('Exfil domain: 1');
    expect(body.textContent).not.toContain('People');
    expect(body.textContent).not.toContain('Organizations');
    expect(body.textContent).not.toContain('Locations');
  });
});

describe('rollupEntities', () => {
  it('counts entities by type', () => {
    const e: readonly Entity[] = [
      { type: 'url', value: 'https://a.io', span: [0, 12], confidence: 0.9 },
      { type: 'url', value: 'https://b.io', span: [13, 25], confidence: 0.9 },
      { type: 'email', value: 'a@b.io', span: [26, 32], confidence: 0.9 },
    ];
    const summary = rollupEntities(e);
    expect(summary.counts.url).toBe(2);
    expect(summary.counts.email).toBe(1);
  });

  it('deduplicates samples by type+value', () => {
    const e: readonly Entity[] = [
      { type: 'url', value: 'https://x.io', span: [0, 12], confidence: 0.9 },
      { type: 'url', value: 'https://x.io', span: [50, 62], confidence: 0.9 },
    ];
    const summary = rollupEntities(e);
    expect(summary.counts.url).toBe(2);
    expect(summary.samples).toHaveLength(1);
  });

  it('caps samples at 10', () => {
    const e: Entity[] = [];
    for (let i = 0; i < 25; i++) {
      e.push({ type: 'url', value: `https://a${i}.io`, span: [i, i + 1], confidence: 0.9 });
    }
    const summary = rollupEntities(e);
    expect(summary.counts.url).toBe(25);
    expect(summary.samples).toHaveLength(10);
  });

  it('returns empty counts and empty samples for empty input', () => {
    const summary = rollupEntities([]);
    expect(summary.samples).toEqual([]);
  });
});
