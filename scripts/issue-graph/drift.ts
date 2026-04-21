import type { GhNode, OverlayBlock, DriftEntry } from './types.js';

const STALE_HOURS = 72;

const CLUSTERABLE_LABELS = new Set([
  'project-honeyllm', 'project-determillm',
  'phase-3', 'phase-4', 'phase-5', 'phase-6+', 'phase-8-candidate',
  'upstream', 'future-feature',
]);

export function detectDrift(
  nodes: ReadonlyArray<GhNode>,
  blocks: ReadonlyArray<OverlayBlock>,
  now: Date,
): DriftEntry[] {
  const byNumber = new Map<number, GhNode>();
  for (const n of nodes) byNumber.set(n.number, n);
  const drift: DriftEntry[] = [];

  const referenced = new Set<number>();
  for (const block of blocks) {
    if (block.kind === 'cluster') {
      for (const m of block.members) referenced.add(m);
    } else if (block.kind === 'edge') {
      referenced.add(block.from);
      referenced.add(block.to);
    } else if (block.kind === 'status') {
      referenced.add(block.issue);
      if (block.target !== undefined) referenced.add(block.target);
    }
  }

  for (const num of referenced) {
    const node = byNumber.get(num);
    if (!node) {
      drift.push({
        severity: 'error',
        message: `overlay references #${num}, which is missing on GitHub`,
        issue: num,
      });
      continue;
    }
    if (node.state === 'closed') {
      drift.push({
        severity: 'warn',
        message: `overlay references #${num}, which is closed`,
        issue: num,
      });
    }
  }

  for (const block of blocks) {
    if (block.kind !== 'status') continue;
    if (block.status !== 'in-progress') continue;
    if (!block.started) continue;
    const started = new Date(block.started).getTime();
    const elapsedH = (now.getTime() - started) / 3_600_000;
    if (elapsedH > STALE_HOURS) {
      drift.push({
        severity: 'warn',
        message: `stale in-progress for #${block.issue} (${elapsedH.toFixed(0)}h since start)`,
        issue: block.issue,
      });
    }
  }

  for (const node of nodes) {
    if (node.state !== 'open') continue;
    if (node.kind !== 'issue') continue;
    const hasClusterLabel = node.labels.some((l) => CLUSTERABLE_LABELS.has(l.name));
    if (!hasClusterLabel) continue;
    if (!referenced.has(node.number)) {
      drift.push({
        severity: 'warn',
        message: `#${node.number} is open and clustered but missing from overlay`,
        issue: node.number,
      });
    }
  }

  return drift;
}
