# Issue Graph + Related-Work Pre-flight Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repo-bound, agent-maintained issue-graph system that forces pre-flight related-work scans before any design and gives the human owner a readable visual overview — without spawning per-issue bidding agents.

**Architecture:** One sync script (`scripts/issue-graph/sync.ts`) merges live `gh` data with an agent-maintained overlay (`docs/issue-graph.md`) into a generated `data.json`. A static HTML page in `test-pages/` renders the merged data. CLAUDE.md gets a blocking pre-flight + during-work + completion protocol. CI runs `graph:drift` on every PR and fails the build when drift touches the branch's own cluster. Phase 1 ships the grouped-list viewer + all enforcement; Phase 2 adds the canvas graph as a purely additive layer.

**Tech Stack:** TypeScript (tsx), Node built-ins, `gh` CLI, vitest, vanilla HTML/CSS/JS (no framework, no build step for the static page).

**Security note for `gh` fetcher:** The fetcher shells out to `gh` using Node's `child_process.spawn(cmd, argsArray)` form (array argv, never a shell string). This is injection-safe by construction — no user-supplied input is concatenated into a shell command. A repo-provided `execFileNoThrow` wrapper does not exist here (`src/utils/` is not present), so the direct `spawn` is the correct choice.

**Spec:** `docs/superpowers/specs/2026-04-20-issue-graph-and-related-work-scan-design.md`

**Branch:** `docs/issue-graph-design` (already created, spec committed there)

---

## File Structure

Files created/modified by this plan:

```
scripts/issue-graph/
├── overlay-parser.ts           # Parse fenced `issue-graph` YAML-ish blocks
├── overlay-parser.test.ts
├── gh-fetcher.ts               # Shell out to gh; typed wrappers
├── gh-fetcher.test.ts
├── cluster-assign.ts           # Assign nodes to clusters from labels + overlay
├── cluster-assign.test.ts
├── edge-extract.ts             # Extract `#N` references from issue/PR bodies
├── edge-extract.test.ts
├── drift.ts                    # Drift detection + report formatter
├── drift.test.ts
├── merge.ts                    # Merge gh data + overlay → data.json shape
├── merge.test.ts
├── overlay-write.ts            # Write/update overlay status blocks
├── overlay-write.test.ts
├── sync.ts                     # CLI entry: glues the above together
├── sync.test.ts
├── drift-cli.ts                # Standalone `graph:drift` CLI
└── types.ts                    # Shared types

test-pages/issue-graph.html     # Static page, dark theme, grouped list
test-pages/issue-graph.js       # Vanilla JS: fetch data.json, render list, filters
test-pages/issue-graph/
└── data.json                   # Generated, checked in

docs/issue-graph.md             # Agent-maintained overlay (committed empty-ish initially)

.github/workflows/ci.yml        # Add graph-drift job

CLAUDE.md                       # Add "Issue-graph protocol" section

package.json                    # Add scripts: graph, graph:sync, graph:drift, graph:open

test-pages/index.html                             # Add shared nav
test-pages/phase4/manual-test-harness.html        # Add shared nav link to issue-graph
test-pages/phase4/nano-harness.html               # Same
test-pages/phase4/summarizer-harness.html         # Same
```

Each script-file has one job and a co-located test. This keeps each piece under ~150 lines and independently testable.

---

## Task 1: Scaffold types and the failing top-level test

**Files:**
- Create: `scripts/issue-graph/types.ts`
- Create: `scripts/issue-graph/sync.test.ts`

- [ ] **Step 1: Create `types.ts` with the shared data shapes**

Write to `scripts/issue-graph/types.ts`:

```typescript
export type IssueState = 'open' | 'closed';
export type PrState = 'open' | 'closed' | 'merged' | 'draft';

export interface GhLabel {
  name: string;
  description?: string;
  color?: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: ReadonlyArray<GhLabel>;
  updatedAt: string;
  kind: 'issue';
}

export interface GhPr {
  number: number;
  title: string;
  body: string;
  state: PrState;
  labels: ReadonlyArray<GhLabel>;
  updatedAt: string;
  kind: 'pr';
}

export type GhNode = GhIssue | GhPr;

export type EdgeType =
  | 'references'
  | 'blocks'
  | 'depends-on'
  | 'competes-with'
  | 'same-signal'
  | 'supersedes';

export interface Edge {
  readonly type: EdgeType;
  readonly from: number;
  readonly to: number;
  readonly note?: string;
}

export type OverlayStatus =
  | 'in-progress'
  | 'touched'
  | 'unblocks'
  | 'superseded-by';

export interface OverlayStatusBlock {
  readonly kind: 'status';
  readonly status: OverlayStatus;
  readonly issue: number;
  readonly started?: string;
  readonly completed?: string;
  readonly target?: number;
  readonly note?: string;
}

export interface OverlayClusterBlock {
  readonly kind: 'cluster';
  readonly cluster: string;
  readonly members: ReadonlyArray<number>;
  readonly note?: string;
}

export interface OverlayEdgeBlock {
  readonly kind: 'edge';
  readonly edge: EdgeType;
  readonly from: number;
  readonly to: number;
  readonly note?: string;
}

export type OverlayBlock =
  | OverlayStatusBlock
  | OverlayClusterBlock
  | OverlayEdgeBlock;

export interface Overlay {
  readonly blocks: ReadonlyArray<OverlayBlock>;
  readonly proseHeader: string;
}

export interface Node {
  readonly number: number;
  readonly kind: 'issue' | 'pr';
  readonly title: string;
  readonly state: IssueState | PrState;
  readonly clusters: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<string>;
  readonly overlayStatus?: OverlayStatusBlock;
}

export interface DriftEntry {
  readonly severity: 'warn' | 'error';
  readonly message: string;
  readonly issue?: number;
  readonly cluster?: string;
}

export interface GraphData {
  readonly syncedAt: string;
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly clusters: ReadonlyArray<string>;
  readonly drift: ReadonlyArray<DriftEntry>;
}
```

- [ ] **Step 2: Create a failing top-level smoke test**

Write to `scripts/issue-graph/sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { GraphData } from './types.js';

