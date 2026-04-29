// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { renderHunterSummary } from './hunter-findings';

function makeBody(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'hunter-findings-body';
  div.className = 'placeholder';
  div.textContent = 'No hunter data yet — N1 pending.';
  return div;
}

describe('renderHunterSummary (issue #144)', () => {
  it('renders three colour-coded rows + meta line for mixed counts', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 3,
      uncertain: 1,
      flagged: 0,
      totalChunks: 4,
      skippedChunks: 3,
    });
    const rows = body.querySelectorAll('.hunter-finding-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].className).toContain('benign');
    expect(rows[0].textContent).toContain('Benign:');
    expect(rows[0].textContent).toContain('3');
    expect(rows[1].className).toContain('uncertain');
    expect(rows[1].textContent).toContain('1');
    expect(rows[2].className).toContain('flagged');
    expect(rows[2].className).toContain('dim');
    expect(body.querySelector('.hunter-finding-meta')!.textContent).toBe(
      '4 chunks scanned (3 skipped)',
    );
    expect(body.className).toBe('');
  });

  it('renders all-zero counts with every row dimmed and meta without skipped', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 0,
      uncertain: 0,
      flagged: 0,
      totalChunks: 0,
      skippedChunks: 0,
    });
    const rows = body.querySelectorAll('.hunter-finding-row');
    expect(rows).toHaveLength(3);
    rows.forEach((r) => expect(r.className).toContain('dim'));
    expect(body.querySelector('.hunter-finding-meta')!.textContent).toBe('0 chunks scanned');
  });

  it('shows "No hunter data yet." when hunterSummary is undefined (legacy verdict)', () => {
    const body = makeBody();
    renderHunterSummary(body, undefined);
    expect(body.textContent).toBe('No hunter data yet.');
    expect(body.className).toBe('placeholder');
    expect(body.querySelector('.hunter-finding-row')).toBeNull();
  });

  it('shows "Hunter analysis skipped (no chunks)." when hunterSummary is null', () => {
    const body = makeBody();
    renderHunterSummary(body, null);
    expect(body.textContent).toBe('Hunter analysis skipped (no chunks).');
    expect(body.className).toBe('placeholder');
  });

  it('replaces previous render on re-call (idempotency)', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 3,
      uncertain: 1,
      flagged: 0,
      totalChunks: 4,
      skippedChunks: 0,
    });
    renderHunterSummary(body, undefined);
    expect(body.querySelectorAll('.hunter-finding-row')).toHaveLength(0);
    expect(body.textContent).toBe('No hunter data yet.');
  });
});

describe('renderHunterSummary early-exit badge (issue #145)', () => {
  it('renders early-exit badge when notScannedChunks > 0', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 1,
      uncertain: 0,
      flagged: 1,
      totalChunks: 4,
      skippedChunks: 0,
      notScannedChunks: 2,
    });
    const badge = body.querySelector('.hunter-finding-meta-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Early exit: high-confidence compromise');
    expect(body.querySelector('.hunter-finding-meta')!.textContent).toContain(
      '4 chunks scanned',
    );
  });

  it('omits early-exit badge when notScannedChunks is 0', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 3,
      uncertain: 1,
      flagged: 0,
      totalChunks: 4,
      skippedChunks: 3,
      notScannedChunks: 0,
    });
    expect(body.querySelector('.hunter-finding-meta-badge')).toBeNull();
  });

  it('omits early-exit badge when notScannedChunks is undefined (legacy verdict)', () => {
    const body = makeBody();
    renderHunterSummary(body, {
      benign: 3,
      uncertain: 1,
      flagged: 0,
      totalChunks: 4,
      skippedChunks: 3,
    });
    expect(body.querySelector('.hunter-finding-meta-badge')).toBeNull();
  });
});
