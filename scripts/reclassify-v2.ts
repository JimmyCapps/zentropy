/**
 * Apply classifyOutputV2 to a baseline JSON and report how many row
 * classifications flip from v1 → v2. Surfaces the issue-#13 reclassification
 * impact on the refreshed 2026-04-20 baselines.
 *
 * Usage:
 *   npx tsx scripts/reclassify-v2.ts docs/testing/anthropic-results-2026-04-20.json
 *   npx tsx scripts/reclassify-v2.ts docs/testing/gpt-results-2026-04-20.json
 *   npx tsx scripts/reclassify-v2.ts gemini-all-models/raw-results-2026-04-20.json
 */

import { readFileSync } from 'fs';
import { classifyOutput, classifyOutputV2, type ProbeName } from './fixtures/phase2-inputs.js';

interface Row {
  readonly model: string;
  readonly probe: string;
  readonly input: string;
  readonly category: string;
  readonly output: string;
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

interface Flip {
  readonly model: string;
  readonly probe: string;
  readonly input: string;
  readonly category: string;
  readonly field: 'complied' | 'leaked_prompt' | 'included_url';
  readonly v1: boolean;
  readonly v2: boolean;
  readonly outputPreview: string;
}

function main(): void {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: npx tsx scripts/reclassify-v2.ts <path>');
    process.exit(1);
  }
  const rows = loadRows(path);
  const flips: Flip[] = [];

  for (const row of rows) {
    if (typeof row.output !== 'string' || row.output.startsWith('ERROR:')) continue;
    const probe = row.probe as ProbeName;
    const v1 = classifyOutput(row.output);
    const v2 = classifyOutputV2(row.output, probe);

    for (const field of ['complied', 'leaked_prompt', 'included_url'] as const) {
      if (v1[field] !== v2[field]) {
        flips.push({
          model: row.model,
          probe: row.probe,
          input: row.input,
          category: row.category,
          field,
          v1: v1[field],
          v2: v2[field],
          outputPreview: row.output.replace(/\s+/g, ' ').slice(0, 100),
        });
      }
    }
  }

  console.log(`# Classifier v1 → v2 reclassification delta\n`);
  console.log(`**File:** \`${path}\``);
  console.log(`**Total rows:** ${rows.length}`);
  console.log(`**Flipped classifications:** ${flips.length}\n`);

  if (flips.length === 0) {
    console.log('No flips. v1 and v2 agree on every row.\n');
    return;
  }

  console.log('## Per-probe breakdown\n');
  const probes = [...new Set(flips.map((f) => f.probe))].sort();
  for (const probe of probes) {
    const probeFlips = flips.filter((f) => f.probe === probe);
    const trueToFalse = probeFlips.filter((f) => f.v1 === true && f.v2 === false).length;
    const falseToTrue = probeFlips.filter((f) => f.v1 === false && f.v2 === true).length;
    console.log(`- **${probe}**: ${probeFlips.length} flips (${trueToFalse} true→false FP resolved; ${falseToTrue} false→true FN detected)`);
  }

  console.log('\n## Detail\n');
  console.log('| Model | Probe | Input | Field | v1 | v2 | Output preview |');
  console.log('|---|---|---|---|:---:|:---:|---|');
  for (const flip of flips) {
    const preview = flip.outputPreview.replace(/\|/g, '\\|');
    console.log(
      `| ${flip.model} | ${flip.probe} | ${flip.input} | ${flip.field} | ${flip.v1} | ${flip.v2} | ${preview} |`,
    );
  }
}

main();
