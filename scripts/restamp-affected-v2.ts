/**
 * Re-stamps docs/testing/inbrowser-results-affected.json with v2 classifier
 * output (issue #13). Also re-stamps the Stage 7a replicates sidecar so its
 * flag values match the parent row's v2 classification.
 *
 * This is a one-shot data migration, not a new baseline run. The model outputs
 * (`output` field) are left untouched — only the derived classifier fields
 * (`complied`, `leaked_prompt`, `included_url`, `classification_version`) are
 * recomputed from each row's existing output via `classifyOutputV2`.
 *
 * Why a separate script instead of re-running run-affected-baseline.ts: the
 * live runner loads each WebLLM model into the browser (minutes per model,
 * user-involvement for EPP Chrome). Since v2 is a pure function of the
 * committed outputs, we can flip all 189 rows in milliseconds without
 * re-running inference — preserving the audit trail for
 * `behavioral_delta_flags` and `runtime_delta_ms_vs_native_phase2`.
 *
 * After this script runs:
 *   1. `fp_review` on formerly-FP-surface rows may no longer match (e.g. a
 *      row that flips from complied=true → complied=false is no longer
 *      FP-surface, and its `false_positive` fp_review is now a stale tag).
 *      This script resets fp_review=null on those rows.
 *   2. Entries in `docs/testing/phase3/fp-review-affected.json` that no longer
 *      target an FP-surface row are pruned (via a diff-reviewable rewrite).
 *   3. Running `annotate-fp-review-affected.ts` afterwards is a no-op check
 *      that the join integrity holds.
 *
 * Idempotent by construction: running twice produces byte-identical output.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifyOutput,
  classifyOutputV2,
  type ClassificationVersion,
  type ProbeName,
} from './fixtures/phase2-inputs.js';
import { cellKey, computeBehavioralDelta } from './run-affected-baseline-helpers.js';

interface NativePhase2Row {
  engine_model: string;
  probe: string;
  input: string;
  output: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  skipped_reason: string | null;
  inference_ms: number | null;
}

interface AffectedRowJson {
  engine_model: string;
  probe: ProbeName;
  input: string;
  output: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  classification_version?: ClassificationVersion;
  skipped_reason: string | null;
  fp_review: 'real' | 'false_positive' | 'ambiguous' | null;
  behavioral_delta_flags: string[];
  [key: string]: unknown;
}

interface AffectedFile {
  results: AffectedRowJson[];
  [key: string]: unknown;
}

interface ReplicateSampleJson {
  sample_index: number;
  output: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  [key: string]: unknown;
}

interface ReplicateCellJson {
  engine_model: string;
  probe: ProbeName;
  input: string;
  samples: ReplicateSampleJson[];
  [key: string]: unknown;
}

interface ReplicateFile {
  cells: ReplicateCellJson[];
  [key: string]: unknown;
}

interface FpReviewEntry {
  engine_model: string;
  probe: ProbeName;
  input: string;
  verdict: 'real' | 'false_positive' | 'ambiguous';
  rationale: string;
}

interface FpReviewFile {
  entries: FpReviewEntry[];
  [key: string]: unknown;
}

const ROOT = resolve(import.meta.dirname!, '..');
const AFFECTED_PATH = resolve(ROOT, 'docs', 'testing', 'inbrowser-results-affected.json');
const REPLICATES_PATH = resolve(ROOT, 'docs', 'testing', 'inbrowser-results-affected-replicates.json');
const REVIEW_PATH = resolve(ROOT, 'docs', 'testing', 'phase3', 'fp-review-affected.json');
const NATIVE_PATH = resolve(ROOT, 'docs', 'testing', 'inbrowser-results.json');

function isFpSurface(row: AffectedRowJson): boolean {
  if (row.skipped_reason !== null) return false;
  return row.complied || row.leaked_prompt || row.included_url;
}

function isValidProbe(p: string): p is ProbeName {
  return p === 'summarization' || p === 'instruction_detection' || p === 'adversarial_compliance';
}

interface RestampStats {
  readonly totalRows: number;
  readonly flagChanges: readonly string[]; // keys for rows where v1 vs v2 disagreed
  readonly stillFpSurface: number;
  readonly nowNotFpSurface: number;
}

export function restampRows(
  rows: AffectedRowJson[],
  nativeIndex: ReadonlyMap<string, NativePhase2Row> = new Map(),
): RestampStats {
  const flagChanges: string[] = [];
  let stillFpSurface = 0;
  let nowNotFpSurface = 0;

  for (const row of rows) {
    if (!isValidProbe(row.probe)) {
      throw new Error(`Unexpected probe name: ${row.probe}`);
    }

    // Preserve skipped rows verbatim — classifier doesn't run on them.
    if (row.skipped_reason !== null) {
      row.classification_version = 'v2';
      continue;
    }

    const v1 = classifyOutput(row.output);
    const v2 = classifyOutputV2(row.output, row.probe);

    const v1FpSurface = v1.complied || v1.leaked_prompt || v1.included_url;
    const v2FpSurface = v2.complied || v2.leaked_prompt || v2.included_url;

    if (
      v1.complied !== v2.complied ||
      v1.leaked_prompt !== v2.leaked_prompt ||
      v1.included_url !== v2.included_url
    ) {
      flagChanges.push(cellKey(row.engine_model, row.probe, row.input));
    }

    row.complied = v2.complied;
    row.leaked_prompt = v2.leaked_prompt;
    row.included_url = v2.included_url;
    row.classification_version = 'v2';

    // Recompute behavioral_delta_flags using v2 on BOTH sides — the delta is
    // semantically "model behaved differently across native vs in-browser".
    // Comparing a v2-classified affected row to a v1-classified native row
    // would surface classifier-version drift, not behavior drift.
    const nativeRow = nativeIndex.get(cellKey(row.engine_model, row.probe, row.input));
    let nativeForDelta: { complied: boolean; leaked_prompt: boolean; included_url: boolean } | null = null;
    if (nativeRow !== undefined && nativeRow.skipped_reason === null) {
      const nativeV2 = classifyOutputV2(nativeRow.output, row.probe);
      nativeForDelta = {
        complied: nativeV2.complied,
        leaked_prompt: nativeV2.leaked_prompt,
        included_url: nativeV2.included_url,
      };
    }
    // Cast to satisfy Phase2RowLike shape — only the four fields used by
    // computeBehavioralDelta are read.
    row.behavioral_delta_flags = computeBehavioralDelta(
      v2,
      nativeForDelta === null
        ? null
        : ({
            ...nativeRow!,
            ...nativeForDelta,
          } as unknown as Parameters<typeof computeBehavioralDelta>[1]),
    );

    // If the row is no longer FP-surface, its fp_review is stale — clear it
    // so the next annotate pass treats it as an unflagged row. If it remains
    // FP-surface, keep whatever verdict the curator previously stamped.
    if (v1FpSurface && !v2FpSurface) {
      row.fp_review = null;
      nowNotFpSurface += 1;
    } else if (v2FpSurface) {
      stillFpSurface += 1;
    }
  }

  return {
    totalRows: rows.length,
    flagChanges,
    stillFpSurface,
    nowNotFpSurface,
  };
}

export function restampReplicates(cells: ReplicateCellJson[]): number {
  let flipped = 0;
  for (const cell of cells) {
    if (!isValidProbe(cell.probe)) {
      throw new Error(`Unexpected probe name in replicates: ${cell.probe}`);
    }
    for (const sample of cell.samples) {
      const v1 = classifyOutput(sample.output);
      const v2 = classifyOutputV2(sample.output, cell.probe);
      if (
        v1.complied !== v2.complied ||
        v1.leaked_prompt !== v2.leaked_prompt ||
        v1.included_url !== v2.included_url
      ) {
        flipped += 1;
      }
      sample.complied = v2.complied;
      sample.leaked_prompt = v2.leaked_prompt;
      sample.included_url = v2.included_url;
    }
  }
  return flipped;
}

export function pruneReviewEntries(
  entries: FpReviewEntry[],
  fpSurfaceKeys: ReadonlySet<string>,
): { kept: FpReviewEntry[]; pruned: FpReviewEntry[] } {
  const kept: FpReviewEntry[] = [];
  const pruned: FpReviewEntry[] = [];
  for (const entry of entries) {
    const key = cellKey(entry.engine_model, entry.probe, entry.input);
    if (fpSurfaceKeys.has(key)) kept.push(entry);
    else pruned.push(entry);
  }
  return { kept, pruned };
}

function main(): void {
  const affected = JSON.parse(readFileSync(AFFECTED_PATH, 'utf-8')) as AffectedFile;
  const replicates = JSON.parse(readFileSync(REPLICATES_PATH, 'utf-8')) as ReplicateFile;
  const review = JSON.parse(readFileSync(REVIEW_PATH, 'utf-8')) as FpReviewFile;
  const native = JSON.parse(readFileSync(NATIVE_PATH, 'utf-8')) as { results: NativePhase2Row[] };

  const nativeIndex = new Map<string, NativePhase2Row>();
  for (const r of native.results) {
    nativeIndex.set(cellKey(r.engine_model, r.probe, r.input), r);
  }

  const stats = restampRows(affected.results, nativeIndex);
  const flippedReplicates = restampReplicates(replicates.cells);

  // Collect FP-surface keys after v2 reclassification so we know which review
  // entries to keep.
  const fpSurfaceKeys = new Set<string>();
  for (const row of affected.results) {
    if (isFpSurface(row)) {
      fpSurfaceKeys.add(cellKey(row.engine_model, row.probe, row.input));
    }
  }

  const { kept, pruned } = pruneReviewEntries(review.entries, fpSurfaceKeys);
  review.entries = kept;

  writeFileSync(AFFECTED_PATH, JSON.stringify(affected, null, 2));
  writeFileSync(REPLICATES_PATH, JSON.stringify(replicates, null, 2));
  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2));

  process.stdout.write(`Re-stamp complete (issue #13 / v2 classifier)\n`);
  process.stdout.write(`\n  inbrowser-results-affected.json:\n`);
  process.stdout.write(`    rows:                       ${stats.totalRows}\n`);
  process.stdout.write(`    flag changes (v1 → v2):     ${stats.flagChanges.length}\n`);
  process.stdout.write(`    still FP-surface:           ${stats.stillFpSurface}\n`);
  process.stdout.write(`    flipped off FP-surface:     ${stats.nowNotFpSurface}\n`);
  if (stats.flagChanges.length > 0) {
    process.stdout.write(`    flagged cells:\n`);
    for (const key of stats.flagChanges) process.stdout.write(`      - ${key}\n`);
  }
  process.stdout.write(`\n  inbrowser-results-affected-replicates.json:\n`);
  process.stdout.write(`    samples with flag changes:  ${flippedReplicates}\n`);
  process.stdout.write(`\n  fp-review-affected.json:\n`);
  process.stdout.write(`    kept entries:   ${kept.length}\n`);
  process.stdout.write(`    pruned entries: ${pruned.length}\n`);
  if (pruned.length > 0) {
    process.stdout.write(`    pruned cells (no longer FP-surface under v2):\n`);
    for (const entry of pruned) {
      process.stdout.write(
        `      - ${entry.engine_model}|${entry.probe}|${entry.input} (was ${entry.verdict})\n`,
      );
    }
  }
}

const invokedAsScript = process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith('restamp-affected-v2.ts');
if (invokedAsScript) {
  main();
}
