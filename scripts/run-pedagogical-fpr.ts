/**
 * Pedagogical-content false-positive baseline runner — issue #120 (N15).
 *
 * Measures end-to-end FPR against `docs/testing/phase5/pedagogical-corpus.jsonl`
 * broken out per probe path:
 *
 *   - Path A: Hunters fire → `evidence-review` probe (focused-context)
 *   - Path B: Hunters miss → legacy 3-probe stack
 *     (instruction-detection, adversarial-compliance, summarization)
 *
 * Modes:
 *   --hunter-only     Deterministic. Spider + Hawk classification only,
 *                     no LLM calls. Validates the corpus exercises both
 *                     paths. Runnable without `mlc_llm serve`.
 *
 *   --dry-run         Hunter classification + 1 LLM call to validate the
 *                     endpoint, then exits.
 *
 *   (default)         Full end-to-end run with LLM probe scoring per
 *                     path. Requires MLC_BASE_URL + MLC_MODEL env vars.
 *
 * Usage:
 *   npx tsx scripts/run-pedagogical-fpr.ts --hunter-only
 *
 *   MLC_BASE_URL=http://localhost:8001/v1 \
 *   MLC_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC \
 *     npx tsx scripts/run-pedagogical-fpr.ts
 *
 * Output: docs/testing/phase5/pedagogical-fpr-results.json
 * Methodology: docs/testing/phase5/PEDAGOGICAL_BASELINE.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  PEDAGOGICAL_HUNTERS,
  bandFromScore,
  classifyEntryPath,
  parseCorpusJsonl,
  summarizeFpr,
  summarizePathDistribution,
  type CorpusEntry,
  type PathClassification,
  type PerEntryResult,
  type ProbeRunRow,
} from './run-pedagogical-fpr-helpers.js';
import type { EvidencePacket, Probe } from '@/probes/base-probe.js';
import { evidenceReviewProbe } from '@/probes/evidence-review.js';
import { instructionDetectionProbe } from '@/probes/instruction-detection.js';
import { adversarialComplianceProbe } from '@/probes/adversarial-compliance.js';
import { summarizationProbe } from '@/probes/summarization.js';
import { THRESHOLD_COMPROMISED, THRESHOLD_SUSPICIOUS } from '@/shared/constants.js';

const REPO_ROOT = resolve(import.meta.dirname!, '..');
const CORPUS_PATH = resolve(REPO_ROOT, 'docs/testing/phase5/pedagogical-corpus.jsonl');
const RESULTS_PATH = resolve(REPO_ROOT, 'docs/testing/phase5/pedagogical-fpr-results.json');

const args = process.argv.slice(2);
const HUNTER_ONLY = args.includes('--hunter-only');
const DRY_RUN = args.includes('--dry-run');

const BASE_URL = process.env.MLC_BASE_URL ?? 'http://localhost:8001/v1';
const MODEL = process.env.MLC_MODEL ?? '';

async function callLlm(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });
  const data = (await res.json()) as {
    readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
    readonly error?: unknown;
  };
  if (data.error !== undefined) {
    throw new Error(`LLM error: ${JSON.stringify(data.error).slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`LLM response missing choices[0].message.content: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return content;
}

async function runChunkProbe(probe: Probe, chunk: string): Promise<ProbeRunRow> {
  const userMessage = probe.buildUserMessage(chunk);
  try {
    const rawOutput = await callLlm(probe.systemPrompt, userMessage);
    const analysis = probe.analyzeResponse(rawOutput, chunk);
    return {
      probe: probe.name,
      passed: analysis.passed,
      flags: analysis.flags,
      score: analysis.score,
      rawOutput,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { probe: probe.name, passed: false, flags: [], score: 0, rawOutput: '', errorMessage: message };
  }
}

async function runPacketProbe(probe: Probe, packet: EvidencePacket, chunkText: string): Promise<ProbeRunRow> {
  const userMessage = probe.buildPacketMessage
    ? probe.buildPacketMessage(packet)
    : probe.buildUserMessage(chunkText);
  try {
    const rawOutput = await callLlm(probe.systemPrompt, userMessage);
    const analysis = probe.analyzeResponse(rawOutput, packet.flagged);
    return {
      probe: probe.name,
      passed: analysis.passed,
      flags: analysis.flags,
      score: analysis.score,
      rawOutput,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { probe: probe.name, passed: false, flags: [], score: 0, rawOutput: '', errorMessage: message };
  }
}

const PATH_B_PROBES: readonly Probe[] = [summarizationProbe, instructionDetectionProbe, adversarialComplianceProbe];

async function evaluateEntry(entry: CorpusEntry, classification: PathClassification): Promise<PerEntryResult> {
  const probes: ProbeRunRow[] = [];
  if (!HUNTER_ONLY) {
    if (classification.path === 'A') {
      for (const packet of classification.packets) {
        probes.push(await runPacketProbe(evidenceReviewProbe, packet, entry.text));
      }
      probes.push(await runChunkProbe(summarizationProbe, entry.text));
    } else {
      for (const probe of PATH_B_PROBES) {
        probes.push(await runChunkProbe(probe, entry.text));
      }
    }
  }
  const huntScore = classification.huntReport.totalScore;
  const probeScore = probes.reduce((sum, p) => sum + p.score, 0);
  const verdictTotalScore = huntScore + probeScore;
  const verdictBand = bandFromScore(verdictTotalScore, THRESHOLD_SUSPICIOUS, THRESHOLD_COMPROMISED);
  return {
    id: entry.id,
    source: entry.source,
    category: entry.category,
    path: classification.path,
    huntFlags: classification.huntReport.flags,
    huntScore,
    hunterPackets: classification.packets.length,
    probes,
    verdictTotalScore,
    verdictBand,
    verdictExpected: 'BENIGN',
    isFalsePositiveAnyBand: verdictBand !== 'BENIGN',
    isFalsePositiveCompromised: verdictBand === 'COMPROMISED',
  };
}

interface ResultsFile {
  readonly schema_version: '1.0';
  readonly issue: 120;
  readonly methodology: 'pedagogical-fpr-runner';
  readonly run_date: string;
  readonly mode: 'hunter-only' | 'full' | 'dry-run';
  readonly engine: { readonly base_url: string; readonly model: string } | null;
  readonly hunters: readonly string[];
  readonly distribution: ReturnType<typeof summarizePathDistribution>;
  readonly fpr: ReturnType<typeof summarizeFpr>;
  readonly threshold_suspicious: number;
  readonly threshold_compromised: number;
  readonly target_fpr: number;
  readonly results: readonly PerEntryResult[];
}

async function main(): Promise<void> {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(`Corpus not found at ${CORPUS_PATH}. Run from repo root.`);
  }
  if (!HUNTER_ONLY && MODEL.length === 0) {
    throw new Error('Set MLC_MODEL env var or pass --hunter-only. See docs/testing/phase5/PEDAGOGICAL_BASELINE.md');
  }
  const corpus = parseCorpusJsonl(readFileSync(CORPUS_PATH, 'utf-8'));
  console.log(`Loaded ${corpus.length} corpus entries from ${CORPUS_PATH}`);
  console.log(`Mode: ${HUNTER_ONLY ? 'hunter-only' : DRY_RUN ? 'dry-run' : 'full'}${HUNTER_ONLY ? '' : ` (model=${MODEL}, base=${BASE_URL})`}`);

  const classifications: PathClassification[] = [];
  for (const entry of corpus) {
    classifications.push(await classifyEntryPath(entry));
  }
  const distribution = summarizePathDistribution(corpus, classifications);
  console.log(`Path distribution: A=${distribution.pathACount} B=${distribution.pathBCount} (of ${distribution.total})`);
  console.log(`  Path A by category: ${JSON.stringify(distribution.pathAByCategory)}`);
  console.log(`  Path B by category: ${JSON.stringify(distribution.pathBByCategory)}`);

  const results: PerEntryResult[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const entry = corpus[i]!;
    const cls = classifications[i]!;
    const row = await evaluateEntry(entry, cls);
    results.push(row);
    const pct = Math.round(((i + 1) / corpus.length) * 100);
    process.stdout.write(
      `[${pct}%] ${entry.id.padEnd(40).slice(0, 40)} path=${cls.path} score=${row.verdictTotalScore} band=${row.verdictBand}\n`,
    );
    if (DRY_RUN && results.length === 1) {
      console.log('--dry-run: stopping after first row');
      break;
    }
  }

  const fpr = summarizeFpr(results);
  const fmt = (p: { readonly fp: number; readonly total: number; readonly fpr: number | null }): string =>
    `${p.fp}/${p.total} = ${p.fpr === null ? 'N/A' : p.fpr.toFixed(3)}`;
  console.log('\nFPR per path (any-band: SUSPICIOUS or COMPROMISED):');
  console.log(`  Path A: ${fmt(fpr.anyBand.pathA)}`);
  console.log(`  Path B: ${fmt(fpr.anyBand.pathB)}`);
  console.log('FPR per path (compromised band only):');
  console.log(`  Path A: ${fmt(fpr.compromised.pathA)}`);
  console.log(`  Path B: ${fmt(fpr.compromised.pathB)}`);
  console.log(`  Target: < 0.10 (issue #120 scope gate)`);

  const out: ResultsFile = {
    schema_version: '1.0',
    issue: 120,
    methodology: 'pedagogical-fpr-runner',
    run_date: new Date().toISOString(),
    mode: HUNTER_ONLY ? 'hunter-only' : DRY_RUN ? 'dry-run' : 'full',
    engine: HUNTER_ONLY ? null : { base_url: BASE_URL, model: MODEL },
    hunters: PEDAGOGICAL_HUNTERS.map((h) => h.name),
    distribution,
    fpr,
    threshold_suspicious: THRESHOLD_SUSPICIOUS,
    threshold_compromised: THRESHOLD_COMPROMISED,
    target_fpr: 0.1,
    results,
  };

  mkdirSync(resolve(RESULTS_PATH, '..'), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${results.length} rows to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
