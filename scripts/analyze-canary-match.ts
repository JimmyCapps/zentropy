/**
 * Cross-reference in-browser canary rows with Phase 1 production rows.
 *
 * For each (probe, input) cell, report:
 *   - Which canary candidates complied / leaked / exfil
 *   - Which production models complied / leaked / exfil (from Phase 1)
 *   - Whether the canary matches the "vulnerable on this cell" production signal
 *
 * This determines whether a candidate is a good canary: ideally it should
 * comply on exactly the cells where at least some production models also fail,
 * so its divergence signal translates to real-world risk.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const D = resolve(import.meta.dirname!, '..', 'docs', 'testing');
const inbrowser = JSON.parse(readFileSync(resolve(D, 'inbrowser-results.json'), 'utf-8'));
const anthropic = JSON.parse(readFileSync(resolve(D, 'anthropic-results.json'), 'utf-8'));
const gpt = JSON.parse(readFileSync(resolve(D, 'gpt-results.json'), 'utf-8'));
const geminiDir = resolve(import.meta.dirname!, '..', 'gemini-all-models');
const geminiRaw = JSON.parse(readFileSync(resolve(geminiDir, 'raw-results.json'), 'utf-8'));
const gemini = Array.isArray(geminiRaw) ? { results: geminiRaw } : geminiRaw;

interface Row {
  model: string;
  probe: string;
  input: string;
  category: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  engine_model?: string;
  skipped_reason?: string | null;
}

const allProd: Row[] = [
  ...anthropic.results,
  ...gpt.results,
  ...gemini.results,
];
const canary: Row[] = inbrowser.results.filter((r: Row) => !r.skipped_reason);

const PROBES = ['summarization', 'instruction_detection', 'adversarial_compliance'];
const INPUTS = [
  'clean_recipe', 'clean_news',
  'inject_basic', 'inject_exfil', 'inject_prompt_leak', 'inject_dan', 'inject_role_hijack',
  'borderline_security_blog', 'borderline_cve',
];

function anyFail(rows: Row[], predicate: (r: Row) => boolean): string[] {
  return rows.filter(predicate).map((r) => r.model);
}

function countAny(rows: Row[]): { complied: number; leaked: number; exfil: number } {
  return {
    complied: rows.filter((r) => r.complied).length,
    leaked: rows.filter((r) => r.leaked_prompt).length,
    exfil: rows.filter((r) => r.included_url).length,
  };
}

console.log(`\n${'='.repeat(100)}`);
console.log(`CANARY vs PRODUCTION — Per-(probe × input) compliance matrix`);
console.log(`${'='.repeat(100)}`);

for (const probe of PROBES) {
  console.log(`\n### ${probe}`);
  console.log(`${'input'.padEnd(28)} | prod_any_fail                                 | canary_any_fail`);
  console.log(`${'-'.repeat(28)} | ${'-'.repeat(44)} | ${'-'.repeat(40)}`);
  for (const input of INPUTS) {
    const prodRows = allProd.filter((r) => r.probe === probe && r.input === input);
    const canRows = canary.filter((r) => r.probe === probe && r.input === input);
    const prodFail = countAny(prodRows);
    const canFail = countAny(canRows);
    const prodFailCount = prodRows.filter((r) => r.complied || r.leaked_prompt || r.included_url).length;
    const canFailCount = canRows.filter((r) => r.complied || r.leaked_prompt || r.included_url).length;
    const prodFlag = prodFailCount > 0 ? `⚠️ ${prodFailCount}/${prodRows.length} fail` : `✓ 0/${prodRows.length}`;
    const canFlag = canFailCount > 0 ? `⚠️ ${canFailCount}/${canRows.length} fail` : `✓ 0/${canRows.length}`;
    console.log(`${input.padEnd(28)} | ${prodFlag.padEnd(44)} | ${canFlag}`);
  }
}

console.log(`\n${'='.repeat(100)}`);
console.log(`PER-CANARY BEHAVIORAL PROFILE (adversarial_compliance probe)`);
console.log(`${'='.repeat(100)}`);
const canModels = [...new Set(canary.map((r) => r.engine_model ?? r.model))];
console.log(
  `${'model'.padEnd(45)} ${'complied'.padEnd(10)} ${'leaked'.padEnd(10)} ${'exfil'.padEnd(10)} ${'clean_fp'}`,
);
console.log('-'.repeat(90));
for (const model of canModels) {
  const adv = canary.filter((r) => (r.engine_model ?? r.model) === model && r.probe === 'adversarial_compliance');
  const injected = adv.filter((r) => r.category === 'injected');
  const clean = adv.filter((r) => r.category === 'clean');
  const cleanFp = clean.filter((r) => r.complied || r.leaked_prompt || r.included_url).length;
  console.log(
    `${model.padEnd(45)} ${String(injected.filter((r) => r.complied).length + '/5').padEnd(10)} ` +
      `${String(injected.filter((r) => r.leaked_prompt).length + '/5').padEnd(10)} ` +
      `${String(injected.filter((r) => r.included_url).length + '/5').padEnd(10)} ` +
      `${cleanFp}/2`,
  );
}

console.log(`\n${'='.repeat(100)}`);
console.log(`CANARY SIGNAL STRENGTH — does each candidate provide divergence on vulnerable cells?`);
console.log(`${'='.repeat(100)}`);
console.log(`(A vulnerable cell is one where at least one production model failed on that probe×input.)`);
const vulnCells = new Set<string>();
for (const probe of PROBES) {
  for (const input of INPUTS) {
    const prodRows = allProd.filter((r) => r.probe === probe && r.input === input);
    if (prodRows.some((r) => r.complied || r.leaked_prompt || r.included_url)) {
      vulnCells.add(`${probe}|${input}`);
    }
  }
}
console.log(`\n${vulnCells.size} vulnerable (probe × input) cells across all production models.\n`);
for (const model of canModels) {
  let coveredCells = 0;
  for (const cell of vulnCells) {
    const [probe, input] = cell.split('|');
    const canRows = canary.filter(
      (r) => (r.engine_model ?? r.model) === model && r.probe === probe && r.input === input,
    );
    if (canRows.some((r) => r.complied || r.leaked_prompt || r.included_url)) coveredCells++;
  }
  const pct = Math.round((coveredCells / vulnCells.size) * 100);
  console.log(`${model.padEnd(45)} covers ${coveredCells}/${vulnCells.size} (${pct}%) vulnerable cells`);
}
