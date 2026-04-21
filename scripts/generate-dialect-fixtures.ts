/**
 * Generate full-corpus fixture pages from the #52 dialect research JSONL files.
 *
 * Sources:
 *   docs/issues/52-cowork-outputs/gate-1-corpus.jsonl        (1050 EN: 500 inj + 500 benign + 50 calibration)
 *   docs/issues/52-cowork-outputs/gate-1-corpus-es.jsonl     (100 ES:   50 inj +  50 benign)
 *   docs/issues/52-cowork-outputs/gate-1-corpus-zh-CN.jsonl  (100 zh-CN: 50 inj + 50 benign)
 *
 * Produces per-language fixture pairs:
 *   test-pages/injected-corpus/<lang>/<slug>.html (expected SUSPICIOUS|COMPROMISED)
 *   test-pages/clean-corpus/<lang>/<slug>.html    (expected CLEAN)
 *
 * Writes test-pages/manifest-dialect.json listing every fixture with
 * language + expected-verdict tags so a harness filter can run subsets
 * per language or per label class.
 *
 * Label schemas differ between corpora:
 *   - EN uses `injection` / `benign` / `benign_calibration`.
 *   - ES and zh-CN use `holdout_injection` / `holdout_benign`.
 * This generator normalises both into `inj` / `clean` buckets.
 *
 * Usage:
 *   npx tsx scripts/generate-dialect-fixtures.ts
 *
 * Idempotent: re-running overwrites existing fixtures + manifest; safe to
 * run multiple times. Clears the entire injected-corpus/ and clean-corpus/
 * dirs before writing so stale rows from prior runs don't linger.
 */

import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(import.meta.dirname!, '..');
const MANIFEST_PATH = resolve(REPO_ROOT, 'test-pages/manifest-dialect.json');
const INJECTED_DIR = resolve(REPO_ROOT, 'test-pages/injected-corpus');
const CLEAN_DIR = resolve(REPO_ROOT, 'test-pages/clean-corpus');

interface CorpusRow {
  readonly split?: string;
  readonly id: string;
  readonly text: string;
  readonly label: string;
  readonly source?: string;
}

interface ManifestRow {
  readonly file: string;
  readonly expectedVerdict: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  readonly techniques: readonly string[];
  readonly description: string;
  readonly falsePositiveRisk: boolean;
}

type LangCode = 'en' | 'es' | 'zh-CN';

interface LanguageSpec {
  readonly lang: LangCode;
  readonly displayName: string;
  readonly corpusFile: string;
  readonly htmlLang: string;
  readonly benignScaffold: {
    readonly title: string;
    readonly body: string;
    readonly footer: string;
  };
}

const LANGS: readonly LanguageSpec[] = [
  {
    lang: 'en',
    displayName: 'English',
    corpusFile: 'docs/issues/52-cowork-outputs/gate-1-corpus.jsonl',
    htmlLang: 'en',
    benignScaffold: {
      title: 'Article about traditional cooking',
      body: '<p>Sourdough bread has been a staple of human cuisine for thousands of years.</p><p>The fermentation process gives it a distinctive flavour. You need a starter culture, flour, water, and salt.</p>',
      footer: 'Thank you for reading our culinary blog.',
    },
  },
  {
    lang: 'es',
    displayName: 'Spanish',
    corpusFile: 'docs/issues/52-cowork-outputs/gate-1-corpus-es.jsonl',
    htmlLang: 'es',
    benignScaffold: {
      title: 'Artículo sobre cocina tradicional',
      body: '<p>El pan de masa madre es un alimento básico de la cocina humana desde hace miles de años.</p><p>El proceso de fermentación le da su sabor distintivo. Se necesita un cultivo iniciador, harina, agua y sal.</p>',
      footer: 'Gracias por leer nuestro blog culinario.',
    },
  },
  {
    lang: 'zh-CN',
    displayName: 'Mandarin (Simplified)',
    corpusFile: 'docs/issues/52-cowork-outputs/gate-1-corpus-zh-CN.jsonl',
    htmlLang: 'zh-CN',
    benignScaffold: {
      title: '关于传统烹饪的文章',
      body: '<p>酸面包几千年来一直是人类美食的主食。</p><p>发酵过程赋予它独特的风味。需要发酵培养物、面粉、水和盐。</p>',
      footer: '感谢阅读我们的烹饪博客。',
    },
  },
];

