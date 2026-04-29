/**
 * Helpers for the pedagogical-content false-positive baseline runner
 * (issue #120, N15). Kept in a sibling module so the corpus parser, path
 * classifier, and FPR aggregator are unit-testable without spinning up
 * the full runner or an LLM endpoint.
 *
 * Path A vs Path B mirrors the production probe-runner branching at
 * src/offscreen/probe-runner.ts:130-135 — non-empty evidence packets
 * route to the focused `evidence-review` probe; empty packets route to
 * the legacy 3-probe stack.
 */

import type { Chunk } from '@/types/chunk.js';
import type { Hunter } from '@/hunters/base-hunter.js';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import { runHunters } from '@/hunters/hunt-runner.js';
import { spiderHunter } from '@/hunters/spider/index.js';
import { hawkHunter } from '@/hunters/hawk/index.js';
import { buildEvidencePackets } from '@/probes/evidence-builder.js';
import type { EvidencePacket } from '@/probes/base-probe.js';

export type CorpusSource =
  | 'wikipedia'
  | 'owasp'
  | 'academic'
  | 'security-blog'
  | 'course-material';

export type CorpusCategory =
  | 'known-benign-discussion'
  | 'accidentally-includes-quotable-injection-example';

export interface CorpusEntry {
  readonly id: string;
  readonly source: CorpusSource;
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly category: CorpusCategory;
  readonly expected_verdict: 'BENIGN';
}

const VALID_SOURCES: ReadonlySet<CorpusSource> = new Set([
  'wikipedia',
  'owasp',
  'academic',
  'security-blog',
  'course-material',
]);

const VALID_CATEGORIES: ReadonlySet<CorpusCategory> = new Set([
  'known-benign-discussion',
  'accidentally-includes-quotable-injection-example',
]);

function isCorpusEntry(value: unknown): value is CorpusEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.source === 'string' &&
    VALID_SOURCES.has(o.source as CorpusSource) &&
    typeof o.url === 'string' &&
    typeof o.title === 'string' &&
    typeof o.text === 'string' &&
    o.text.length > 0 &&
    typeof o.category === 'string' &&
    VALID_CATEGORIES.has(o.category as CorpusCategory) &&
    o.expected_verdict === 'BENIGN'
  );
}

/**
 * Parse a JSONL corpus file. Throws on malformed JSON or any row that
 * does not conform to CorpusEntry. Returns rows in source order so
 * downstream FPR aggregation is reproducible.
 */