describe('sync pipeline (smoke)', () => {
  it('exports a run() function that returns GraphData', async () => {
    const mod = await import('./sync.js');
    expect(typeof mod.run).toBe('function');
    const data: GraphData = await mod.run({
      ghNodes: [],
      overlayText: '',
      now: () => '2026-04-20T00:00:00Z',
    });
    expect(data.syncedAt).toBe('2026-04-20T00:00:00Z');
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run scripts/issue-graph/sync.test.ts`
Expected: FAIL — cannot find module `./sync.js`.

- [ ] **Step 4: Commit the failing scaffolding**

```bash
git add scripts/issue-graph/types.ts scripts/issue-graph/sync.test.ts
git commit -m "test(graph): scaffold sync pipeline smoke test + shared types"
```

---

## Task 2: Overlay parser

**Files:**
- Create: `scripts/issue-graph/overlay-parser.ts`
- Create: `scripts/issue-graph/overlay-parser.test.ts`

The overlay uses fenced `issue-graph` blocks containing a tiny `key: value` format (no external YAML lib; we don't want a dependency).

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/overlay-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOverlay } from './overlay-parser.js';

const CLUSTER_FIXTURE = [
  '# Issue graph overlay',
  '',
  '```issue-graph',
  'cluster: hunters',
  'members: [3, 75, 80, 81]',
  'note: Spider, dialect packs, Hawk — compete for the same slot.',
  '```',
].join('\n');

const EDGE_FIXTURE = [
  '```issue-graph',
  'edge: depends-on',
  'from: 75',
  'to: 52',
  'note: Gate B methodology.',
  '```',
].join('\n');

const STATUS_FIXTURE = [
  '```issue-graph',
  'status: in-progress',
  'issue: 75',
  'started: 2026-04-20T14:32:00Z',
  'note: Branch docs/issue-graph-design.',
  '```',
].join('\n');

describe('parseOverlay', () => {
  it('parses a cluster block', () => {
    const overlay = parseOverlay(CLUSTER_FIXTURE);
    expect(overlay.blocks).toHaveLength(1);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('cluster');
    if (block.kind !== 'cluster') throw new Error('unreachable');
    expect(block.cluster).toBe('hunters');
    expect(block.members).toEqual([3, 75, 80, 81]);
    expect(block.note).toContain('Spider');
  });

  it('parses an edge block', () => {
    const overlay = parseOverlay(EDGE_FIXTURE);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('edge');
    if (block.kind !== 'edge') throw new Error('unreachable');
    expect(block.edge).toBe('depends-on');
    expect(block.from).toBe(75);
    expect(block.to).toBe(52);
  });

  it('parses a status block', () => {
    const overlay = parseOverlay(STATUS_FIXTURE);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('status');
    if (block.kind !== 'status') throw new Error('unreachable');
    expect(block.status).toBe('in-progress');
    expect(block.issue).toBe(75);
    expect(block.started).toBe('2026-04-20T14:32:00Z');
  });

  it('throws on malformed member list', () => {
    const bad = '```issue-graph\ncluster: x\nmembers: [notANumber]\n```';
    expect(() => parseOverlay(bad)).toThrow(/members/);
  });

  it('keeps the prose header above the first fence', () => {
    const overlay = parseOverlay(CLUSTER_FIXTURE);
    expect(overlay.proseHeader).toContain('# Issue graph overlay');
  });

  it('returns empty overlay for input with no fences', () => {
    const overlay = parseOverlay('just prose, nothing else');
    expect(overlay.blocks).toEqual([]);
    expect(overlay.proseHeader).toBe('just prose, nothing else');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/overlay-parser.test.ts`
Expected: FAIL — cannot find module `./overlay-parser.js`.

- [ ] **Step 3: Implement the parser**

Write to `scripts/issue-graph/overlay-parser.ts`:

```typescript
import type {
  Overlay,
  OverlayBlock,
  OverlayClusterBlock,
  OverlayEdgeBlock,
  OverlayStatusBlock,
  EdgeType,
  OverlayStatus,
} from './types.js';

const FENCE_RE = /```issue-graph\n([\s\S]*?)```/g;

const EDGE_TYPES: ReadonlyArray<EdgeType> = [
  'references', 'blocks', 'depends-on', 'competes-with', 'same-signal', 'supersedes',
];
const STATUS_TYPES: ReadonlyArray<OverlayStatus> = [
  'in-progress', 'touched', 'unblocks', 'superseded-by',
];

function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) throw new Error(`overlay: expected "key: value", got "${trimmed}"`);
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseMembers(raw: string): ReadonlyArray<number> {
  const match = raw.match(/^\[(.*)\]$/);
  if (!match) throw new Error(`overlay: members must be [a, b, c], got "${raw}"`);
  if (!match[1].trim()) return [];
  const parts = match[1].split(',').map((s) => s.trim());
  const nums = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n)) throw new Error(`overlay: members contained non-integer "${p}"`);
    return n;
  });
  return nums;
}

function parseBlock(body: string): OverlayBlock {
  const kv = parseKv(body);
  if ('cluster' in kv) {
    const block: OverlayClusterBlock = {
      kind: 'cluster',
      cluster: kv.cluster,
      members: parseMembers(kv.members ?? '[]'),
      note: kv.note,
    };
    return block;
  }
  if ('edge' in kv) {
    if (!EDGE_TYPES.includes(kv.edge as EdgeType)) {
      throw new Error(`overlay: unknown edge type "${kv.edge}"`);
    }
    const block: OverlayEdgeBlock = {
      kind: 'edge',
      edge: kv.edge as EdgeType,
      from: Number(kv.from),
      to: Number(kv.to),
      note: kv.note,
    };
    return block;
  }
  if ('status' in kv) {
    if (!STATUS_TYPES.includes(kv.status as OverlayStatus)) {
      throw new Error(`overlay: unknown status "${kv.status}"`);
    }
    const block: OverlayStatusBlock = {
      kind: 'status',
      status: kv.status as OverlayStatus,
      issue: Number(kv.issue),
      started: kv.started,
      completed: kv.completed,
      target: kv.target ? Number(kv.target) : undefined,
      note: kv.note,
    };
    return block;
  }
  throw new Error(`overlay: block has none of cluster/edge/status keys — body:\n${body}`);
}

export function parseOverlay(text: string): Overlay {
  const blocks: OverlayBlock[] = [];
  let firstFenceAt = text.length;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index < firstFenceAt) firstFenceAt = match.index;
    blocks.push(parseBlock(match[1]));
  }
  const proseHeader = text.slice(0, firstFenceAt).trim();
  return { blocks, proseHeader };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/overlay-parser.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/overlay-parser.ts scripts/issue-graph/overlay-parser.test.ts
git commit -m "feat(graph): overlay parser for cluster/edge/status fenced blocks"
```

---

## Task 3: `#N` reference extractor

**Files:**
- Create: `scripts/issue-graph/edge-extract.ts`
- Create: `scripts/issue-graph/edge-extract.test.ts`

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/edge-extract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractReferenceEdges } from './edge-extract.js';
import type { GhNode } from './types.js';

