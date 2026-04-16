/**
 * Stage 7c — Manual FP curator for the Phase 3 Track A affected-baseline sweep.
 *
 * Companion to scripts/annotate-fp-review.ts (which curates the Phase 2 native
 * file via in-code heuristics). Two deliberate differences:
 *
 *   1. Targets docs/testing/inbrowser-results-affected.json, not the Phase 2
 *      file. The Stage 6 audit-trail contract requires this file's content
 *      outside `fp_review` to remain byte-stable.
 *
 *   2. Verdicts live as **data** in docs/testing/phase3/fp-review-affected.json
 *      rather than in-code rules. Decoupling judgment-data from transform-code
 *      keeps the review table diff-reviewable and lets Stage 8 re-curate via
 *      a JSON edit instead of a code change.
 *
 * The curator joins review entries on (engine_model, probe, input) and stamps
 * `fp_review` on each matching row. There is no heuristic fallback: any
 * FP-surface row without a review entry (or any review entry without a matching
 * row) is a bug and exits non-zero.
 *
 * Idempotent by construction: running twice produces byte-identical output.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { cellKey } from './run-affected-baseline-helpers.js';
import type { ProbeName } from './fixtures/phase2-inputs.js';

export type FpVerdict = 'real' | 'false_positive' | 'ambiguous';

const FP_VERDICTS: readonly FpVerdict[] = ['real', 'false_positive', 'ambiguous'];

function isFpVerdict(value: unknown): value is FpVerdict {
  return typeof value === 'string' && (FP_VERDICTS as readonly string[]).includes(value);
}

export interface FpReviewEntry {
  readonly engine_model: string;
  readonly probe: ProbeName;
  readonly input: string;
  readonly verdict: FpVerdict;
  readonly rationale: string;
}

export interface FpReviewTable {
  readonly schema_version: '1.0';
  readonly reviewed_date: string;
  readonly reviewer: string;
  readonly entries: readonly FpReviewEntry[];
}

// Minimal structural shape for rows we operate on. Using `unknown` for fields
// we never read keeps us decoupled from AffectedRow's locked schema while
// still documenting the ones this curator reads/writes.
export interface CurationRow {
  readonly engine_model: string;
  readonly probe: string;
  readonly input: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly skipped_reason: string | null;
  fp_review: FpVerdict | null;
  readonly [key: string]: unknown;
}

/**
 * A row is FP-surface iff one of the three substring-classifier flags fired
 * AND the row wasn't skipped (skipped_reason stays null). Gemini Nano rows
 * have skipped_reason set and so are never FP-surface.
 */
export function isFpSurface(row: CurationRow): boolean {
  if (row.skipped_reason !== null) return false;
  return row.complied || row.leaked_prompt || row.included_url;
}

export function indexReviewTable(table: FpReviewTable): Map<string, FpReviewEntry> {
  const map = new Map<string, FpReviewEntry>();
  for (const entry of table.entries) {
    if (!isFpVerdict(entry.verdict)) {
      throw new Error(
        `Invalid verdict '${String(entry.verdict)}' for ${entry.engine_model}|${entry.probe}|${entry.input}; must be one of ${FP_VERDICTS.join(', ')}`,
      );
    }
    const key = cellKey(entry.engine_model, entry.probe, entry.input);
    if (map.has(key)) {
      throw new Error(`Duplicate review entry for ${key}`);
    }
    map.set(key, entry);
  }
  return map;
}

export interface StampResult {
  readonly stamped: readonly CurationRow[];
  readonly unreviewedFlagged: readonly string[];
  readonly unmatchedReview: readonly string[];
}

/**
 * Pure in-place stamp: mutates each row's `fp_review` to the verdict when an
 * entry exists for an FP-surface row, or to `null` otherwise. Because the
 * input rows are mutated directly, idempotency is trivial — a second call
 * with the same inputs produces the same mutations.
 *
 * Returns two diagnostic sets for the caller to treat as fatal:
 *   - unreviewedFlagged: FP-surface rows with no matching review entry.
 *   - unmatchedReview: review entries that don't target any FP-surface row.
 */
