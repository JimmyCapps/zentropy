/**
 * Render a combined vulnerability scorecard across all three providers.
 *
 * Outputs the format used in docs/testing/MODEL_BEHAVIORAL_TEST_REPORT.md's
 * Exec-Summary scorecard so the 2026-04-20 data can be dropped directly into
 * the Phase 3 regression report.
 *
 * Usage:
 *   npx tsx scripts/combined-scorecard.ts \
 *     docs/testing/anthropic-results-2026-04-20.json \
 *     docs/testing/gpt-results-2026-04-20.json \
 *     gemini-all-models/raw-results-2026-04-20.json
 */

import { readFileSync } from 'fs';

interface Row {
  readonly model: string;
  readonly probe: string;
  readonly category: string;
  readonly output: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly blocked_by_safety: boolean;
}

function loadRows(path: string): readonly Row[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  if (Array.isArray(raw)) return raw as Row[];
  if (Array.isArray(raw.results)) return raw.results as Row[];
  throw new Error(`Unrecognised shape in ${path}`);
}

function providerOf(model: string): string {
  if (model.startsWith('claude')) return 'Anthropic';
  if (model.startsWith('gpt') || model.startsWith('o')) return 'OpenAI';
  if (model.startsWith('gemini')) return 'Google';
  return 'Unknown';
}

function prettyModel(model: string): string {
  return model
    .replace(/^claude-/, 'Claude ')
    .replace(/^gpt-/, 'GPT-')
    .replace(/^gemini-/, 'Gemini ')
    .replace(/-(\d{8})$/, '')
    .replace(/-preview$/, ' Preview')
    .replace(/-/g, ' ')
    .replace(/\bFlash Lite\b/g, 'Flash-Lite')
    .replace(/(\d+) (\d+)/g, '$1.$2');
}

function main(): void {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: npx tsx scripts/combined-scorecard.ts <path...>');
    process.exit(1);
  }

  const allRows = paths.flatMap((p) => {
    try {
      return loadRows(p).map((r) => ({ ...r, _source: p }));
    } catch (err) {
      console.error(`Failed to read ${p}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });

  const errored = allRows.filter((r) => typeof r.output === 'string' && r.output.startsWith('ERROR:'));
  const clean = allRows.filter((r) => !(typeof r.output === 'string' && r.output.startsWith('ERROR:')));
  const models = [...new Set(clean.map((r) => r.model))].sort((a, b) => {
    const pa = providerOf(a);
    const pb = providerOf(b);
    if (pa !== pb) return pa.localeCompare(pb);
    return a.localeCompare(b);
  });

  console.log(`# Combined Vulnerability Scorecard — 2026-04-20\n`);
  console.log(`**Rows:** ${clean.length} clean / ${errored.length} errored across ${paths.length} files`);
  console.log(`**Models:** ${models.length}\n`);
  console.log('| Provider | Model | Complied | Leaked Prompt | Exfil URL | Clean FP |');
  console.log('|---|---|:---:|:---:|:---:|:---:|');

  for (const model of models) {
    const adv = clean.filter((r) => r.model === model && r.probe === 'adversarial_compliance');
    const injected = adv.filter((r) => r.category === 'injected');
    const cleanAdv = adv.filter((r) => r.category === 'clean');
    const complied = injected.filter((r) => r.complied).length;
    const leaked = injected.filter((r) => r.leaked_prompt).length;
    const exfil = injected.filter((r) => r.included_url).length;
    const cleanFp = cleanAdv.filter((r) => r.complied || r.leaked_prompt || r.included_url).length;
    console.log(
      `| ${providerOf(model)} | ${prettyModel(model)} | ${complied}/${injected.length} | ${leaked}/${injected.length} | ${exfil}/${injected.length} | ${cleanFp}/${cleanAdv.length} |`,
    );
  }

  // Provider summary
  console.log(`\n## Provider summary\n`);
  const providers = [...new Set(models.map(providerOf))].sort();
  console.log('| Provider | Models | Rows | Compliance-free | Any-compliance |');
  console.log('|---|:---:|:---:|:---:|:---:|');
  for (const provider of providers) {
    const providerModels = models.filter((m) => providerOf(m) === provider);
    const providerRows = clean.filter((r) => providerOf(r.model) === provider);
    const providerAdv = providerRows.filter((r) => r.probe === 'adversarial_compliance' && r.category === 'injected');
    const compliedModels = providerModels.filter((m) => {
      const subset = providerAdv.filter((r) => r.model === m);
      return subset.some((r) => r.complied || r.leaked_prompt || r.included_url);
    });
    const cleanModels = providerModels.length - compliedModels.length;
    console.log(`| ${provider} | ${providerModels.length} | ${providerRows.length} | ${cleanModels}/${providerModels.length} | ${compliedModels.length}/${providerModels.length} |`);
  }

  // Errored-rows summary
  if (errored.length > 0) {
    console.log(`\n## Errored rows\n`);
    const byModel = new Map<string, number>();
    for (const r of errored) {
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
    }
    for (const [model, count] of [...byModel.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- **${model}**: ${count} errors`);
    }
  }
}

main();
