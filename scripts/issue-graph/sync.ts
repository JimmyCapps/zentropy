import { promises as fs } from 'node:fs';
import { parseOverlay } from './overlay-parser.js';
import { mergeGraph } from './merge.js';
import { fetchGhNodes, type RunFn } from './gh-fetcher.js';
import { regenerateProseHeader } from './overlay-write.js';
import type { GhNode, GraphData, OverlayStatusBlock } from './types.js';

export interface RunOptions {
  readonly overlayPath?: string;
  readonly dataPath?: string;
  readonly run?: RunFn;
  readonly now?: () => Date | string;
  readonly ghNodes?: ReadonlyArray<GhNode>;
  readonly overlayText?: string;
}

function nowIso(now: RunOptions['now']): string {
  const v = now ? now() : new Date();
  if (typeof v === 'string') return v;
  return v.toISOString().replace(/\.000Z$/, 'Z');
}

export async function run(opts: RunOptions = {}): Promise<GraphData> {
  const syncedAt = nowIso(opts.now);
  const nowDate = new Date(syncedAt);

  const overlayText = opts.overlayText ?? (opts.overlayPath
    ? await fs.readFile(opts.overlayPath, 'utf8')
    : '');
  const overlay = parseOverlay(overlayText);

  const ghNodes = opts.ghNodes ?? await fetchGhNodes({ run: opts.run });

  const data = mergeGraph({
    ghNodes, overlayBlocks: overlay.blocks, syncedAt, now: nowDate,
  });

  if (opts.dataPath) {
    const dir = opts.dataPath.replace(/\/[^/]+$/, '');
    if (dir && dir !== opts.dataPath) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(opts.dataPath, JSON.stringify(data, null, 2) + '\n');
  }

  if (opts.overlayPath) {
    const inProgress = overlay.blocks
      .filter((b): b is OverlayStatusBlock => b.kind === 'status' && b.status === 'in-progress')
      .map((b) => ({ issue: b.issue, note: b.note }));
    const updated = regenerateProseHeader(overlayText, {
      updatedAt: syncedAt,
      inProgress,
      clusters: data.clusters,
    });
    if (updated !== overlayText) {
      await fs.writeFile(opts.overlayPath, updated);
    }
  }

  return data;
}

async function main(): Promise<void> {
  const data = await run({
    overlayPath: 'docs/issue-graph.md',
    dataPath: 'harnesses/issue-graph/data.json',
    now: () => new Date(),
  });
  const counts = {
    open: data.nodes.filter((n) => n.state === 'open').length,
    closed: data.nodes.filter((n) => n.state === 'closed').length,
    merged: data.nodes.filter((n) => n.state === 'merged').length,
    edges: data.edges.length,
    drift: data.drift.length,
  };
  console.log(
    `graph:sync — ${counts.open} open, ${counts.closed} closed, ${counts.merged} merged, ` +
    `${counts.edges} edges, ${counts.drift} drift warnings.`,
  );
  for (const d of data.drift) {
    console.log(`  [${d.severity}] ${d.message}`);
  }
  if (data.drift.some((d) => d.severity === 'error')) process.exit(2);
}

const invokedDirectly =
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
