export interface HunterSummary {
  readonly benign: number;
  readonly uncertain: number;
  readonly flagged: number;
  readonly totalChunks: number;
  readonly skippedChunks: number;
  // Issue #145 — count of chunks that were padded out because the orchestrator
  // exited the chunk loop early on a high-confidence Hunter compromise. Optional
  // for backwards compatibility with verdicts persisted before this field was
  // added; absent or zero means no early-exit badge is rendered.
  readonly notScannedChunks?: number;
}

const EARLY_EXIT_BADGE_TEXT = 'Early exit: high-confidence compromise';

const PLACEHOLDER_LEGACY = 'No hunter data yet.';
const PLACEHOLDER_SKIPPED = 'Hunter analysis skipped (no chunks).';

interface Row {
  readonly label: string;
  readonly value: number;
  readonly cls: 'benign' | 'uncertain' | 'flagged';
}

export function renderHunterSummary(
  body: HTMLElement,
  summary: HunterSummary | null | undefined,
): void {
  if (summary === undefined) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_LEGACY;
    return;
  }
  if (summary === null) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_SKIPPED;
    return;
  }

  const rows: readonly Row[] = [
    { label: 'Benign', value: summary.benign, cls: 'benign' },
    { label: 'Uncertain', value: summary.uncertain, cls: 'uncertain' },
    { label: 'Flagged', value: summary.flagged, cls: 'flagged' },
  ];

  const ul = document.createElement('ul');
  ul.className = 'hunter-finding-list';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = `hunter-finding-row ${row.cls}${row.value === 0 ? ' dim' : ''}`;
    const label = document.createElement('span');
    label.className = 'hunter-finding-label';
    label.textContent = `${row.label}:`;
    const value = document.createElement('span');
    value.className = 'hunter-finding-value';
    value.textContent = String(row.value);
    li.append(label, value);
    ul.appendChild(li);
  }

  const meta = document.createElement('div');
  meta.className = 'hunter-finding-meta';
  meta.textContent =
    summary.skippedChunks > 0
      ? `${summary.totalChunks} chunks scanned (${summary.skippedChunks} skipped)`
      : `${summary.totalChunks} chunks scanned`;

  if ((summary.notScannedChunks ?? 0) > 0) {
    const badge = document.createElement('span');
    badge.className = 'hunter-finding-meta-badge';
    badge.textContent = EARLY_EXIT_BADGE_TEXT;
    meta.append(' ', badge);
  }

  body.replaceChildren(ul, meta);
  body.className = '';
}