export function stampRows(
  rows: CurationRow[],
  reviewMap: ReadonlyMap<string, FpReviewEntry>,
): StampResult {
  const unreviewedFlagged: string[] = [];
  const matchedKeys = new Set<string>();

  for (const row of rows) {
    if (!isFpSurface(row)) {
      row.fp_review = null;
      continue;
    }
    const key = cellKey(row.engine_model, row.probe, row.input);
    const entry = reviewMap.get(key);
    if (entry === undefined) {
      unreviewedFlagged.push(key);
      row.fp_review = null;
      continue;
    }
    matchedKeys.add(key);
    row.fp_review = entry.verdict;
  }

  const unmatchedReview: string[] = [];
  for (const key of reviewMap.keys()) {
    if (!matchedKeys.has(key)) unmatchedReview.push(key);
  }

  return { stamped: rows, unreviewedFlagged, unmatchedReview };
}

interface Tally {
  readonly real: number;
  readonly false_positive: number;
  readonly ambiguous: number;
}

export function tallyByModel(rows: readonly CurationRow[]): Map<string, Tally> {
  const counts = new Map<string, { real: number; false_positive: number; ambiguous: number }>();
  for (const row of rows) {
    if (row.fp_review === null) continue;
    const existing = counts.get(row.engine_model) ?? { real: 0, false_positive: 0, ambiguous: 0 };
    existing[row.fp_review] += 1;
    counts.set(row.engine_model, existing);
  }
  return counts;
}

// --- I/O layer ---

const AFFECTED_PATH = resolve(
  import.meta.dirname!,
  '..',
  'docs',
  'testing',
  'inbrowser-results-affected.json',
);
const REVIEW_PATH = resolve(
  import.meta.dirname!,
  '..',
  'docs',
  'testing',
  'phase3',
  'fp-review-affected.json',
);

function main(): void {
  const table = JSON.parse(readFileSync(REVIEW_PATH, 'utf-8')) as FpReviewTable;
  const payload = JSON.parse(readFileSync(AFFECTED_PATH, 'utf-8')) as {
    results: CurationRow[];
    [key: string]: unknown;
  };

  const reviewMap = indexReviewTable(table);
  const result = stampRows(payload.results, reviewMap);

  if (result.unreviewedFlagged.length > 0 || result.unmatchedReview.length > 0) {
    process.stderr.write('Stage 7c curator: join integrity failure\n');
    if (result.unreviewedFlagged.length > 0) {
      process.stderr.write(`  ${result.unreviewedFlagged.length} FP-surface row(s) without a review entry:\n`);
      for (const key of result.unreviewedFlagged) process.stderr.write(`    - ${key}\n`);
    }
    if (result.unmatchedReview.length > 0) {
      process.stderr.write(`  ${result.unmatchedReview.length} review entr(ies) with no matching row:\n`);
      for (const key of result.unmatchedReview) process.stderr.write(`    - ${key}\n`);
    }
    process.exit(1);
  }

  writeFileSync(AFFECTED_PATH, JSON.stringify(payload, null, 2));

  // Summary
  const tally = tallyByModel(payload.results);
  const totals = { real: 0, false_positive: 0, ambiguous: 0 };
  const models = Array.from(tally.keys()).sort();
  process.stdout.write(`Stage 7c curation: ${reviewMap.size} entries stamped on ${AFFECTED_PATH}\n\n`);
  for (const model of models) {
    const t = tally.get(model)!;
    totals.real += t.real;
    totals.false_positive += t.false_positive;
    totals.ambiguous += t.ambiguous;
    process.stdout.write(
      `  ${model}: real=${t.real} fp=${t.false_positive} ambig=${t.ambiguous}\n`,
    );
  }
  process.stdout.write(
    `\n  TOTAL: real=${totals.real} false_positive=${totals.false_positive} ambiguous=${totals.ambiguous}\n`,
  );
}

// Only run main when invoked as a script (not when imported by tests). The
// import.meta.main check matches Node 20.6+ and tsx's behavior.
const invokedAsScript = process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith('annotate-fp-review-affected.ts');
if (invokedAsScript) {
  main();
}
