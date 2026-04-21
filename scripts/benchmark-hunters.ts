/**
 * Benchmark: Spider + Hawk v1 against test-pages/ fixtures.
 *
 * Reads test-pages/manifest.json, extracts text from each HTML fixture,
 * runs both hunters, compares predictions vs expected verdicts, and
 * reports precision / recall / F1.
 *
 * The fixture set includes three FP-risk clean pages (security-blog,
 * code-tutorial, accessibility-heavy) and three borderline adversarial
 * pages (security-advisory, ai-research-paper, chatbot-help) that
 * contain injection-like tokens in legitimate context. A useful
 * classifier must handle both.
 *
 * Usage: npx tsx scripts/benchmark-hunters.ts [--verbose]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spiderHunter } from '../src/hunters/spider/index.js';
import { hawkHunter } from '../src/hunters/hawk/index.js';
import type { HunterResult } from '../src/hunters/base-hunter.js';
import { THRESHOLD_SUSPICIOUS, THRESHOLD_COMPROMISED } from '../src/shared/constants.js';

const MANIFEST_PATH = resolve(process.cwd(), 'test-pages/manifest.json');
const TEST_PAGES_DIR = resolve(process.cwd(), 'test-pages');
const VERBOSE = process.argv.includes('--verbose');

type Verdict = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';

interface Fixture {
  readonly file: string;
  readonly expectedVerdict: Verdict;
  readonly techniques: readonly string[];
  readonly description: string;
  readonly falsePositiveRisk: boolean;
}

interface Prediction {
  readonly hunter: string;
  readonly verdict: Verdict;
  readonly score: number;
  readonly confidence: number;
  readonly flags: readonly string[];
}

interface Row {
  readonly fixture: Fixture;
  readonly textLength: number;
  readonly spider: Prediction;
  readonly hawk: Prediction;
  readonly combined: Prediction;
}

interface Stats {
  readonly tp: number;
  readonly tn: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly bandAccuracy: number;
}

/**
 * Extract text as HoneyLLM's content script would see it: combined
 * visible text + hidden DOM text + attribute content (alt, aria, meta,
 * data-*, noscript). Mirrors what src/content/ingestion/* produces.
 */
function extractText(html: string): string {
  const attrPattern = /(?:alt|aria-label|aria-description|data-[a-z-]+|content|title)=["']([^"']+)["']/gi;
  const attrValues = [...html.matchAll(attrPattern)].map((m) => m[1]!);

  let body = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

  body = body.replace(/<[^>]+>/g, ' ');

  body = body
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  return [body, ...attrValues].join(' ').replace(/\s+/g, ' ').trim();
}

function scoreToVerdict(score: number): Verdict {
  if (score >= THRESHOLD_COMPROMISED) return 'COMPROMISED';
  if (score >= THRESHOLD_SUSPICIOUS) return 'SUSPICIOUS';
  return 'CLEAN';
}

function toPrediction(result: HunterResult): Prediction {
  return {
    hunter: result.hunterName,
    verdict: scoreToVerdict(result.score),
    score: result.score,
    confidence: result.confidence,
    flags: result.flags,
  };
}

function combinePredictions(a: Prediction, b: Prediction): Prediction {
  const score = a.score + b.score;
  return {
    hunter: `${a.hunter}+${b.hunter}`,
    verdict: scoreToVerdict(score),
    score,
    confidence: Math.max(a.confidence, b.confidence),
    flags: [...a.flags, ...b.flags],
  };
}

