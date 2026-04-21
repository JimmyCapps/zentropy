/**
 * Compare two direct-API baseline runs produced by run-all-{anthropic,gpt,gemini}.ts.
 *
 * Produces a delta summary covering:
 * - Models added/removed between runs
 * - Per-model vulnerability-scorecard deltas (complied / leaked / exfil)
 * - Clean-FP deltas
 *
 * Usage:
 *   npx tsx scripts/compare-baselines.ts \
 *     --before docs/testing/anthropic-results.json \
 *     --after docs/testing/anthropic-results-2026-04-20.json
 *
 *   npx tsx scripts/compare-baselines.ts \
 *     --before gemini-all-models/raw-results.json \
 *     --after gemini-all-models/raw-results-2026-04-20.json
 *
 * Schema-tolerant: accepts {results: Row[]} or bare Row[].
 */

import { readFileSync } from 'fs';

interface Row {
  readonly model: string;
  readonly probe: string;
  readonly input: string;
  readonly category: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly blocked_by_safety: boolean;
}

interface Scorecard {
  readonly model: string;
  readonly complied: number;
  readonly leaked: number;
  readonly exfil: number;
  readonly cleanFp: number;
}

function parseArgs(argv: readonly string[]): { readonly before: string; readonly after: string } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--before' || flag === '--after') {
      args.set(flag.slice(2), argv[i + 1] ?? '');
      i++;
    }
  }
  const before = args.get('before');
  const after = args.get('after');
  if (!before || !after) {
    throw new Error('Usage: --before <path> --after <path>');
  }
  return { before, after };
}

function loadRows(path: string): readonly Row[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  if (Array.isArray(raw)) return raw as Row[];
  if (Array.isArray(raw.results)) return raw.results as Row[];
  throw new Error(`Unrecognised shape in ${path}`);
}

function scorecard(rows: readonly Row[]): readonly Scorecard[] {
  const models = [...new Set(rows.map((r) => r.model))].sort();
  return models.map((model) => {
    const adv = rows.filter((r) => r.model === model && r.probe === 'adversarial_compliance');
    const clean = rows.filter((r) => r.model === model && r.category === 'clean');
    return {
      model,
      complied: adv.filter((r) => r.complied).length,
      leaked: adv.filter((r) => r.leaked_prompt).length,
      exfil: adv.filter((r) => r.included_url).length,
      cleanFp: clean.filter((r) => r.complied || r.included_url || r.leaked_prompt).length,
    };
  });
}

function renderDelta(before: readonly Scorecard[], after: readonly Scorecard[]): string {
  const beforeMap = new Map(before.map((s) => [s.model, s]));
  const afterMap = new Map(after.map((s) => [s.model, s]));
  const allModels = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  const lines: string[] = [];
  lines.push('| Model | Complied (b→a) | Leaked (b→a) | Exfil (b→a) | Clean-FP (b→a) | Status |');
  lines.push('|---|---|---|---|---|---|');

  for (const model of allModels) {
    const b = beforeMap.get(model);
    const a = afterMap.get(model);
    const fmt = (bv: number | undefined, av: number | undefined): string => {
      if (bv === undefined && av !== undefined) return `— → ${av}`;
      if (bv !== undefined && av === undefined) return `${bv} → —`;
      if (bv === av) return `${bv}`;
      return `${bv} → ${av}`;
    };
    const status = !b ? 'NEW' : !a ? 'REMOVED' : 'CHANGED';
    lines.push(
      `| ${model} | ${fmt(b?.complied, a?.complied)} | ${fmt(b?.leaked, a?.leaked)} | ${fmt(b?.exfil, a?.exfil)} | ${fmt(b?.cleanFp, a?.cleanFp)} | ${status === 'CHANGED' && b && a && b.complied === a.complied && b.leaked === a.leaked && b.exfil === a.exfil && b.cleanFp === a.cleanFp ? 'unchanged' : status} |`,
    );
  }

  return lines.join('\n');
}

function main(): void {
  const { before, after } = parseArgs(process.argv.slice(2));
  const beforeRows = loadRows(before);
  const afterRows = loadRows(after);
  const beforeScore = scorecard(beforeRows);
  const afterScore = scorecard(afterRows);

  console.log(`# Baseline delta\n`);
  console.log(`- **Before:** \`${before}\` (${beforeRows.length} rows, ${beforeScore.length} models)`);
  console.log(`- **After:** \`${after}\` (${afterRows.length} rows, ${afterScore.length} models)\n`);
  console.log(`## Scorecard delta (adversarial_compliance probe + clean-category FP)\n`);
  console.log(renderDelta(beforeScore, afterScore));

  const newModels = afterScore
    .filter((s) => !beforeScore.some((b) => b.model === s.model))
    .map((s) => s.model);
  const removedModels = beforeScore
    .filter((b) => !afterScore.some((a) => a.model === b.model))
    .map((b) => b.model);

  console.log(`\n## Model roster changes`);
  console.log(`- **Added:** ${newModels.length > 0 ? newModels.join(', ') : '(none)'}`);
  console.log(`- **Removed:** ${removedModels.length > 0 ? removedModels.join(', ') : '(none)'}`);
}

main();
