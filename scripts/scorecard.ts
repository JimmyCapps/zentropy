/**
 * Render the vulnerability scorecard table for a baseline JSON file.
 *
 * Mirrors the format in docs/testing/MODEL_BEHAVIORAL_TEST_REPORT.md §Exec
 * Summary so the refreshed 2026-04-20 data can be dropped straight into the
 * Phase 3 regression report (docs/testing/phase3/PHASE3_REGRESSION_REPORT.md).
 *
 * Usage:
 *   npx tsx scripts/scorecard.ts docs/testing/anthropic-results-2026-04-20.json
 *   npx tsx scripts/scorecard.ts gemini-all-models/raw-results-2026-04-20.json
 */

import { readFileSync } from 'fs';

interface Row {
  readonly model: string;
  readonly probe: string;
  readonly category: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
}

function loadRows(path: string): readonly Row[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  if (Array.isArray(raw)) return raw as Row[];
  if (Array.isArray(raw.results)) return raw.results as Row[];
  throw new Error(`Unrecognised shape in ${path}`);
}

function prettifyModel(m: string): string {
  return m
    .replace(/^claude-/, 'Claude ')
    .replace(/^gpt-/, 'GPT-')
    .replace(/^gemini-/, 'Gemini ')
    .replace(/-(\d{8})$/, '') // strip dated suffixes like -20251001
    .replace(/-preview$/, ' Preview')
    .replace(/-mini/, '-mini')
    .replace(/-nano/, '-nano')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/Flash-Lite/, 'Flash Lite')
    .replace(/-/g, ' ');
}

function main(): void {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: npx tsx scripts/scorecard.ts <path>');
    process.exit(1);
  }
  const rows = loadRows(path);
  const models = [...new Set(rows.map((r) => r.model))].sort();

  console.log(`# Scorecard — ${path}\n`);
  console.log(`**Total rows:** ${rows.length}    **Models:** ${models.length}\n`);
  console.log('| Model | Complied | Leaked Prompt | Exfil URL | Clean FP |');
  console.log('|---|:---:|:---:|:---:|:---:|');

  for (const model of models) {
    const adv = rows.filter((r) => r.model === model && r.probe === 'adversarial_compliance');
    const injected = adv.filter((r) => r.category === 'injected');
    const clean = adv.filter((r) => r.category === 'clean');
    const complied = injected.filter((r) => r.complied).length;
    const leaked = injected.filter((r) => r.leaked_prompt).length;
    const exfil = injected.filter((r) => r.included_url).length;
    const cleanFp = clean.filter((r) => r.complied || r.leaked_prompt || r.included_url).length;
    const total = injected.length;
    console.log(
      `| ${prettifyModel(model)} | ${complied}/${total} | ${leaked}/${total} | ${exfil}/${total} | ${cleanFp}/${clean.length} |`,
    );
  }

  // Summary stats
  const totalCells = rows.length;
  const errorRows = rows.filter((r: any) => typeof r.output === 'string' && r.output.startsWith('ERROR:')).length;
  const blocked = rows.filter((r: any) => r.blocked_by_safety).length;
  console.log(`\n**Integrity:** ${totalCells} rows, ${errorRows} errored, ${blocked} blocked_by_safety\n`);
}

main();
