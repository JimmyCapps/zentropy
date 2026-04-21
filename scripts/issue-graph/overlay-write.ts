import type { OverlayStatusBlock } from './types.js';

const HEADER_END_MARKER = '<!-- blocks below -->';
const FENCE_RE = /```issue-graph\n([\s\S]*?)```/g;

function renderStatusBlock(block: OverlayStatusBlock): string {
  const lines = [
    `status: ${block.status}`,
    `issue: ${block.issue}`,
  ];
  if (block.started) lines.push(`started: ${block.started}`);
  if (block.completed) lines.push(`completed: ${block.completed}`);
  if (block.target !== undefined) lines.push(`target: ${block.target}`);
  if (block.note) lines.push(`note: ${block.note}`);
  return '```issue-graph\n' + lines.join('\n') + '\n```';
}

function findStatusBlockFor(text: string, issue: number): { start: number; end: number } | null {
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const body = match[1];
    if (/^status:/m.test(body) && new RegExp(`^issue:\\s*${issue}\\b`, 'm').test(body)) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

export function upsertStatusBlock(text: string, block: OverlayStatusBlock): string {
  const rendered = renderStatusBlock(block);
  const existing = findStatusBlockFor(text, block.issue);
  if (existing) {
    return text.slice(0, existing.start) + rendered + text.slice(existing.end);
  }
  return text.trimEnd() + '\n\n' + rendered + '\n';
}

export function removeStatusBlock(text: string, issue: number): string {
  const existing = findStatusBlockFor(text, issue);
  if (!existing) return text;
  const before = text.slice(0, existing.start).trimEnd();
  const after = text.slice(existing.end).replace(/^\n+/, '');
  return before + '\n\n' + after;
}

export interface HeaderSnapshot {
  readonly updatedAt: string;
  readonly inProgress: ReadonlyArray<{ issue: number; note?: string }>;
  readonly clusters: ReadonlyArray<string>;
}

export function regenerateProseHeader(text: string, snapshot: HeaderSnapshot): string {
  const lines = [
    '# Issue graph overlay',
    '',
    `_Agent-maintained. Last synced: ${snapshot.updatedAt}_`,
    '',
  ];
  if (snapshot.inProgress.length > 0) {
    lines.push('**In progress:** ' + snapshot.inProgress
      .map((p) => p.note ? `#${p.issue} (${p.note})` : `#${p.issue}`)
      .join(', '));
    lines.push('');
  }
  if (snapshot.clusters.length > 0) {
    lines.push('**Clusters:** ' + snapshot.clusters.join(', '));
    lines.push('');
  }
  lines.push(HEADER_END_MARKER);
  lines.push('');
  const header = lines.join('\n');

  const markerIdx = text.indexOf(HEADER_END_MARKER);
  if (markerIdx < 0) {
    const firstFence = text.indexOf('```issue-graph');
    if (firstFence < 0) return header;
    return header + '\n' + text.slice(firstFence);
  }
  return header + text.slice(markerIdx + HEADER_END_MARKER.length).replace(/^\n*/, '\n');
}