function loadCorpus(relativePath: string): readonly CorpusRow[] {
  const raw = readFileSync(resolve(REPO_ROOT, relativePath), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CorpusRow);
}

/**
 * Normalise disparate label names across corpora into two buckets.
 * EN corpus uses `injection` / `benign` / `benign_calibration`.
 * ES + zh-CN use `holdout_injection` / `holdout_benign`.
 */
function labelBucket(row: CorpusRow): 'inj' | 'clean' {
  return row.label.includes('injection') ? 'inj' : 'clean';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectionPage(spec: LanguageSpec, row: CorpusRow): string {
  return `<!DOCTYPE html>
<html lang="${spec.htmlLang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(spec.benignScaffold.title)}</title>
</head>
<body>
  <h1>${escapeHtml(spec.benignScaffold.title)}</h1>
  ${spec.benignScaffold.body}
  <div style="display: none" aria-hidden="true">
    <!-- Hidden prompt-injection payload from HoneyLLM dialect corpus ${row.id}. -->
    ${escapeHtml(row.text)}
  </div>
  <p>${escapeHtml(spec.benignScaffold.footer)}</p>
</body>
</html>
`;
}

function benignPage(spec: LanguageSpec, row: CorpusRow): string {
  const titleByLang: Record<LangCode, string> = {
    en: 'Informational content',
    es: 'Contenido informativo',
    'zh-CN': '信息内容',
  };
  return `<!DOCTYPE html>
<html lang="${spec.htmlLang}">
<head>
  <meta charset="utf-8">
  <title>${titleByLang[spec.lang]}</title>
</head>
<body>
  <article>
    ${escapeHtml(row.text)}
  </article>
  <!-- Source: HoneyLLM dialect corpus ${row.id} (benign / control). -->
</body>
</html>
`;
}

function slugify(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function rmRfIfExists(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function main(): void {
  // Clear prior output so renamed or dropped rows don't leave orphans.
  rmRfIfExists(INJECTED_DIR);
  rmRfIfExists(CLEAN_DIR);

  const manifest: ManifestRow[] = [];
  let writtenInj = 0;
  let writtenClean = 0;

  for (const spec of LANGS) {
    const rows = loadCorpus(spec.corpusFile);
    const injections = rows.filter((r) => labelBucket(r) === 'inj');
    const benigns = rows.filter((r) => labelBucket(r) === 'clean');

    const injDir = resolve(INJECTED_DIR, spec.lang);
    const cleanDir = resolve(CLEAN_DIR, spec.lang);
    mkdirSync(injDir, { recursive: true });
    mkdirSync(cleanDir, { recursive: true });

    for (const row of injections) {
      const slug = slugify(row.id);
      const fileRel = `injected-corpus/${spec.lang}/${slug}.html`;
      writeFileSync(resolve(REPO_ROOT, 'test-pages', fileRel), injectionPage(spec, row));
      manifest.push({
        file: fileRel,
        expectedVerdict: 'SUSPICIOUS',
        techniques: [`dialect-${spec.lang}`, 'hidden-div', 'corpus-injection'],
        description: `${spec.displayName} injection (corpus ${row.id}) embedded as hidden text in a language-local article.`,
        falsePositiveRisk: false,
      });
      writtenInj += 1;
    }

    for (const row of benigns) {
      const slug = slugify(row.id);
      const fileRel = `clean-corpus/${spec.lang}/${slug}.html`;
      writeFileSync(resolve(REPO_ROOT, 'test-pages', fileRel), benignPage(spec, row));
      manifest.push({
        file: fileRel,
        expectedVerdict: 'CLEAN',
        techniques: [`dialect-${spec.lang}`, `corpus-${row.label}`],
        description: `${spec.displayName} benign content (corpus ${row.id}) — FP guard for language-specific detection.`,
        falsePositiveRisk: true,
      });
      writtenClean += 1;
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Wrote ${manifest.length} fixtures (${writtenInj} injection + ${writtenClean} benign)`);
  for (const spec of LANGS) {
    const perLang = manifest.filter((m) => m.file.includes(`/${spec.lang}/`));
    const inj = perLang.filter((m) => m.file.startsWith('injected-corpus/')).length;
    const clean = perLang.filter((m) => m.file.startsWith('clean-corpus/')).length;
    console.log(`  ${spec.displayName.padEnd(22)} ${inj} injection + ${clean} benign = ${perLang.length}`);
  }
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

main();
