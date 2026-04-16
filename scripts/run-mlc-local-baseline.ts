/**
 * In-Browser Canary Model Baseline Runner (Phase 2)
 *
 * Mirrors scripts/run-all-gpt.ts exactly. Swaps the provider URL for
 * http://localhost:<port>/v1/chat/completions served by `mlc_llm serve`.
 * Output rows are structurally identical to gpt-results.json etc, with a
 * small engine_* metadata tail so runs can be merged into comparison tables
 * alongside Phase 1 production data.
 *
 * Usage:
 *   MLC_BASE_URL=http://localhost:8001/v1 \
 *   MLC_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC \
 *     npx tsx scripts/run-mlc-local-baseline.ts [--dry-run]
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PROBES, INPUTS, classifyOutput } from './fixtures/phase2-inputs.js';

const BASE_URL = process.env.MLC_BASE_URL ?? 'http://localhost:8001/v1';
const MODEL = process.env.MLC_MODEL;
if (!MODEL) {
  console.error('Set MLC_MODEL to the MLC model ID currently being served');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const OUTDIR = resolve(import.meta.dirname!, '..', 'docs', 'testing');
const OUTFILE = resolve(OUTDIR, 'inbrowser-results.json');
mkdirSync(OUTDIR, { recursive: true });

interface Result {
  provider: 'in-browser-canary';
  engine_runtime: 'mlc-local-serve' | 'chrome-builtin';
  engine_model: string;
  model: string;
  probe: string;
  input: string;
  category: 'clean' | 'injected' | 'borderline';
  output: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  blocked_by_safety: boolean;
  inference_ms: number | null;
  skipped_reason: string | null;
  fp_review: 'real' | 'false_positive' | 'ambiguous' | null;
}

async function callMLC(systemPrompt: string, userMessage: string): Promise<{ text: string; blocked: boolean; elapsedMs: number }> {
  const t0 = Date.now();
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 512,
  };

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const elapsedMs = Date.now() - t0;
    const data = (await res.json()) as any;

    if (data?.choices?.[0]?.message?.content) {
      return { text: data.choices[0].message.content, blocked: false, elapsedMs };
    }
    if (data?.error) {
      return { text: `ERROR: ${String(data.error).slice(0, 200)}`, blocked: false, elapsedMs };
    }
    return { text: `ERROR: ${JSON.stringify(data).slice(0, 200)}`, blocked: false, elapsedMs };
  } catch (err) {
    return { text: `ERROR: ${String(err).slice(0, 200)}`, blocked: false, elapsedMs: Date.now() - t0 };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\nMLC local baseline`);
  console.log(`  base_url: ${BASE_URL}`);
  console.log(`  model:    ${MODEL}`);
  console.log(`  dry_run:  ${DRY_RUN}`);

  let allResults: Result[] = [];
  if (existsSync(OUTFILE)) {
    try {
      const prev = JSON.parse(readFileSync(OUTFILE, 'utf-8'));
      allResults = (prev.results ?? []).filter((r: Result) => !r.output.startsWith('ERROR:') && !r.skipped_reason);
      console.log(`  Resumed with ${allResults.length} existing clean rows`);
    } catch { /* fresh */ }
  }
  const hasResult = new Set(allResults.map((r) => `${r.engine_model}|${r.probe}|${r.input}`));

  const probeNames = Object.keys(PROBES) as (keyof typeof PROBES)[];
  const inputNames = Object.keys(INPUTS);
  const total = probeNames.length * inputNames.length;
  let done = 0;

  for (const probeName of probeNames) {
    const probe = PROBES[probeName];
    for (const inputName of inputNames) {
      const input = INPUTS[inputName];
      done++;
      const key = `${MODEL}|${probeName}|${inputName}`;
      if (hasResult.has(key)) {
        process.stdout.write(`[${Math.round((done / total) * 100)}%] SKIP ${probeName.slice(0, 8)} x ${inputName}\n`);
        continue;
      }

      process.stdout.write(`[${Math.round((done / total) * 100)}%] ${probeName.slice(0, 8)} x ${inputName.padEnd(25)}... `);

      const { text: output, blocked, elapsedMs } = await callMLC(probe.sys, probe.prefix + input.text);
      const classification = classifyOutput(output);

      const result: Result = {
        provider: 'in-browser-canary',
        engine_runtime: 'mlc-local-serve',
        engine_model: MODEL,
        model: MODEL,
        probe: probeName,
        input: inputName,
        category: input.category,
        output,
        complied: classification.complied,
        leaked_prompt: classification.leaked_prompt,
        included_url: classification.included_url,
        blocked_by_safety: blocked,
        inference_ms: elapsedMs,
        skipped_reason: null,
        fp_review: null,
      };

      allResults.push(result);

      const flags: string[] = [];
      if (result.complied) flags.push('COMPLIED');
      if (result.leaked_prompt) flags.push('LEAKED');
      if (result.included_url) flags.push('EXFIL');
      if (result.blocked_by_safety) flags.push('BLOCKED');
      if (output.startsWith('ERROR:')) flags.push('ERROR');

      console.log(`${flags.length ? flags.join(',') + ' ' : ''}${output.replace(/\n/g, ' ').slice(0, 60)} (${elapsedMs}ms)`);

      writeFileSync(OUTFILE, JSON.stringify({
        schema_version: '2.0',
        phase: 2,
        methodology: 'mlc-local-serve-openai-compat',
        test_date: new Date().toISOString().split('T')[0],
        tester: 'in-browser-baseline-harness',
        base_url: BASE_URL,
        results: allResults,
      }, null, 2));

      if (DRY_RUN) {
        console.log('\n--dry-run: exiting after first row');
        return;
      }

      await sleep(200);
    }
  }

  console.log(`\n${'='.repeat(80)}\nCANDIDATE SCORECARD: ${MODEL}\n${'='.repeat(80)}`);
  const rowsForModel = allResults.filter((r) => r.engine_model === MODEL);
  const adv = rowsForModel.filter((r) => r.probe === 'adversarial_compliance');
  console.log(
    `adv_compliance: complied=${adv.filter((r) => r.complied).length}/5 ` +
      `leaked=${adv.filter((r) => r.leaked_prompt).length}/5 ` +
      `exfil=${adv.filter((r) => r.included_url).length}/5 ` +
      `clean_fp=${adv.filter((r) => r.category === 'clean' && (r.complied || r.leaked_prompt || r.included_url)).length}/2`,
  );
  console.log(`\nResults: ${OUTFILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
