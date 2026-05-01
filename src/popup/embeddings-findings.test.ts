// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { renderEmbeddingsFindings } from './embeddings-findings';
import type { EmbeddingsFinding } from '@/hunters/embeddings/types';

function makeBody(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'embeddings-findings-body';
  div.className = 'placeholder';
  div.textContent = 'Loading…';
  return div;
}

const F1: EmbeddingsFinding = {
  chunkIndex: 0,
  topId: 'injection-0042',
  topScore: 0.91,
  topLang: 'es',
  topTechniques: ['role-play'],
  activations: ['injection-0042@0.910', 'injection-0017@0.880'],
};

const F2: EmbeddingsFinding = {
  chunkIndex: 3,
  topId: 'injection-0099',
  topScore: 0.87,
  topLang: 'zh-CN',
  topTechniques: ['system-override', 'role-play'],
  activations: ['injection-0099@0.870'],
};

describe('renderEmbeddingsFindings', () => {
  it('renders one row per finding with chunk index, top id, score and lang', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [F1, F2]);
    const rows = body.querySelectorAll('.embeddings-finding-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('chunk 0');
    expect(rows[0].textContent).toContain('injection-0042');
    expect(rows[0].textContent).toContain('0.910');
    expect(rows[0].textContent).toContain('es');
    expect(rows[1].textContent).toContain('chunk 3');
    expect(rows[1].textContent).toContain('injection-0099');
    expect(rows[1].textContent).toContain('0.870');
    expect(rows[1].textContent).toContain('zh-CN');
    expect(body.className).toBe('');
  });

  it('renders technique chips for the top match', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [F2]);
    const chips = body.querySelectorAll('.embeddings-technique-chip');
    expect(chips).toHaveLength(2);
    const labels = Array.from(chips).map((c) => c.textContent);
    expect(labels).toContain('system-override');
    expect(labels).toContain('role-play');
  });

  it('renders the full activations list under each finding', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [F1]);
    const items = body.querySelectorAll('.embeddings-activation-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('injection-0042@0.910');
    expect(items[1].textContent).toBe('injection-0017@0.880');
  });

  it('shows the no-match placeholder for null findings', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, null);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No embeddings matches');
    expect(body.querySelector('.embeddings-finding-row')).toBeNull();
  });

  it('shows the no-match placeholder for an empty findings array', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, []);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No embeddings matches');
  });

  it('shows the legacy placeholder when findings is undefined', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, undefined);
    expect(body.className).toBe('placeholder');
    expect(body.textContent).toContain('No embeddings data yet');
  });

  it('replaces previous render on re-call (idempotency)', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [F1, F2]);
    expect(body.querySelectorAll('.embeddings-finding-row')).toHaveLength(2);
    renderEmbeddingsFindings(body, [F1]);
    expect(body.querySelectorAll('.embeddings-finding-row')).toHaveLength(1);
    renderEmbeddingsFindings(body, null);
    expect(body.querySelectorAll('.embeddings-finding-row')).toHaveLength(0);
  });

  it('formats the top score to three decimal places even when input has fewer', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [{ ...F1, topScore: 0.9 }]);
    const row = body.querySelector('.embeddings-finding-row')!;
    expect(row.textContent).toContain('0.900');
  });

  it('omits the technique chip row entirely when topTechniques is empty', () => {
    const body = makeBody();
    renderEmbeddingsFindings(body, [{ ...F1, topTechniques: [] }]);
    expect(body.querySelector('.embeddings-technique-chip')).toBeNull();
  });
});
