#!/usr/bin/env tsx
/**
 * Phase 4 Stage 4C — merge manual Nano harness output into the canonical
 * affected-baseline results file.
 *
 * Consumes the JSON downloaded from `test-pages/nano-harness.html`
 * (run in real Chrome on an EPP-enrolled profile) and merges its 27 rows
 * into `docs/testing/inbrowser-results-affected.json`, replacing any
 * existing rows with the same (model, probe, input) key.
 *
 * Never mutates non-Nano rows. Prints a diff summary before writing.
 *
 * Usage:
 *   npx tsx scripts/merge-nano-harness.ts <path-to-downloaded-json>
 *   npx tsx scripts/merge-nano-harness.ts <path> --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
const TARGET = resolve(REPO_ROOT, 'docs/testing/inbrowser-results-affected.json');

const NANO_MODEL = 'chrome-builtin-gemini-nano';

interface GenericRow {
  readonly model: string;
  readonly probe: string;
  readonly input: string;
  readonly [key: string]: unknown;
}

interface ResultsFile {
  readonly schema_version?: string;
  readonly phase?: number;
  readonly track?: string;
  readonly methodology?: string;
  readonly test_date?: string;
  readonly tester?: string;
  readonly results: readonly GenericRow[];
}

interface NanoExport {
  readonly schema_version?: string;
  readonly results: readonly GenericRow[];
}

function keyOf(row: GenericRow): string {
  return `${row.model}|${row.probe}|${row.input}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const inputPath = args.find((a) => !a.startsWith('--'));

  if (inputPath === undefined) {
    console.error('Usage: npx tsx scripts/merge-nano-harness.ts <downloaded-json> [--dry-run]');
    process.exit(1);
  }

  const resolvedInput = resolve(inputPath);
  const source = JSON.parse(readFileSync(resolvedInput, 'utf-8')) as NanoExport;
  const target = JSON.parse(readFileSync(TARGET, 'utf-8')) as ResultsFile;

  const sourceRows = source.results;
  const nanoRows = sourceRows.filter((r) => r.model === NANO_MODEL);
  if (nanoRows.length !== sourceRows.length) {
    console.warn(
      `WARNING: source has ${sourceRows.length} rows but only ${nanoRows.length} match model=${NANO_MODEL}. Non-Nano rows will be ignored.`,
    );
  }
  if (nanoRows.length === 0) {
    console.error(`No Nano rows found in ${resolvedInput}`);
    process.exit(1);
  }

  const nanoKeys = new Set(nanoRows.map(keyOf));
  const otherRows = target.results.filter((r) => !(r.model === NANO_MODEL && nanoKeys.has(keyOf(r))));
  const removed = target.results.length - otherRows.length;

  // Also drop any Nano rows that are NOT being replaced (orphan placeholders),
  // so the file only carries Nano rows corresponding to this session's sweep.
  const otherNanoRows = otherRows.filter((r) => r.model !== NANO_MODEL);
  const droppedOrphanNano = otherRows.length - otherNanoRows.length;

  const merged: GenericRow[] = [...otherNanoRows, ...nanoRows];

  console.log(`=== Nano merge summary ===`);
  console.log(`  Source file: ${resolvedInput}`);
  console.log(`  Target file: ${TARGET}`);
  console.log(`  Nano rows incoming: ${nanoRows.length}`);
  console.log(`  Existing rows replaced (same model|probe|input): ${removed}`);
  console.log(`  Orphan Nano rows dropped (not in source): ${droppedOrphanNano}`);
  console.log(`  Non-Nano rows preserved: ${otherNanoRows.length}`);
  console.log(`  Final row count: ${merged.length}`);

  if (dryRun) {
    console.log('\n(dry-run) Re-run without --dry-run to apply.');
    return;
  }

  const payload: ResultsFile = {
    schema_version: target.schema_version ?? '3.1',
    phase: target.phase,
    track: target.track,
    methodology: target.methodology,
    test_date: target.test_date,
    tester: target.tester,
    results: merged,
  };
  writeFileSync(TARGET, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(`\nMerged ${nanoRows.length} Nano rows into ${TARGET}.`);
  console.log('Review git diff before committing.');
}

main();
