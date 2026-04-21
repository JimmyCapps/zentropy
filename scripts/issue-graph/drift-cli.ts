import { promises as fs } from 'node:fs';
import { parseOverlay } from './overlay-parser.js';
import { detectDrift } from './drift.js';
import { fetchGhNodes } from './gh-fetcher.js';

interface Args {
  branchClusters: ReadonlyArray<string>;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const idx = argv.indexOf('--branch-clusters');
  if (idx < 0) return { branchClusters: [] };
  const csv = argv[idx + 1] ?? '';
  return { branchClusters: csv.split(',').map((s) => s.trim()).filter(Boolean) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const overlayText = await fs.readFile('docs/issue-graph.md', 'utf8').catch(() => '');
  const overlay = parseOverlay(overlayText);
  const nodes = await fetchGhNodes();
  const drift = detectDrift(nodes, overlay.blocks, new Date());

  if (drift.length === 0) {
    console.log('graph:drift — clean.');
    return;
  }

  for (const d of drift) {
    console.log(`[${d.severity}] ${d.message}` + (d.issue ? ` (#${d.issue})` : ''));
  }

  if (args.branchClusters.length === 0) {
    const hasError = drift.some((d) => d.severity === 'error');
    process.exit(hasError ? 1 : 0);
  }

  const clusterLookup = new Map<number, ReadonlySet<string>>();
  for (const n of nodes) {
    clusterLookup.set(n.number, new Set(n.labels.map((l) => l.name)));
  }
  const branchSet = new Set(args.branchClusters);

  const blocking = drift.filter((d) => {
    if (!d.issue) return false;
    const labels = clusterLookup.get(d.issue) ?? new Set();
    return [...branchSet].some((c) => labels.has(c));
  });

  if (blocking.length > 0) {
    console.error(`graph:drift — ${blocking.length} blocking entries touch branch clusters.`);
    process.exit(1);
  }
  console.log('graph:drift — non-blocking drift only.');
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