function issue(number: number, body: string): GhNode {
  return {
    kind: 'issue', number, title: `#${number}`, body,
    state: 'open', labels: [], updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('extractReferenceEdges', () => {
  it('finds plain #N references', () => {
    const nodes: GhNode[] = [issue(10, 'See #20 and #30 for context.')];
    const edges = extractReferenceEdges(nodes);
    expect(edges).toEqual([
      { type: 'references', from: 10, to: 20 },
      { type: 'references', from: 10, to: 30 },
    ]);
  });

  it('ignores code blocks', () => {
    const body = 'Text\n```\nnot a ref: #99\n```\n';
    const edges = extractReferenceEdges([issue(1, body)]);
    expect(edges).toEqual([]);
  });

  it('ignores self-references', () => {
    const edges = extractReferenceEdges([issue(7, 'This is #7 itself.')]);
    expect(edges).toEqual([]);
  });

  it('dedupes references to the same issue', () => {
    const edges = extractReferenceEdges([issue(1, 'See #2. Also #2. And #2.')]);
    expect(edges).toEqual([{ type: 'references', from: 1, to: 2 }]);
  });

  it('ignores markdown headings (# Heading) but keeps real refs', () => {
    const body = '# Heading\n## Another\nReal ref: #5.';
    const edges = extractReferenceEdges([issue(1, body)]);
    expect(edges).toEqual([{ type: 'references', from: 1, to: 5 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/edge-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the extractor**

Write to `scripts/issue-graph/edge-extract.ts`:

```typescript
import type { GhNode, Edge } from './types.js';

const REF_RE = /(?<![\w#])#(\d+)\b/g;

function stripCodeBlocks(body: string): string {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

export function extractReferenceEdges(nodes: ReadonlyArray<GhNode>): Edge[] {
  const out: Edge[] = [];
  for (const node of nodes) {
    const stripped = stripCodeBlocks(node.body ?? '');
    const seen = new Set<number>();
    REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REF_RE.exec(stripped)) !== null) {
      const target = Number(match[1]);
      if (target === node.number) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push({ type: 'references', from: node.number, to: target });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/edge-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/edge-extract.ts scripts/issue-graph/edge-extract.test.ts
git commit -m "feat(graph): extract #N reference edges from issue/PR bodies"
```

---

## Task 4: Cluster assignment

**Files:**
- Create: `scripts/issue-graph/cluster-assign.ts`
- Create: `scripts/issue-graph/cluster-assign.test.ts`

Clusters come from two sources: known labels (`project-honeyllm`, `project-determillm`, phase labels, `upstream`, `future-feature`) and overlay `cluster` blocks.

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/cluster-assign.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { assignClusters } from './cluster-assign.js';
import type { GhNode, OverlayClusterBlock } from './types.js';

function issue(number: number, labels: string[]): GhNode {
  return {
    kind: 'issue', number, title: `#${number}`, body: '',
    state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('assignClusters', () => {
  it('assigns clusters from known labels', () => {
    const nodes = [issue(75, ['project-honeyllm', 'phase-6+'])];
    const { perNode, all } = assignClusters(nodes, []);
    expect(perNode.get(75)).toEqual(['project-honeyllm', 'phase-6+']);
    expect(all).toContain('project-honeyllm');
    expect(all).toContain('phase-6+');
  });

  it('ignores unknown labels', () => {
    const nodes = [issue(1, ['bug', 'project-honeyllm'])];
    const { perNode } = assignClusters(nodes, []);
    expect(perNode.get(1)).toEqual(['project-honeyllm']);
  });

  it('adds overlay clusters to their members', () => {
    const nodes = [issue(3, []), issue(75, []), issue(80, [])];
    const overlay: OverlayClusterBlock[] = [{
      kind: 'cluster',
      cluster: 'hunters',
      members: [3, 75, 80],
    }];
    const { perNode, all } = assignClusters(nodes, overlay);
    expect(perNode.get(3)).toContain('hunters');
    expect(perNode.get(75)).toContain('hunters');
    expect(perNode.get(80)).toContain('hunters');
    expect(all).toContain('hunters');
  });

  it('dedupes when a node appears in overlay and label', () => {
    const nodes = [issue(75, ['project-honeyllm'])];
    const overlay: OverlayClusterBlock[] = [{
      kind: 'cluster', cluster: 'project-honeyllm', members: [75],
    }];
    const { perNode } = assignClusters(nodes, overlay);
    expect(perNode.get(75)).toEqual(['project-honeyllm']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/cluster-assign.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write to `scripts/issue-graph/cluster-assign.ts`:

```typescript
import type { GhNode, OverlayClusterBlock } from './types.js';

const KNOWN_LABEL_CLUSTERS: ReadonlySet<string> = new Set([
  'project-honeyllm',
  'project-determillm',
  'phase-3',
  'phase-4',
  'phase-5',
  'phase-6+',
  'phase-8-candidate',
  'upstream',
  'future-feature',
]);

export interface ClusterAssignment {
  readonly perNode: ReadonlyMap<number, ReadonlyArray<string>>;
  readonly all: ReadonlyArray<string>;
}

export function assignClusters(
  nodes: ReadonlyArray<GhNode>,
  overlayClusters: ReadonlyArray<OverlayClusterBlock>,
): ClusterAssignment {
  const perNode = new Map<number, string[]>();
  const all = new Set<string>();

  for (const node of nodes) {
    const list: string[] = [];
    for (const label of node.labels) {
      if (KNOWN_LABEL_CLUSTERS.has(label.name)) {
        list.push(label.name);
        all.add(label.name);
      }
    }
    perNode.set(node.number, list);
  }

  for (const block of overlayClusters) {
    all.add(block.cluster);
    for (const member of block.members) {
      const list = perNode.get(member) ?? [];
      if (!list.includes(block.cluster)) {
        list.push(block.cluster);
      }
      perNode.set(member, list);
    }
  }

  return { perNode, all: [...all].sort() };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/cluster-assign.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/cluster-assign.ts scripts/issue-graph/cluster-assign.test.ts
git commit -m "feat(graph): cluster assignment from labels + overlay blocks"
```

---

## Task 5: Drift detector

**Files:**
- Create: `scripts/issue-graph/drift.ts`
- Create: `scripts/issue-graph/drift.test.ts`

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/drift.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectDrift } from './drift.js';
import type { GhNode, OverlayBlock } from './types.js';

function openIssue(n: number, labels: string[] = []): GhNode {
  return {
    kind: 'issue', number: n, title: `#${n}`, body: '', state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}
function closedIssue(n: number): GhNode {
  return { ...openIssue(n), state: 'closed' };
}

describe('detectDrift', () => {
  it('flags overlay references to closed issues', () => {
    const nodes = [closedIssue(99)];
    const blocks: OverlayBlock[] = [
      { kind: 'cluster', cluster: 'x', members: [99] },
    ];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => d.issue === 99 && /closed/i.test(d.message))).toBe(true);
  });

  it('flags overlay references to missing issues', () => {
    const nodes: GhNode[] = [];
    const blocks: OverlayBlock[] = [
      { kind: 'edge', edge: 'depends-on', from: 42, to: 43 },
    ];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => /42/.test(d.message))).toBe(true);
    expect(drift.some((d) => /43/.test(d.message))).toBe(true);
  });

  it('flags stale in-progress older than 72h', () => {
    const nodes = [openIssue(1)];
    const blocks: OverlayBlock[] = [{
      kind: 'status', status: 'in-progress', issue: 1,
      started: '2026-04-15T00:00:00Z',
    }];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => /stale/i.test(d.message) && d.issue === 1)).toBe(true);
  });

  it('does NOT flag fresh in-progress', () => {
    const nodes = [openIssue(1)];
    const blocks: OverlayBlock[] = [{
      kind: 'status', status: 'in-progress', issue: 1,
      started: '2026-04-20T00:00:00Z',
    }];
    const drift = detectDrift(nodes, blocks, new Date('2026-04-20T01:00:00Z'));
    expect(drift.filter((d) => /stale/i.test(d.message))).toEqual([]);
  });

  it('flags open clustered issues missing from overlay', () => {
    const nodes = [openIssue(75, ['project-honeyllm', 'phase-6+'])];
    const drift = detectDrift(nodes, [], new Date('2026-04-20T00:00:00Z'));
    expect(drift.some((d) => d.issue === 75 && /overlay/i.test(d.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/drift.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write to `scripts/issue-graph/drift.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/drift.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/drift.ts scripts/issue-graph/drift.test.ts
git commit -m "feat(graph): drift detector (missing/closed refs, stale in-progress, orphans)"
```

---

## Task 6: Merge into `GraphData`

**Files:**
- Create: `scripts/issue-graph/merge.ts`
- Create: `scripts/issue-graph/merge.test.ts`

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeGraph } from './merge.js';
import type { GhNode, OverlayBlock } from './types.js';

function openIssue(n: number, labels: string[], body = ''): GhNode {
  return {
    kind: 'issue', number: n, title: `#${n}`, body, state: 'open',
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-04-20T00:00:00Z',
  };
}

describe('mergeGraph', () => {
  it('produces nodes with clusters, labels, and overlay status', () => {
    const nodes: GhNode[] = [
      openIssue(75, ['project-honeyllm'], 'Blocked by #52.'),
      openIssue(52, ['project-honeyllm'], ''),
    ];
    const blocks: OverlayBlock[] = [
      { kind: 'cluster', cluster: 'hunters', members: [75, 52] },
      { kind: 'edge', edge: 'depends-on', from: 75, to: 52 },
      { kind: 'status', status: 'in-progress', issue: 75, started: '2026-04-20T00:00:00Z' },
    ];
    const data = mergeGraph({
      ghNodes: nodes,
      overlayBlocks: blocks,
      syncedAt: '2026-04-20T01:00:00Z',
      now: new Date('2026-04-20T01:00:00Z'),
    });

    expect(data.syncedAt).toBe('2026-04-20T01:00:00Z');
    expect(data.nodes.find((n) => n.number === 75)?.clusters).toContain('hunters');
    expect(data.nodes.find((n) => n.number === 75)?.overlayStatus?.status).toBe('in-progress');

    const edgeTypes = data.edges.map((e) => e.type).sort();
    expect(edgeTypes).toEqual(['depends-on', 'references'].sort());
  });

  it('includes drift entries', () => {
    const data = mergeGraph({
      ghNodes: [],
      overlayBlocks: [{ kind: 'cluster', cluster: 'x', members: [999] }],
      syncedAt: '2026-04-20T00:00:00Z',
      now: new Date('2026-04-20T00:00:00Z'),
    });
    expect(data.drift.some((d) => d.issue === 999)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/merge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write to `scripts/issue-graph/merge.ts`:

```typescript
import type {
  GhNode, OverlayBlock, GraphData, Node, Edge,
  OverlayClusterBlock, OverlayEdgeBlock, OverlayStatusBlock,
} from './types.js';
import { extractReferenceEdges } from './edge-extract.js';
import { assignClusters } from './cluster-assign.js';
import { detectDrift } from './drift.js';

export interface MergeInput {
  readonly ghNodes: ReadonlyArray<GhNode>;
  readonly overlayBlocks: ReadonlyArray<OverlayBlock>;
  readonly syncedAt: string;
  readonly now: Date;
}

export function mergeGraph(input: MergeInput): GraphData {
  const clusterBlocks = input.overlayBlocks.filter(
    (b): b is OverlayClusterBlock => b.kind === 'cluster',
  );
  const edgeBlocks = input.overlayBlocks.filter(
    (b): b is OverlayEdgeBlock => b.kind === 'edge',
  );
  const statusBlocks = input.overlayBlocks.filter(
    (b): b is OverlayStatusBlock => b.kind === 'status',
  );

  const { perNode, all: allClusters } = assignClusters(input.ghNodes, clusterBlocks);
  const statusByIssue = new Map<number, OverlayStatusBlock>();
  for (const s of statusBlocks) statusByIssue.set(s.issue, s);

  const nodes: Node[] = input.ghNodes.map((gh) => ({
    number: gh.number,
    kind: gh.kind,
    title: gh.title,
    state: gh.state,
    labels: gh.labels.map((l) => l.name),
    clusters: perNode.get(gh.number) ?? [],
    overlayStatus: statusByIssue.get(gh.number),
  }));

  const referenceEdges = extractReferenceEdges(input.ghNodes);
  const overlayEdges: Edge[] = edgeBlocks.map((b) => ({
    type: b.edge, from: b.from, to: b.to, note: b.note,
  }));

  const drift = detectDrift(input.ghNodes, input.overlayBlocks, input.now);

  return {
    syncedAt: input.syncedAt,
    nodes,
    edges: [...overlayEdges, ...referenceEdges],
    clusters: allClusters,
    drift,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/merge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/merge.ts scripts/issue-graph/merge.test.ts
git commit -m "feat(graph): merge gh nodes + overlay into GraphData"
```

---

## Task 7: `gh` fetcher with injectable runner

**Files:**
- Create: `scripts/issue-graph/gh-fetcher.ts`
- Create: `scripts/issue-graph/gh-fetcher.test.ts`

The fetcher takes a `RunFn` so tests can inject a fake that never hits the network. The default implementation uses `child_process.spawn` with an argv array — injection-safe because we never build a shell string.

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/gh-fetcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { fetchGhNodes } from './gh-fetcher.js';

describe('fetchGhNodes', () => {
  it('calls gh issue list + pr list and combines results', async () => {
    const calls: string[] = [];
    const fakeRun = async (cmd: string, args: string[]): Promise<string> => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('issue')) {
        return JSON.stringify([{
          number: 75, title: 'dialect packs', body: 'See #52.',
          state: 'OPEN', labels: [{ name: 'project-honeyllm' }],
          updatedAt: '2026-04-20T00:00:00Z',
        }]);
      }
      return JSON.stringify([{
        number: 80, title: 'Spider PR', body: '', state: 'MERGED',
        labels: [], updatedAt: '2026-04-20T00:00:00Z',
      }]);
    };

    const nodes = await fetchGhNodes({ run: fakeRun });
    expect(nodes).toHaveLength(2);
    const issue = nodes.find((n) => n.number === 75);
    expect(issue?.kind).toBe('issue');
    expect(issue?.state).toBe('open');
    const pr = nodes.find((n) => n.number === 80);
    expect(pr?.kind).toBe('pr');
    expect(pr?.state).toBe('merged');
    expect(calls).toHaveLength(2);
  });

  it('throws a friendly error when gh is not found', async () => {
    const fakeRun = async (): Promise<string> => {
      throw Object.assign(new Error('gh ENOENT'), { code: 'ENOENT' });
    };
    await expect(fetchGhNodes({ run: fakeRun })).rejects.toThrow(/gh CLI/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/gh-fetcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write to `scripts/issue-graph/gh-fetcher.ts`:

```typescript
import * as cp from 'node:child_process';
import type { GhNode, IssueState, PrState } from './types.js';

export type RunFn = (cmd: string, args: string[]) => Promise<string>;

export const defaultRun: RunFn = (cmd, args) =>
  new Promise<string>((resolve, reject) => {
    const child = cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });

interface RawNode {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: ReadonlyArray<{ name: string; description?: string; color?: string }>;
  updatedAt: string;
}

const ISSUE_FIELDS = 'number,title,body,state,labels,updatedAt';
const PR_FIELDS = 'number,title,body,state,labels,updatedAt';

function normaliseIssueState(s: string): IssueState {
  return s.toLowerCase() === 'closed' ? 'closed' : 'open';
}
function normalisePrState(s: string): PrState {
  const lower = s.toLowerCase();
  if (lower === 'merged') return 'merged';
  if (lower === 'closed') return 'closed';
  if (lower === 'draft') return 'draft';
  return 'open';
}

export async function fetchGhNodes(opts: { run?: RunFn } = {}): Promise<GhNode[]> {
  const run = opts.run ?? defaultRun;
  try {
    const [issuesJson, prsJson] = await Promise.all([
      run('gh', ['issue', 'list', '--state', 'all', '--limit', '200', '--json', ISSUE_FIELDS]),
      run('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', PR_FIELDS]),
    ]);
    const issues: RawNode[] = JSON.parse(issuesJson);
    const prs: RawNode[] = JSON.parse(prsJson);

    const issueNodes: GhNode[] = issues.map((r) => ({
      kind: 'issue', number: r.number, title: r.title, body: r.body ?? '',
      state: normaliseIssueState(r.state), labels: r.labels,
      updatedAt: r.updatedAt,
    }));
    const prNodes: GhNode[] = prs.map((r) => ({
      kind: 'pr', number: r.number, title: r.title, body: r.body ?? '',
      state: normalisePrState(r.state), labels: r.labels,
      updatedAt: r.updatedAt,
    }));
    return [...issueNodes, ...prNodes];
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error('gh CLI not found. Install from https://cli.github.com/ and run `gh auth login`.');
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/gh-fetcher.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/gh-fetcher.ts scripts/issue-graph/gh-fetcher.test.ts
git commit -m "feat(graph): gh fetcher with injectable runner for testing"
```

---

## Task 8: Overlay writer (status blocks + prose header)

**Files:**
- Create: `scripts/issue-graph/overlay-write.ts`
- Create: `scripts/issue-graph/overlay-write.test.ts`

The agent updates status blocks programmatically. Cluster and edge blocks stay human-curated.

- [ ] **Step 1: Write failing tests**

Write to `scripts/issue-graph/overlay-write.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { upsertStatusBlock, removeStatusBlock, regenerateProseHeader } from './overlay-write.js';

const EMPTY = '# Issue graph overlay\n\n<!-- blocks below -->\n';

describe('upsertStatusBlock', () => {
  it('adds a new status block when none exists', () => {
    const out = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z', note: 'branch x',
    });
    expect(out).toContain('```issue-graph');
    expect(out).toContain('status: in-progress');
    expect(out).toContain('issue: 75');
  });

  it('replaces an existing status block for the same issue', () => {
    const withBlock = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    const updated = upsertStatusBlock(withBlock, {
      kind: 'status', status: 'touched', issue: 75,
      completed: '2026-04-20T05:00:00Z', note: 'done',
    });
    const occurrences = (updated.match(/issue: 75/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(updated).toContain('status: touched');
    expect(updated).not.toContain('status: in-progress');
  });

  it('leaves non-status blocks intact', () => {
    const withCluster = EMPTY + '\n```issue-graph\ncluster: hunters\nmembers: [3, 75]\n```\n';
    const out = upsertStatusBlock(withCluster, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    expect(out).toContain('cluster: hunters');
  });
});

describe('removeStatusBlock', () => {
  it('removes the status block for a given issue', () => {
    const withBlock = upsertStatusBlock(EMPTY, {
      kind: 'status', status: 'in-progress', issue: 75,
      started: '2026-04-20T00:00:00Z',
    });
    const out = removeStatusBlock(withBlock, 75);
    expect(out).not.toContain('issue: 75');
  });

  it('is a no-op when the issue has no status block', () => {
    const out = removeStatusBlock(EMPTY, 999);
    expect(out).toBe(EMPTY);
  });
});

describe('regenerateProseHeader', () => {
  it('replaces the header with a generated snapshot', () => {
    const src = '# Old header\nOld prose.\n\n```issue-graph\ncluster: x\nmembers: [1]\n```\n';
    const out = regenerateProseHeader(src, {
      updatedAt: '2026-04-20T00:00:00Z',
      inProgress: [{ issue: 1, note: 'demo' }],
      clusters: ['x'],
    });
    expect(out).toContain('Last synced: 2026-04-20');
    expect(out).toContain('In progress');
    expect(out).toContain('#1');
    expect(out).toContain('cluster: x');
    expect(out).not.toContain('Old prose');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/issue-graph/overlay-write.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write to `scripts/issue-graph/overlay-write.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/issue-graph/overlay-write.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/overlay-write.ts scripts/issue-graph/overlay-write.test.ts
git commit -m "feat(graph): overlay writer (status upsert/remove + prose regeneration)"
```

---

## Task 9: Wire the `sync.ts` CLI

**Files:**
- Create: `scripts/issue-graph/sync.ts`
- Modify: `scripts/issue-graph/sync.test.ts` (add end-to-end case with fakes)

- [ ] **Step 1: Extend the smoke test with an end-to-end case using fakes**

Append to `scripts/issue-graph/sync.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('sync.run end-to-end', () => {
  it('writes data.json and updates the overlay prose', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'graph-'));
    const dataPath = join(dir, 'data.json');
    const overlayPath = join(dir, 'overlay.md');
    await fs.writeFile(overlayPath,
      '# Issue graph overlay\n\n<!-- blocks below -->\n\n' +
      '```issue-graph\ncluster: hunters\nmembers: [75]\n```\n');

    const fakeRun = async (_cmd: string, args: string[]): Promise<string> => {
      if (args.includes('issue')) return JSON.stringify([{
        number: 75, title: 'dialect', body: '', state: 'OPEN',
        labels: [{ name: 'project-honeyllm' }],
        updatedAt: '2026-04-20T00:00:00Z',
      }]);
      return JSON.stringify([]);
    };

    const mod = await import('./sync.js');
    const data = await mod.run({
      overlayPath,
      dataPath,
      run: fakeRun,
      now: () => new Date('2026-04-20T01:00:00Z'),
    });

    expect(data.syncedAt).toBe('2026-04-20T01:00:00Z');
    const written = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    expect(written.nodes).toHaveLength(1);
    const overlay = await fs.readFile(overlayPath, 'utf8');
    expect(overlay).toContain('Last synced: 2026-04-20');
    expect(overlay).toContain('cluster: hunters');
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run scripts/issue-graph/sync.test.ts`
Expected: FAIL — `./sync.js` module missing or `run` missing options.

- [ ] **Step 3: Implement `sync.ts`**

Write to `scripts/issue-graph/sync.ts`:

```typescript
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
  return typeof v === 'string' ? v : v.toISOString();
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
    dataPath: 'test-pages/issue-graph/data.json',
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
```

- [ ] **Step 4: Run all graph tests**

Run: `npx vitest run scripts/issue-graph/`
Expected: PASS for all files.

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-graph/sync.ts scripts/issue-graph/sync.test.ts
git commit -m "feat(graph): sync CLI glues parser/fetcher/merger/writer together"
```

---

## Task 10: `graph:drift` sub-command

**Files:**
- Create: `scripts/issue-graph/drift-cli.ts`

- [ ] **Step 1: Implement a standalone CLI**

Write to `scripts/issue-graph/drift-cli.ts`:

```typescript
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

  if (drift.length === 0) { console.log('graph:drift — clean.'); return; }

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

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
```

- [ ] **Step 2: Manual smoke**

Run: `npx tsx scripts/issue-graph/drift-cli.ts`
Expected: prints `graph:drift — clean.` or a list of entries; exits 0 when no errors and no `--branch-clusters` given.

- [ ] **Step 3: Commit**

```bash
git add scripts/issue-graph/drift-cli.ts
git commit -m "feat(graph): graph:drift CLI with --branch-clusters filter"
```

---

## Task 11: `package.json` scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the scripts**

Edit the `scripts` block in `package.json` to:

```json
{
  "scripts": {
    "dev": "vite build --watch",
    "build": "tsc --noEmit && npx tsx build.ts",
    "build:simple": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "graph:sync": "tsx scripts/issue-graph/sync.ts",
    "graph:drift": "tsx scripts/issue-graph/drift-cli.ts",
    "graph:open": "open test-pages/issue-graph.html",
    "graph": "npm run graph:sync && npm run graph:open"
  }
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Create the stub overlay and run sync**

```bash
mkdir -p docs test-pages/issue-graph
printf '# Issue graph overlay\n\n_Agent-maintained. Regenerated by `npm run graph:sync`._\n\n<!-- blocks below -->\n' > docs/issue-graph.md
npm run graph:sync
```

Expected: prints the summary line; writes `test-pages/issue-graph/data.json` and updates the overlay header.

- [ ] **Step 4: Commit**

```bash
git add package.json docs/issue-graph.md test-pages/issue-graph/data.json
git commit -m "feat(graph): add graph:{sync,drift,open,} npm scripts + stub overlay"
```

---

## Task 12: Static HTML viewer — grouped list (phase-1 MVP)

**Files:**
- Create: `test-pages/issue-graph.html`
- Create: `test-pages/issue-graph.js`

- [ ] **Step 1: Implement `issue-graph.html`**

Write to `test-pages/issue-graph.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>HoneyLLM Issue Graph</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f; color: #e0e0e0; padding: 24px;
      max-width: 1100px; margin: 0 auto;
    }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin: 18px 0 8px; }
    .sub { color: #888; font-size: 13px; margin-bottom: 18px; }
    .nav {
      position: sticky; top: 0; background: #0f0f0f; padding: 12px 0;
      border-bottom: 1px solid #2a2a2a; margin-bottom: 16px; z-index: 10;
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    }
    .nav a {
      color: #93c5fd; text-decoration: none; font-size: 12px;
      padding: 4px 8px; background: #1a1a1a; border-radius: 4px;
    }
    .nav a.active { background: #2563eb; color: white; }
    .header-pills { margin-left: auto; display: flex; gap: 8px; align-items: center; }
    .pill {
      font-size: 10px; padding: 3px 10px; border-radius: 10px;
      text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700;
    }
    .pill-fresh { background: #1a3a1a; color: #4ade80; }
    .pill-amber { background: #3a3a1a; color: #facc15; }
    .pill-red { background: #3a1a1a; color: #f87171; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .row { display: grid; grid-template-columns: 60px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid #1f1f1f; }
    .row:last-child { border-bottom: 0; }
    .num { font-family: 'SF Mono', Monaco, monospace; color: #9ca3af; font-size: 12px; }
    .title { font-size: 13px; }
    .pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .state-open { background: #1a3a1a; color: #4ade80; }
    .state-closed { background: #2a2a2a; color: #9ca3af; }
    .state-merged { background: #2a1a3a; color: #c4b5fd; }
    .state-draft { background: #2a2a2a; color: #9ca3af; }
    .status-in-progress { background: #3a2a1a; color: #facc15; animation: pulse 2s infinite; }
    .status-touched { background: #1a2a3a; color: #93c5fd; }
    .status-unblocks { background: #1a3a2a; color: #6ee7b7; }
    .status-superseded-by { background: #3a1a2a; color: #f9a8d4; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
    .filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    .chip {
      font-size: 11px; padding: 4px 10px; border-radius: 12px;
      background: #1a1a1a; border: 1px solid #2a2a2a; color: #9ca3af; cursor: pointer; user-select: none;
    }
    .chip.on { background: #2563eb; color: white; border-color: #2563eb; }
    .drift { background: #2a1a1a; border: 1px solid #7f1d1d; border-radius: 8px; padding: 12px; margin-bottom: 12px; color: #fecaca; font-size: 12px; }
    .drift ul { margin-left: 18px; }
    button {
      background: #2563eb; color: white; border: 0; padding: 6px 12px; border-radius: 6px;
      font-size: 12px; cursor: pointer; font-weight: 600;
    }
    .empty { color: #6b7280; font-size: 12px; padding: 12px; }
  </style>
</head>
<body>
  <nav class="nav">
    <strong style="font-size:13px;">HoneyLLM Harness</strong>
    <a href="./phase4/manual-test-harness.html">Manual Tests</a>
    <a href="./phase4/nano-harness.html">Nano</a>
    <a href="./phase4/summarizer-harness.html">Summarizer</a>
    <a href="./issue-graph.html" class="active">Issue Graph</a>
    <div class="header-pills">
      <span id="synced-pill" class="pill pill-red">no data</span>
      <span id="drift-pill" class="pill pill-fresh" style="display:none;">0 drift</span>
      <button id="resync-btn">Resync</button>
    </div>
  </nav>

  <h1>Issue Graph</h1>
  <p class="sub">Agent-maintained overview of issues, PRs, and their relationships. Source of truth: GitHub. Overlay: <code>docs/issue-graph.md</code>.</p>

  <div id="drift-banner"></div>
  <div class="filters" id="filters"></div>
  <div id="clusters"></div>

  <dialog id="resync-dialog" style="background:#1a1a1a; color:#e0e0e0; border:1px solid #2a2a2a; border-radius:8px; padding:20px;">
    <h2 style="margin-bottom:10px;">Refresh graph data</h2>
    <p style="font-size:12px; margin-bottom:10px;">This page is static. Run the sync from your terminal:</p>
    <pre style="background:#0a0a0a; padding:10px; border-radius:4px; font-size:12px;">npm run graph</pre>
    <p style="font-size:11px; color:#888; margin:10px 0;">Then reload this page.</p>
    <button id="resync-close" style="margin-top:10px;">Close</button>
  </dialog>

  <script src="./issue-graph.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement `issue-graph.js`**

Write to `test-pages/issue-graph.js`:

```javascript
(async function main() {
  const res = await fetch('./issue-graph/data.json', { cache: 'no-cache' }).catch(() => null);
  if (!res || !res.ok) {
    document.getElementById('clusters').innerHTML =
      '<div class="empty">No data.json yet. Run <code>npm run graph:sync</code>.</div>';
    return;
  }
  const data = await res.json();

  renderSyncedPill(data.syncedAt);
  renderDrift(data.drift);
  const filters = renderFilters(data.clusters);
  const render = () => renderClusters(data, filters.state());
  filters.onChange(render);
  render();

  const dlg = document.getElementById('resync-dialog');
  document.getElementById('resync-btn').onclick = () => dlg.showModal();
  document.getElementById('resync-close').onclick = () => dlg.close();
})().catch((err) => {
  document.getElementById('clusters').innerHTML =
    '<div class="empty">Error: ' + String(err && err.message || err) + '</div>';
});

function renderSyncedPill(iso) {
  const pill = document.getElementById('synced-pill');
  if (!iso) { pill.textContent = 'no data'; pill.className = 'pill pill-red'; return; }
  const ageMs = Date.now() - new Date(iso).getTime();
  const ageMin = Math.round(ageMs / 60000);
  let cls = 'pill-fresh', label;
  if (ageMin < 10) label = 'synced ' + ageMin + 'm';
  else if (ageMin < 60 * 24) { cls = 'pill-amber'; label = 'synced ' + Math.round(ageMin / 60) + 'h'; }
  else { cls = 'pill-red'; label = 'synced ' + Math.round(ageMin / 1440) + 'd'; }
  pill.textContent = label;
  pill.className = 'pill ' + cls;
}

function renderDrift(drift) {
  const banner = document.getElementById('drift-banner');
  const pill = document.getElementById('drift-pill');
  if (!drift || drift.length === 0) { pill.style.display = 'none'; return; }
  pill.style.display = '';
  pill.textContent = drift.length + ' drift';
  pill.className = 'pill pill-amber';
  banner.innerHTML = '<div class="drift"><strong>Drift warnings</strong><ul>' +
    drift.map((d) => '<li>[' + d.severity + '] ' + escapeHtml(d.message) + '</li>').join('') +
    '</ul></div>';
}

function renderFilters(allClusters) {
  const host = document.getElementById('filters');
  const state = {
    state: new Set(['open', 'merged']),
    cluster: new Set(allClusters),
    inProgressOnly: false,
  };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  function chip(label, isOn, onClick) {
    const el = document.createElement('span');
    el.className = 'chip' + (isOn ? ' on' : '');
    el.textContent = label;
    el.onclick = () => { onClick(); el.classList.toggle('on'); emit(); };
    return el;
  }
  for (const s of ['open', 'closed', 'merged']) {
    host.appendChild(chip(s, state.state.has(s), () => {
      state.state.has(s) ? state.state.delete(s) : state.state.add(s);
    }));
  }
  host.appendChild(document.createTextNode(' | '));
  for (const c of allClusters) {
    host.appendChild(chip(c, state.cluster.has(c), () => {
      state.cluster.has(c) ? state.cluster.delete(c) : state.cluster.add(c);
    }));
  }
  host.appendChild(document.createTextNode(' | '));
  host.appendChild(chip('in-progress only', false, () => {
    state.inProgressOnly = !state.inProgressOnly;
  }));

  return {
    state: () => state,
    onChange: (fn) => listeners.push(fn),
  };
}

function renderClusters(data, filt) {
  const host = document.getElementById('clusters');
  const visible = data.nodes.filter((n) => {
    if (!filt.state.has(n.state)) return false;
    const anyCluster = n.clusters.some((c) => filt.cluster.has(c)) || n.clusters.length === 0;
    if (!anyCluster) return false;
    if (filt.inProgressOnly && (!n.overlayStatus || n.overlayStatus.status !== 'in-progress')) return false;
    return true;
  });

  const groups = new Map();
  for (const n of visible) {
    const keys = n.clusters.length > 0 ? n.clusters : ['(no cluster)'];
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  host.innerHTML = '';
  if (sortedGroups.length === 0) {
    host.innerHTML = '<div class="empty">Nothing matches these filters.</div>';
    return;
  }
  for (const [cluster, nodes] of sortedGroups) {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2'); h.textContent = cluster; card.appendChild(h);
    nodes.sort((a, b) => a.number - b.number);
    for (const n of nodes) {
      const row = document.createElement('div'); row.className = 'row';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = '#' + n.number;
      const title = document.createElement('span'); title.className = 'title'; title.textContent = n.title;
      const pills = document.createElement('span'); pills.className = 'pills';
      pills.appendChild(pillEl('state-' + n.state, n.state));
      if (n.overlayStatus) pills.appendChild(pillEl('status-' + n.overlayStatus.status, n.overlayStatus.status));
      row.appendChild(num); row.appendChild(title); row.appendChild(pills);
      card.appendChild(row);
    }
    host.appendChild(card);
  }
}

function pillEl(cls, text) {
  const s = document.createElement('span');
  s.className = 'pill ' + cls; s.textContent = text; return s;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
```

- [ ] **Step 3: Open the page and smoke-test**

Run: `npm run graph:sync && open test-pages/issue-graph.html`
Expected: page loads, shows the synced pill, drift banner if any, and a card per cluster with rows `#N title [state] [overlayStatus?]`.

- [ ] **Step 4: Commit**

```bash
git add test-pages/issue-graph.html test-pages/issue-graph.js
git commit -m "feat(graph): static HTML viewer (grouped list, filters, drift banner)"
```

---

## Task 13: Add shared nav to other harness pages

**Files:**
- Modify: `test-pages/index.html`
- Modify: `test-pages/phase4/manual-test-harness.html`
- Modify: `test-pages/phase4/nano-harness.html`
- Modify: `test-pages/phase4/summarizer-harness.html`

- [ ] **Step 1: Replace the body of `test-pages/index.html`**

Set the body to:

```html
<body style="background:#0f0f0f; color:#e0e0e0; margin:0; font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <nav style="display:flex; gap:10px; padding:12px; border-bottom:1px solid #2a2a2a;">
    <strong style="font-size:13px;">HoneyLLM Harness</strong>
    <a style="color:#93c5fd; text-decoration:none; font-size:12px; padding:4px 8px; background:#1a1a1a; border-radius:4px;" href="./phase4/manual-test-harness.html">Manual Tests</a>
    <a style="color:#93c5fd; text-decoration:none; font-size:12px; padding:4px 8px; background:#1a1a1a; border-radius:4px;" href="./phase4/nano-harness.html">Nano</a>
    <a style="color:#93c5fd; text-decoration:none; font-size:12px; padding:4px 8px; background:#1a1a1a; border-radius:4px;" href="./phase4/summarizer-harness.html">Summarizer</a>
    <a style="color:#93c5fd; text-decoration:none; font-size:12px; padding:4px 8px; background:#1a1a1a; border-radius:4px;" href="./issue-graph.html">Issue Graph</a>
  </nav>
  <div style="padding: 24px; max-width: 1100px; margin: 0 auto;">
    <h1>HoneyLLM Research Fixtures</h1>
    <p>Prompt-injection security testing fixtures. Do not use for any purpose other than agent security research. These pages contain deliberately malicious content designed to manipulate large language models.</p>
    <p>Contact: the HoneyLLM maintainers.</p>
  </div>
</body>
```

- [ ] **Step 2: Add Issue Graph link to the existing nav in `manual-test-harness.html`**

Open `test-pages/phase4/manual-test-harness.html`, locate the `<nav class="nav">` block, and add as the last `<a>` before the `.controls` container:

```html
<a href="../issue-graph.html">Issue Graph</a>
```

- [ ] **Step 3: Same for `nano-harness.html` and `summarizer-harness.html`**

First Read each file. If a `<nav class="nav">` block exists, append the link. If not, copy the nav block from `manual-test-harness.html` (including its scoped styles) and add the Issue Graph link. Do not overwrite other content.

- [ ] **Step 4: Manual click-through**

Run: `open test-pages/index.html`
Expected: nav visible on each page; Issue Graph link resolves; back-links resolve.

- [ ] **Step 5: Commit**

```bash
git add test-pages/index.html test-pages/phase4/manual-test-harness.html test-pages/phase4/nano-harness.html test-pages/phase4/summarizer-harness.html
git commit -m "feat(graph): add Issue Graph link to shared harness nav"
```

---

## Task 14: CLAUDE.md protocol section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert new section**

Add this section to `CLAUDE.md`, immediately after the "GitHub workflow (MUST follow)" section:

```markdown
## Issue-graph protocol (MUST follow)

GitHub issues and PRs are the source of truth. `docs/issue-graph.md` is an
agent-maintained overlay that the agent owns. The human owner reads it and may
edit it, but upkeep is the agent's responsibility.

**Pre-flight (before proposing any design, plan, or non-trivial edit):**

1. Run `npm run graph:sync` and read its summary. If any drift entry touches
   the task's cluster, fix the overlay before proceeding.
2. Open `test-pages/issue-graph/data.json` and list every node connected to
   the task's issue by any edge, plus every node in the same cluster.
3. Read the bodies of those connected/cluster-mate issues in full — not
   titles, bodies.
4. In the response, before any design, include a **Related work** section
   listing each one with a one-line "how it relates," and explicitly state
   what this task is *not* doing.

**During work:**

5. At the first substantive edit, add or update a status block in
   `docs/issue-graph.md`:

       ```issue-graph
       status: in-progress
       issue: <N>
       started: <ISO-8601>
       note: branch <current-branch>
       ```

**On completion / hand-off:**

6. Replace the in-progress block with one of `touched`, `unblocks`, or
   `superseded-by` (with `completed:` timestamp and a one-line summary), or
   remove it if the work no longer applies.
7. Run `npm run graph:sync` a final time; commit any overlay and `data.json`
   changes in the same PR that closes the work.

This is blocking, not advisory. A design proposal without a Related work
section is incomplete. A PR that leaves a stale `in-progress` block for its
own issue fails CI drift-check.
```

- [ ] **Step 2: Verify the section is present**

Run: `grep -n "Issue-graph protocol" CLAUDE.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Issue-graph protocol to CLAUDE.md (pre-flight + during + completion)"
```

---

## Task 15: CI drift-check job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Inspect current workflow**

Run: `cat .github/workflows/ci.yml`

- [ ] **Step 2: Add a new job**

Append a new `graph-drift` job to `.github/workflows/ci.yml`. Keep the existing typecheck/test/build job untouched. The new job:

```yaml
  graph-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Determine branch clusters
        id: clusters
        run: |
          NUMS=$(git log origin/main..HEAD --pretty=%s%n%b | grep -oE '#[0-9]+' | tr -d '#' | sort -u | tr '\n' ',' || true)
          echo "issue_numbers=${NUMS%,}" >> "$GITHUB_OUTPUT"
      - name: Graph drift check
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          CLUSTERS=""
          IFS=',' read -ra NUMS <<< "${{ steps.clusters.outputs.issue_numbers }}"
          for n in "${NUMS[@]}"; do
            [ -z "$n" ] && continue
            LABELS=$(gh issue view "$n" --json labels -q '.labels[].name' 2>/dev/null | tr '\n' ',' || true)
            CLUSTERS="$CLUSTERS,$LABELS"
          done
          CLUSTERS=$(echo "$CLUSTERS" | tr ',' '\n' | grep -E '^(project-|phase-|upstream|future-feature)' | sort -u | tr '\n' ',' | sed 's/,$//')
          echo "Branch clusters: $CLUSTERS"
          if [ -n "$CLUSTERS" ]; then
            npx tsx scripts/issue-graph/drift-cli.ts --branch-clusters "$CLUSTERS"
          else
            npx tsx scripts/issue-graph/drift-cli.ts
          fi
```

- [ ] **Step 3: Dry-run the drift CLI locally**

Run: `npx tsx scripts/issue-graph/drift-cli.ts --branch-clusters project-honeyllm,phase-6+`
Expected: exits 0 (clean) or 1 (blocking drift), with entries listed.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(graph): add graph-drift job, blocking when drift touches branch clusters"
```

---

## Task 16: Seed the initial overlay

**Files:**
- Modify: `docs/issue-graph.md`

- [ ] **Step 1: Inspect current open issues**

Run: `gh issue list --state open --limit 50 --json number,labels,title`
From the 2026-04-20 conversation, the meaningful clusters beyond label-derived ones are: `hunters` (#3, #75, #80, #81), `dialect` (#52, #75), `nano` (#44, #45, #48, #60).

- [ ] **Step 2: Write the seed overlay**

Replace the content of `docs/issue-graph.md` with (note: the fences below use triple backticks, rendered literally in the file):

    # Issue graph overlay

    _Agent-maintained. Regenerated by `npm run graph:sync`._

    <!-- blocks below -->

    ```issue-graph
    cluster: hunters
    members: [3, 75, 80, 81]
    note: Spider (deterministic), Hawk (classifier), and dialect packs compete for the same hunter-signal slot.
    ```

    ```issue-graph
    cluster: dialect
    members: [52, 75]
    note: Gate B dialect vocabulary research + per-language extension.
    ```

    ```issue-graph
    cluster: nano
    members: [44, 45, 48, 60]
    note: Chrome Prompt API / Gemini Nano optimisations and abort handling.
    ```

    ```issue-graph
    edge: depends-on
    from: 75
    to: 52
    note: Per-language dialect packs extend Gate B methodology shipped in #52.
    ```

    ```issue-graph
    edge: competes-with
    from: 81
    to: 80
    note: Hawk v1 and Spider 5A both want the fast-path deterministic signal slot.
    ```

    ```issue-graph
    edge: same-signal
    from: 75
    to: 80
    note: Spider is the deterministic-lexicon hunter; dialect packs extend the same signal multilingually.
    ```

- [ ] **Step 3: Regenerate**

Run: `npm run graph:sync`
Expected: `data.json` now includes `hunters`, `dialect`, `nano` in `clusters`; connected nodes carry those clusters; overlay prose header is regenerated with the ISO timestamp.

- [ ] **Step 4: Open the page**

Run: `open test-pages/issue-graph.html`
Expected: new cluster cards appear; filter chips include them; overlay edges show up via `data.edges`.

- [ ] **Step 5: Commit**

```bash
git add docs/issue-graph.md test-pages/issue-graph/data.json
git commit -m "feat(graph): seed overlay with hunters/dialect/nano clusters + edges"
```

---

## Task 17: End-to-end smoke + self-review

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 2: Full graph sync + drift**

Run: `npm run graph:sync && npm run graph:drift`
Expected: summary line and clean-or-listed drift.

- [ ] **Step 3: Viewer sanity check**

Run: `open test-pages/issue-graph.html`
Manually verify:
- Synced pill shows green (fresh).
- Clusters include hunters/dialect/nano plus label-derived ones.
- Filter chips toggle correctly; "in-progress only" works (empty now — expected).
- Resync button opens the modal showing `npm run graph`.

- [ ] **Step 4: Walk the CLAUDE.md checklist on a fake task**

Pretend the task is "work on #75":
1. `npm run graph:sync`.
2. Open `data.json`; list nodes connected to #75 and cluster-mates.
3. Confirm the list matches intuition (should include #52 via depends-on, #80 via same-signal, #3/#81 via the hunters cluster).

If anything is missing, edit `docs/issue-graph.md`, re-sync, repeat.

- [ ] **Step 5: Open a PR**

```bash
git push -u origin docs/issue-graph-design
gh pr create --title "feat(graph): issue graph + related-work pre-flight scan" --body "$(cat <<'EOF'
## Summary
- Sync script merges live gh data with an agent-maintained overlay into test-pages/issue-graph/data.json.
- Static viewer at test-pages/issue-graph.html (grouped list, filters, drift banner).
- CLAUDE.md protocol (pre-flight + during-work + completion) forces the agent to read adjacent issues before proposing any design.
- CI graph-drift job fails the PR when drift touches the branch's own cluster.

Addresses the class of failure demonstrated by the 2026-04-20 Hawk/Spider/dialect retraction: agent proposed a design without first reading adjacent issues.

## Test plan
- [x] npm run typecheck green
- [x] npm test green (all scripts/issue-graph/*.test.ts pass)
- [x] npm run graph:sync writes data.json and updates overlay prose
- [x] npm run graph:drift --branch-clusters exits non-zero on blocking drift
- [x] CI graph-drift job runs on this PR
- [x] Viewer renders clusters, filters, and drift banner

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Confirm CI passes**

Watch PR checks. If `graph-drift` fails, read the log, fix overlay, re-commit.

---

## Self-review

**Spec coverage:**
- Agent-maintained overlay with fenced blocks → Tasks 2, 8, 16.
- GitHub as source of truth → Task 7 (fetcher); everywhere `gh` is the input.
- Pre-flight + during-work + completion CLAUDE.md → Task 14.
- Static viewer (grouped list, drift banner, synced pill, filters) → Task 12.
- Shared nav across harness pages → Task 13.
- CI drift-check blocking for branch clusters → Task 15.
- Stale in-progress > 72 h detection → Task 5.
- `npm run graph{,:sync,:drift,:open}` → Task 11.
- Seed overlay with hunters/dialect/nano → Task 16.
- Phase 2 canvas graph → deliberately deferred per spec; not in this plan.
- Phase 3 git hooks → deferred.

**Placeholder scan:** no TBD/TODO; every code block is complete; every command has expected output.

**Type consistency:** `OverlayStatusBlock.status` uses the `OverlayStatus` union defined in `types.ts`; `upsertStatusBlock` takes `OverlayStatusBlock`; `sync.ts` `run()` signature matches the smoke test in Task 1 (both accept `ghNodes`/`overlayText` via `RunOptions`). `mergeGraph` output `GraphData` matches what the HTML viewer reads at `./issue-graph/data.json`.

**Known looseness (intentional, flagged not fixed):** the CI "Determine branch clusters" step parses `#N` from commit subjects. If a PR has no `#N` in its commits, clusters are empty and drift is advisory. Acceptable MVP behaviour; tighten later by also parsing PR body.