function computeStats(rows: readonly Row[], pick: (r: Row) => Prediction): Stats {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let bandCorrect = 0;

  for (const row of rows) {
    const predicted = pick(row);
    const expectedFlag = row.fixture.expectedVerdict !== 'CLEAN';
    const predictedFlag = predicted.verdict !== 'CLEAN';

    if (expectedFlag && predictedFlag) tp += 1;
    else if (!expectedFlag && !predictedFlag) tn += 1;
    else if (!expectedFlag && predictedFlag) fp += 1;
    else fn += 1;

    if (predicted.verdict === row.fixture.expectedVerdict) bandCorrect += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const bandAccuracy = rows.length === 0 ? 0 : bandCorrect / rows.length;

  return { tp, tn, fp, fn, precision, recall, f1, bandAccuracy };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function formatStats(name: string, s: Stats, total: number): string {
  const lines = [
    `${name}`,
    `  TP=${s.tp}  TN=${s.tn}  FP=${s.fp}  FN=${s.fn}`,
    `  Precision: ${(s.precision * 100).toFixed(1)}%    (of flagged, how many were real attacks)`,
    `  Recall:    ${(s.recall * 100).toFixed(1)}%    (of real attacks, how many were caught)`,
    `  F1 score:  ${(s.f1 * 100).toFixed(1)}%`,
    `  Band acc:  ${(s.bandAccuracy * 100).toFixed(1)}%    (exact CLEAN/SUSPICIOUS/COMPROMISED match, ${Math.round(s.bandAccuracy * total)}/${total})`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const manifest: readonly Fixture[] = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const rows: Row[] = [];

  for (const fixture of manifest) {
    const html = readFileSync(resolve(TEST_PAGES_DIR, fixture.file), 'utf-8');
    const text = extractText(html);

    const spiderResult = await spiderHunter.scan(text);
    const hawkResult = await hawkHunter.scan(text);
    const spider = toPrediction(spiderResult);
    const hawk = toPrediction(hawkResult);
    const combined = combinePredictions(spider, hawk);

    rows.push({ fixture, textLength: text.length, spider, hawk, combined });
  }

  const fixtureColWidth = 42;
  console.log('');
  console.log('== Per-fixture results ==');
  console.log('');
  console.log(
    pad('Fixture', fixtureColWidth) +
      pad('Expected', 14) +
      pad('Spider', 16) +
      pad('Hawk', 22) +
      pad('S+H', 16) +
      'Notes',
  );
  console.log('-'.repeat(fixtureColWidth + 80));

  for (const row of rows) {
    const fixtureLabel = (row.fixture.falsePositiveRisk ? '* ' : '  ') + row.fixture.file;
    const spiderMiss = row.spider.verdict !== row.fixture.expectedVerdict ? ' MISS' : '';
    const hawkMiss = row.hawk.verdict !== row.fixture.expectedVerdict ? ' MISS' : '';
    const combinedMiss = row.combined.verdict !== row.fixture.expectedVerdict ? ' MISS' : '';

    const spiderCol = `${row.spider.verdict}(${row.spider.score})${spiderMiss}`;
    const hawkCol = `${row.hawk.verdict}(${row.hawk.score},p=${row.hawk.confidence.toFixed(2)})${hawkMiss}`;
    const combinedCol = `${row.combined.verdict}(${row.combined.score})${combinedMiss}`;

    console.log(
      pad(fixtureLabel, fixtureColWidth) +
        pad(row.fixture.expectedVerdict, 14) +
        pad(spiderCol, 16) +
        pad(hawkCol, 22) +
        pad(combinedCol, 16) +
        (row.fixture.falsePositiveRisk ? 'FP-risk' : ''),
    );

    if (VERBOSE) {
      if (row.hawk.flags.length > 0) {
        console.log(`      hawk flags: ${row.hawk.flags.join(', ')}`);
      }
      if (row.spider.flags.length > 0) {
        console.log(`      spider flags: ${row.spider.flags.join(', ')}`);
      }
    }
  }

  console.log('');
  console.log('* = high FP risk (clean page with injection-like tokens in legitimate context)');

  console.log('');
  console.log('== Binary detection stats (SUSPICIOUS+COMPROMISED vs CLEAN) ==');
  console.log('');
  console.log(formatStats('Spider', computeStats(rows, (r) => r.spider), rows.length));
  console.log('');
  console.log(formatStats('Hawk', computeStats(rows, (r) => r.hawk), rows.length));
  console.log('');
  console.log(formatStats('Spider + Hawk (score sum)', computeStats(rows, (r) => r.combined), rows.length));

  console.log('');
  console.log('== Misses ==');
  console.log('');
  const misses = rows.filter(
    (r) =>
      r.spider.verdict !== r.fixture.expectedVerdict ||
      r.hawk.verdict !== r.fixture.expectedVerdict ||
      r.combined.verdict !== r.fixture.expectedVerdict,
  );
  if (misses.length === 0) {
    console.log('  (none — every hunter matched every fixture\'s expected band)');
  } else {
    for (const row of misses) {
      console.log(`  ${row.fixture.file} (expected ${row.fixture.expectedVerdict})`);
      if (row.spider.verdict !== row.fixture.expectedVerdict) {
        console.log(`      spider → ${row.spider.verdict} (score ${row.spider.score})`);
      }
      if (row.hawk.verdict !== row.fixture.expectedVerdict) {
        console.log(`      hawk   → ${row.hawk.verdict} (score ${row.hawk.score}, p=${row.hawk.confidence.toFixed(3)})`);
      }
      if (row.combined.verdict !== row.fixture.expectedVerdict) {
        console.log(`      S+H    → ${row.combined.verdict} (score ${row.combined.score})`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