export function parseCorpusJsonl(content: string): readonly CorpusEntry[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, index) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Corpus row ${index + 1} is not valid JSON: ${message}`);
    }
    if (!isCorpusEntry(raw)) {
      throw new Error(`Corpus row ${index + 1} does not conform to CorpusEntry schema`);
    }
    return raw;
  });
}

export type ProbePath = 'A' | 'B';

export interface PathClassification {
  readonly entryId: string;
  readonly path: ProbePath;
  readonly huntReport: HuntReport;
  readonly packets: readonly EvidencePacket[];
}

/**
 * Default hunter set used for pedagogical-corpus path classification.
 * Mirrors the production order (Spider deterministic-first, Hawk
 * probabilistic) so flag emission order stays stable across runs.
 */
export const PEDAGOGICAL_HUNTERS: readonly Hunter[] = [spiderHunter, hawkHunter];

function makeChunk(text: string): Chunk {
  // contentHash is recorded into EvidencePacket.fullChunkRef but is not
  // used by the runner's path-classification or scoring logic; using a
  // length-keyed placeholder keeps this helper synchronous (no
  // crypto.subtle round-trip) and the result still round-trips through
  // the production buildEvidencePackets shape.
  return {
    text,
    start: 0,
    end: text.length,
    contentHash: `pedagogical-corpus:len:${text.length}`,
  };
}

/**
 * Run hunters against a single corpus entry and classify which probe
 * path the production pipeline would route to. Path A = at least one
 * usable evidence packet (`evidence-review` probe); Path B = no usable
 * packets (legacy 3-probe stack).
 */
export async function classifyEntryPath(
  entry: CorpusEntry,
  hunters: readonly Hunter[] = PEDAGOGICAL_HUNTERS,
): Promise<PathClassification> {
  const huntReport = await runHunters(hunters, entry.text);
  const packets = buildEvidencePackets(makeChunk(entry.text), huntReport);
  return {
    entryId: entry.id,
    path: packets.length > 0 ? 'A' : 'B',
    huntReport,
    packets,
  };
}

export interface PathDistribution {
  readonly total: number;
  readonly pathACount: number;
  readonly pathBCount: number;
  readonly pathAByCategory: Readonly<Record<string, number>>;
  readonly pathBByCategory: Readonly<Record<string, number>>;
  readonly pathABySource: Readonly<Record<string, number>>;
  readonly pathBBySource: Readonly<Record<string, number>>;
}

export function summarizePathDistribution(
  entries: readonly CorpusEntry[],
  classifications: readonly PathClassification[],
): PathDistribution {
  const byId = new Map(classifications.map((c) => [c.entryId, c]));
  const pathAByCategory: Record<string, number> = {};
  const pathBByCategory: Record<string, number> = {};
  const pathABySource: Record<string, number> = {};
  const pathBBySource: Record<string, number> = {};
  let pathACount = 0;
  let pathBCount = 0;
  for (const entry of entries) {
    const cls = byId.get(entry.id);
    if (!cls) continue;
    if (cls.path === 'A') {
      pathACount++;
      pathAByCategory[entry.category] = (pathAByCategory[entry.category] ?? 0) + 1;
      pathABySource[entry.source] = (pathABySource[entry.source] ?? 0) + 1;
    } else {
      pathBCount++;
      pathBByCategory[entry.category] = (pathBByCategory[entry.category] ?? 0) + 1;
      pathBBySource[entry.source] = (pathBBySource[entry.source] ?? 0) + 1;
    }
  }
  return {
    total: entries.length,
    pathACount,
    pathBCount,
    pathAByCategory,
    pathBByCategory,
    pathABySource,
    pathBBySource,
  };
}

export interface ProbeRunRow {
  readonly probe: string;
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly score: number;
  readonly rawOutput: string;
  readonly errorMessage: string | null;
}

export type VerdictBand = 'BENIGN' | 'SUSPICIOUS' | 'COMPROMISED';

export function bandFromScore(
  score: number,
  thresholdSuspicious: number,
  thresholdCompromised: number,
): VerdictBand {
  if (score >= thresholdCompromised) return 'COMPROMISED';
  if (score >= thresholdSuspicious) return 'SUSPICIOUS';
  return 'BENIGN';
}

export interface PerEntryResult {
  readonly id: string;
  readonly source: CorpusSource;
  readonly category: CorpusCategory;
  readonly path: ProbePath;
  readonly huntFlags: readonly string[];
  readonly huntScore: number;
  readonly hunterPackets: number;
  readonly probes: readonly ProbeRunRow[];
  readonly verdictTotalScore: number;
  readonly verdictBand: VerdictBand;
  readonly verdictExpected: 'BENIGN';
  readonly isFalsePositiveAnyBand: boolean;
  readonly isFalsePositiveCompromised: boolean;
}

export interface PerPathFpr {
  readonly fp: number;
  readonly total: number;
  readonly fpr: number | null;
}

export interface FprSummary {
  readonly anyBand: { readonly pathA: PerPathFpr; readonly pathB: PerPathFpr };
  readonly compromised: { readonly pathA: PerPathFpr; readonly pathB: PerPathFpr };
}

function aggregate(rows: readonly PerEntryResult[], pickFp: (r: PerEntryResult) => boolean): { readonly pathA: PerPathFpr; readonly pathB: PerPathFpr } {
  const a = rows.filter((r) => r.path === 'A');
  const b = rows.filter((r) => r.path === 'B');
  const aFp = a.filter(pickFp).length;
  const bFp = b.filter(pickFp).length;
  return {
    pathA: { fp: aFp, total: a.length, fpr: a.length === 0 ? null : aFp / a.length },
    pathB: { fp: bFp, total: b.length, fpr: b.length === 0 ? null : bFp / b.length },
  };
}

/**
 * Aggregate per-entry rows into per-path FPR at two severity bands:
 *
 * - anyBand: flag fires whenever the verdict is not BENIGN (score >= THRESHOLD_SUSPICIOUS).
 *   Captures user-visible warnings plus blocks.
 * - compromised: flag fires only on the strict COMPROMISED band (score >= THRESHOLD_COMPROMISED).
 *   Captures the cases where mitigations would actually engage.
 *
 * The 0.10 target gate (issue #120) is evaluated at the report layer.
 */
export function summarizeFpr(rows: readonly PerEntryResult[]): FprSummary {
  return {
    anyBand: aggregate(rows, (r) => r.isFalsePositiveAnyBand),
    compromised: aggregate(rows, (r) => r.isFalsePositiveCompromised),
  };
}
