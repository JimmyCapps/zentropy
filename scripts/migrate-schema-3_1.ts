#!/usr/bin/env tsx
/**
 * Phase 4 Stage 4A — schema migration to 3.1 / 4.1.
 *
 * Semantic bump, not a structural one: the live-extension production path now
 * propagates probe-level `errorMessage` and verdict-level `analysisError`
 * instead of stamping the `probe_error` sentinel flag. Existing JSON files
 * already carry per-row `error_message`; Track B verdict rows need a new
 * `analysis_error` field so downstream analysis can distinguish a
 * legitimately CLEAN verdict from one that was silently masked by engine
 * failure on a pre-schema-3.1 row.
 *
 * This migration is ADDITIVE ONLY: existing values are never mutated. It adds
 * `analysis_error: null` to every row in `phase3-results.json` (Track B
 * verdict-level) and bumps schema_version markers on the affected files.
 *
 * `inbrowser-results-affected.json` already carries `error_message` per row
 * (it's probe-level, from ProbeDirectResultMessage). The bump documents the
 * semantic refinement on the production path; no row-shape change needed.
 *
 * Usage:
 *   npx tsx scripts/migrate-schema-3_1.ts           # apply in-place
 *   npx tsx scripts/migrate-schema-3_1.ts --dry-run # report intended changes, write nothing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FileWrapper {
  readonly schema_version?: string;
  readonly [key: string]: unknown;
}

interface MigrationPlan {
  readonly filePath: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly addAnalysisErrorToResults: boolean;
}

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');

const PLANS: readonly MigrationPlan[] = [
  {
    filePath: resolve(REPO_ROOT, 'docs/testing/inbrowser-results-affected.json'),
    fromVersion: '3.0',
    toVersion: '3.1',
    addAnalysisErrorToResults: false,
  },
  {
    filePath: resolve(REPO_ROOT, 'docs/testing/phase3-results.json'),
    fromVersion: '4.0',
    toVersion: '4.1',
    addAnalysisErrorToResults: true,
  },
];

function migrate(plan: MigrationPlan, dryRun: boolean): { changed: boolean; summary: string } {
  const raw = readFileSync(plan.filePath, 'utf-8');
  const doc = JSON.parse(raw) as FileWrapper & { results?: unknown };
  const currentVersion = typeof doc.schema_version === 'string' ? doc.schema_version : '(missing)';

  if (currentVersion === plan.toVersion) {
    return { changed: false, summary: `  ${plan.filePath}: already at ${plan.toVersion}, skipping` };
  }
  if (currentVersion !== plan.fromVersion) {
    return {
      changed: false,
      summary: `  ${plan.filePath}: expected ${plan.fromVersion}, found ${currentVersion} — REFUSING to migrate`,
    };
  }

  let rowsPatched = 0;
  if (plan.addAnalysisErrorToResults && Array.isArray(doc.results)) {
    const patched = (doc.results as unknown[]).map((row) => {
      if (row !== null && typeof row === 'object' && !('analysis_error' in row)) {
        rowsPatched += 1;
        return { ...(row as Record<string, unknown>), analysis_error: null };
      }
      return row;
    });
    doc.results = patched;
  }

  doc.schema_version = plan.toVersion;

  if (!dryRun) {
    writeFileSync(plan.filePath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  }

  return {
    changed: true,
    summary: `  ${plan.filePath}: ${plan.fromVersion} → ${plan.toVersion}${rowsPatched > 0 ? `, patched ${rowsPatched} rows with analysis_error:null` : ''}`,
  };
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}Schema 3.1 / 4.1 migration — Phase 4 Stage 4A\n`);

  let anyChanged = false;
  for (const plan of PLANS) {
    const { changed, summary } = migrate(plan, dryRun);
    console.log(summary);
    if (changed) anyChanged = true;
  }

  if (!anyChanged) {
    console.log('\nNo changes needed.');
  } else if (dryRun) {
    console.log('\n(dry-run) Re-run without --dry-run to apply.');
  } else {
    console.log('\nMigration complete. Review `git diff` before committing.');
  }
}

main();
