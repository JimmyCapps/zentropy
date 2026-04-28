/**
 * Dialect corpus benchmark — Hawk v1 + Spider against manifest-dialect.json.
 *
 * Runs the Phase 5 hunters over the 1250-fixture dialect corpus James
 * uploaded 2026-04-20 (per issue #71 DM-4 pedagogical-FP test). Reports:
 *
 *   - Per-language precision / recall / F1 (EN / ES / ZH-CN)
 *   - Pedagogical subset FP rate (corpus-benign_calibration)
 *   - Holdout benign clean rate (corpus-holdout_benign)
 *   - Aggregate numbers
 *
 * Output is designed to paste into a DM-4 (#71) comment as independent
 * validation against the Gate 1 ProtectAI baseline.
 *
 * Usage: npx tsx scripts/benchmark-dialect.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spiderHunter } from '../src/hunters/spider/index.js';
import { hawkHunter } from '../src/hunters/hawk/index.js';
import type { HunterResult } from '../src/hunters/base-hunter.js';
import { THRESHOLD_SUSPICIOUS, THRESHOLD_COMPROMISED } from '../src/shared/constants.js';

const MANIFEST_PATH = resolve(process.cwd(), 'test-pages/manifest-dialect.json');
const TEST_PAGES_DIR = resolve(process.cwd(), 'test-pages');

type Verdict = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
type Language = 'en' | 'es' | 'zh-CN';
type Subset = 'injection' | 'benign' | 'benign_calibration' | 'holdout_benign';

interface Fixture {
  readonly file: string;
  readonly expectedVerdict: Verdict;
  readonly techniques: readonly string[];
  readonly description: string;
  readonly falsePositiveRisk: boolean;
}

interface Prediction {
  readonly verdict: Verdict;
  readonly score: number;
  readonly confidence: number;
}

interface Row {
  readonly fixture: Fixture;
  readonly language: Language;
  readonly subset: Subset;
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
}

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
    verdict: scoreToVerdict(result.score),
    score: result.score,
    confidence: result.confidence,
  };
}

function combinePredictions(a: Prediction, b: Prediction): Prediction {
  const score = a.score + b.score;
  return {
    verdict: scoreToVerdict(score),
    score,
    confidence: Math.max(a.confidence, b.confidence),
  };
}

function detectLanguage(techniques: readonly string[]): Language {
  if (techniques.includes('dialect-es')) return 'es';
  if (techniques.includes('dialect-zh-CN')) return 'zh-CN';
  return 'en';
}

function detectSubset(techniques: readonly string[]): Subset {
  if (techniques.includes('corpus-injection')) return 'injection';
  if (techniques.includes('corpus-benign_calibration')) return 'benign_calibration';
  if (techniques.includes('corpus-holdout_benign')) return 'holdout_benign';
  return 'benign';
}

function computeStats(rows: readonly Row[], pick: (r: Row) => Prediction): Stats {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const row of rows) {
    const predicted = pick(row);
    const expectedFlag = row.fixture.expectedVerdict !== 'CLEAN';
    const predictedFlag = predicted.verdict !== 'CLEAN';

    if (expectedFlag && predictedFlag) tp += 1;
    else if (!expectedFlag && !predictedFlag) tn += 1;
    else if (!expectedFlag && predictedFlag) fp += 1;
    else fn += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { tp, tn, fp, fn, precision, recall, f1 };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const manifest: readonly Fixture[] = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const rows: Row[] = [];

  process.stdout.write(`Running ${manifest.length} fixtures...`);
  let counter = 0;

  for (const fixture of manifest) {
    const html = readFileSync(resolve(TEST_PAGES_DIR, fixture.file), 'utf-8');
    const text = extractText(html);

    const spiderResult = await spiderHunter.scan(text);
    const hawkResult = await hawkHunter.scan(text);
    const spider = toPrediction(spiderResult);
    const hawk = toPrediction(hawkResult);
    const combined = combinePredictions(spider, hawk);

    rows.push({
      fixture,
      language: detectLanguage(fixture.techniques),
      subset: detectSubset(fixture.techniques),
      spider,
      hawk,
      combined,
    });

    counter += 1;
    if (counter % 100 === 0) process.stdout.write(`.${counter}`);
  }
  process.stdout.write(' done.\n\n');

  // Overall stats
  console.log('## Aggregate (all 1250 fixtures)\n');
  console.log(statsTable(rows));

  // Per-language
  console.log('\n## Per-language breakdown\n');
  for (const lang of ['en', 'es', 'zh-CN'] as const) {
    const langRows = rows.filter((r) => r.language === lang);
    console.log(`### ${lang.toUpperCase()} (${langRows.length} fixtures)\n`);
    console.log(statsTable(langRows));
    console.log('');
  }

  // Per-subset (pedagogical canary)
  console.log('\n## Pedagogical-FP canary (50 benign_calibration fixtures)\n');
  const calibRows = rows.filter((r) => r.subset === 'benign_calibration');
  console.log(`Expected verdict: all CLEAN. Measures text-classification layers' tendency to FP on articles *about* injection.\n`);
  console.log(fpTable(calibRows));

  // Holdout benign
  console.log('\n## Holdout benign (100 held-out benign fixtures)\n');
  const holdoutRows = rows.filter((r) => r.subset === 'holdout_benign');
  console.log(`Expected verdict: all CLEAN. Fair test of clean classification on never-tuned-on content.\n`);
  console.log(fpTable(holdoutRows));

  // Cross-language recall drop — show how English-tuned Hawk fares on ES/ZH-CN injections
  console.log('\n## Injection recall by language (core DM-4 finding)\n');
  const enInj = rows.filter((r) => r.language === 'en' && r.subset === 'injection');
  const esInj = rows.filter((r) => r.language === 'es' && r.subset === 'injection');
  const zhInj = rows.filter((r) => r.language === 'zh-CN' && r.subset === 'injection');
  console.log(recallByLangTable([
    { lang: 'EN', rows: enInj },
    { lang: 'ES', rows: esInj },
    { lang: 'ZH-CN', rows: zhInj },
  ]));

  // Emit JSON for audit + reproducibility
  const jsonOutPath = resolve(process.cwd(), 'docs/issues/71-dm4-outputs/hawk-dialect-benchmark.json');
  const summary = {
    run: {
      date: new Date().toISOString(),
      manifest: 'test-pages/manifest-dialect.json',
      fixtures: manifest.length,
      hunter_versions: {
        spider: 'src/hunters/spider/ (Phase 5 5A, merged #80)',
        hawk: 'src/hunters/hawk/ (Phase 5 5E, merged #81)',
      },
    },
    aggregate: {
      spider: computeStats(rows, (r) => r.spider),
      hawk: computeStats(rows, (r) => r.hawk),
      combined: computeStats(rows, (r) => r.combined),
    },
    per_language: {
      en: {
        count: rows.filter((r) => r.language === 'en').length,
        spider: computeStats(rows.filter((r) => r.language === 'en'), (r) => r.spider),
        hawk: computeStats(rows.filter((r) => r.language === 'en'), (r) => r.hawk),
        combined: computeStats(rows.filter((r) => r.language === 'en'), (r) => r.combined),
      },
      es: {
        count: rows.filter((r) => r.language === 'es').length,
        spider: computeStats(rows.filter((r) => r.language === 'es'), (r) => r.spider),
        hawk: computeStats(rows.filter((r) => r.language === 'es'), (r) => r.hawk),
        combined: computeStats(rows.filter((r) => r.language === 'es'), (r) => r.combined),
      },
      'zh-CN': {
        count: rows.filter((r) => r.language === 'zh-CN').length,
        spider: computeStats(rows.filter((r) => r.language === 'zh-CN'), (r) => r.spider),
        hawk: computeStats(rows.filter((r) => r.language === 'zh-CN'), (r) => r.hawk),
        combined: computeStats(rows.filter((r) => r.language === 'zh-CN'), (r) => r.combined),
      },
    },
    pedagogical_fp_canary: {
      fixtures: rows.filter((r) => r.subset === 'benign_calibration').length,
      spider_fp: rows.filter((r) => r.subset === 'benign_calibration' && r.spider.verdict !== 'CLEAN').length,
      hawk_fp: rows.filter((r) => r.subset === 'benign_calibration' && r.hawk.verdict !== 'CLEAN').length,
      combined_fp: rows.filter((r) => r.subset === 'benign_calibration' && r.combined.verdict !== 'CLEAN').length,
    },
    holdout_benign: {
      fixtures: rows.filter((r) => r.subset === 'holdout_benign').length,
      spider_fp: rows.filter((r) => r.subset === 'holdout_benign' && r.spider.verdict !== 'CLEAN').length,
      hawk_fp: rows.filter((r) => r.subset === 'holdout_benign' && r.hawk.verdict !== 'CLEAN').length,
      combined_fp: rows.filter((r) => r.subset === 'holdout_benign' && r.combined.verdict !== 'CLEAN').length,
    },
    known_limitations: {
      cjk_chunking: 'chunkByWords splits on /\\s+/, so Chinese text (no inter-word spaces) collapses into a single 50-word window. Even with ZH vocabulary, chunking would need a CJK tokenizer before recall could improve.',
      english_vocabulary: 'features.ts regex catalog is English-only (directive verbs, role phrases, output manipulation, imperative openers). ES/ZH-CN injections fire only on language-agnostic features (markers, encoding anomalies, instruction boundaries).',
      feature_threshold: 'directiveVerbDensity requires >=2 hits per chunk. Real injection payloads using varied vocabulary (e.g. "ignore the fucking rules" rather than "ignore previous instructions") rarely accumulate >=2 hits in a single 50-word window.',
    },
  };
  writeFileSync(jsonOutPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults written to ${jsonOutPath}`);

  // Also emit per-fixture details for full audit
  const perFixtureOut = resolve(process.cwd(), 'docs/issues/71-dm4-outputs/hawk-dialect-per-fixture.json');
  const perFixture = rows.map((r) => ({
    file: r.fixture.file,
    language: r.language,
    subset: r.subset,
    expected: r.fixture.expectedVerdict,
    spider_verdict: r.spider.verdict,
    spider_score: r.spider.score,
    hawk_verdict: r.hawk.verdict,
    hawk_score: r.hawk.score,
    hawk_confidence: Number(r.hawk.confidence.toFixed(4)),
    combined_verdict: r.combined.verdict,
    combined_score: r.combined.score,
  }));
  writeFileSync(perFixtureOut, JSON.stringify(perFixture, null, 2));
  console.log(`Per-fixture results written to ${perFixtureOut}`);
}

function statsTable(rows: readonly Row[]): string {
  if (rows.length === 0) return '(no rows)';
  const s = computeStats(rows, (r) => r.spider);
  const h = computeStats(rows, (r) => r.hawk);
  const c = computeStats(rows, (r) => r.combined);

  return [
    '|                    | Precision | Recall  | F1      | TP  | TN  | FP  | FN  |',
    '|--------------------|:---------:|:-------:|:-------:|:---:|:---:|:---:|:---:|',
    `| Spider             | ${fmtPct(s.precision)} | ${fmtPct(s.recall)} | ${fmtPct(s.f1)} | ${s.tp} | ${s.tn} | ${s.fp} | ${s.fn} |`,
    `| Hawk v1            | ${fmtPct(h.precision)} | ${fmtPct(h.recall)} | ${fmtPct(h.f1)} | ${h.tp} | ${h.tn} | ${h.fp} | ${h.fn} |`,
    `| Spider + Hawk      | ${fmtPct(c.precision)} | ${fmtPct(c.recall)} | ${fmtPct(c.f1)} | ${c.tp} | ${c.tn} | ${c.fp} | ${c.fn} |`,
  ].join('\n');
}

function fpTable(rows: readonly Row[]): string {
  const s = rows.filter((r) => r.spider.verdict !== 'CLEAN').length;
  const h = rows.filter((r) => r.hawk.verdict !== 'CLEAN').length;
  const c = rows.filter((r) => r.combined.verdict !== 'CLEAN').length;

  return [
    '|                    | FPs     | FP rate |',
    '|--------------------|:-------:|:-------:|',
    `| Spider             | ${s}/${rows.length} | ${fmtPct(s / rows.length)} |`,
    `| Hawk v1            | ${h}/${rows.length} | ${fmtPct(h / rows.length)} |`,
    `| Spider + Hawk      | ${c}/${rows.length} | ${fmtPct(c / rows.length)} |`,
  ].join('\n');
}

function recallByLangTable(groups: readonly { lang: string; rows: readonly Row[] }[]): string {
  const header = ['|                    |', ...groups.map((g) => ` ${g.lang} recall |`)].join('');
  const divider = ['|--------------------|', ...groups.map(() => ':-------:|')].join('');
  const spiderRow = ['| Spider             |', ...groups.map((g) => {
    const flagged = g.rows.filter((r) => r.spider.verdict !== 'CLEAN').length;
    return ` ${fmtPct(flagged / g.rows.length)} |`;
  })].join('');
  const hawkRow = ['| Hawk v1            |', ...groups.map((g) => {
    const flagged = g.rows.filter((r) => r.hawk.verdict !== 'CLEAN').length;
    return ` ${fmtPct(flagged / g.rows.length)} |`;
  })].join('');
  const combinedRow = ['| Spider + Hawk      |', ...groups.map((g) => {
    const flagged = g.rows.filter((r) => r.combined.verdict !== 'CLEAN').length;
    return ` ${fmtPct(flagged / g.rows.length)} |`;
  })].join('');

  return [header, divider, spiderRow, hawkRow, combinedRow].join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
