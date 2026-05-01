import type { EmbeddingsFinding } from '@/hunters/embeddings/types.js';

const PLACEHOLDER_LEGACY = 'No embeddings data yet.';
const PLACEHOLDER_EMPTY = 'No embeddings matches on this page.';

function formatScore(score: number): string {
  return score.toFixed(3);
}

function buildFindingRow(finding: EmbeddingsFinding): HTMLElement {
  const row = document.createElement('div');
  row.className = 'embeddings-finding-row';

  const head = document.createElement('div');
  head.className = 'embeddings-finding-head';

  const left = document.createElement('span');
  left.className = 'embeddings-finding-id';
  left.textContent = `chunk ${String(finding.chunkIndex)} · ${finding.topId}`;

  const right = document.createElement('span');
  right.className = 'embeddings-finding-score';
  right.textContent = `${formatScore(finding.topScore)} · ${finding.topLang}`;

  head.append(left, right);
  row.appendChild(head);

  if (finding.topTechniques.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'embeddings-technique-row';
    for (const technique of finding.topTechniques) {
      const chip = document.createElement('span');
      chip.className = 'embeddings-technique-chip';
      chip.textContent = technique;
      chips.appendChild(chip);
    }
    row.appendChild(chips);
  }

  if (finding.activations.length > 0) {
    const list = document.createElement('ul');
    list.className = 'embeddings-activations';
    for (const activation of finding.activations) {
      const li = document.createElement('li');
      li.className = 'embeddings-activation-item';
      li.textContent = activation;
      list.appendChild(li);
    }
    row.appendChild(list);
  }

  return row;
}

/**
 * Issue #129 Stage 5 — render the embeddings-Hunter explainability list:
 * one row per chunk that produced a corpus match (top-K cosine matches
 * are surfaced as `<id>@<score>` items beneath each row's chunk header).
 *
 * - `undefined`  → legacy verdict (pre-Stage-5); shows the "no data yet"
 *   placeholder
 * - `null` or `[]` → scan ran but no chunk matched the corpus; shows the
 *   "no matches" placeholder. Both states are common: the index may be
 *   empty (cold-load window) or every cosine sat below threshold.
 * - non-empty array → renders one .embeddings-finding-row per finding,
 *   in the order produced by the orchestrator (chunk-index ascending).
 *
 * Pure DOM construction; idempotent re-render via `replaceChildren`.
 * No network or storage reads.
 */
export function renderEmbeddingsFindings(
  body: HTMLElement,
  findings: readonly EmbeddingsFinding[] | null | undefined,
): void {
  if (findings === undefined) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_LEGACY;
    return;
  }
  if (findings === null || findings.length === 0) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_EMPTY;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'embeddings-finding-list';
  for (const finding of findings) {
    wrapper.appendChild(buildFindingRow(finding));
  }
  body.replaceChildren(wrapper);
  body.className = '';
}
