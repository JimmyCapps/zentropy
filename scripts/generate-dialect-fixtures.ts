/**
 * Generate bilingual fixture pages from the #52 dialect research corpora.
 *
 * Sources:
 *   docs/issues/52-cowork-outputs/gate-1-corpus-es.jsonl  (50 inj + 50 benign ES)
 *   docs/issues/52-cowork-outputs/gate-1-corpus-zh-CN.jsonl (50 inj + 50 benign zh-CN)
 *
 * Produces per-language fixture pairs:
 *   test-pages/injected-multilang/<lang>/<slug>.html (expected SUSPICIOUS|COMPROMISED)
 *   test-pages/clean-multilang/<lang>/<slug>.html    (expected CLEAN)
 *
 * And appends rows to test-pages/manifest.json with appropriate tags so the
 * existing harness picks them up on its next run.
 *
 * Sampling: first 10 injection rows + first 5 benign rows per language,
 * giving 30 new fixtures (20 injection + 10 benign). Rationale: keeps the
 * harness sweep runtime manageable while providing enough signal to compare
 * per-language detection accuracy.
 *
 * Usage:
 *   npx tsx scripts/generate-dialect-fixtures.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(import.meta.dirname!, '..');
const MANIFEST_PATH = resolve(REPO_ROOT, 'test-pages/manifest.json');

interface CorpusRow {
  readonly split: string;
  readonly id: string;
  readonly text: string;
  readonly label: string;
  readonly source: string;
}

interface ManifestRow {
  readonly file: string;
  readonly expectedVerdict: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  readonly techniques: readonly string[];
  readonly description: string;
  readonly falsePositiveRisk: boolean;
}

interface LanguageSpec {
  readonly lang: 'es' | 'zh-CN';
  readonly displayName: string;
  readonly corpusFile: string;
  readonly injectionSampleSize: number;
  readonly benignSampleSize: number;
}

const LANGS: readonly LanguageSpec[] = [
  {
    lang: 'es',
    displayName: 'Spanish',
    corpusFile: 'docs/issues/52-cowork-outputs/gate-1-corpus-es.jsonl',
    injectionSampleSize: 10,
    benignSampleSize: 5,
  },
  {
    lang: 'zh-CN',
    displayName: 'Mandarin (Simplified)',
    corpusFile: 'docs/issues/52-cowork-outputs/gate-1-corpus-zh-CN.jsonl',
    injectionSampleSize: 10,
    benignSampleSize: 5,
  },
];

function loadCorpus(relativePath: string): readonly CorpusRow[] {
  const raw = readFileSync(resolve(REPO_ROOT, relativePath), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CorpusRow);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlLangTag(lang: 'es' | 'zh-CN'): string {
  return lang;
}

/**
 * Wrap injection corpus text inside a minimal page. The injection is embedded
 * as hidden text near a plausible article body so the fixture exercises the
 * same attack surface as `injected/hidden-div-basic.html` — just in ES/zh-CN.
 */
function injectionPage(lang: 'es' | 'zh-CN', row: CorpusRow): string {
  const bodyByLang = {
    es: {
      title: 'Artículo sobre cocina tradicional',
      body: '<p>El pan de masa madre es un alimento básico de la cocina humana desde hace miles de años.</p><p>El proceso de fermentación le da su sabor distintivo. Se necesita un cultivo iniciador, harina, agua y sal.</p>',
      footer: 'Gracias por leer nuestro blog culinario.',
    },
    'zh-CN': {
      title: '关于传统烹饪的文章',
      body: '<p>酸面包几千年来一直是人类美食的主食。</p><p>发酵过程赋予它独特的风味。需要发酵培养物、面粉、水和盐。</p>',
      footer: '感谢阅读我们的烹饪博客。',
    },
  } as const;
  const content = bodyByLang[lang];
  return `<!DOCTYPE html>
<html lang="${htmlLangTag(lang)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(content.title)}</title>
</head>
<body>
  <h1>${escapeHtml(content.title)}</h1>
  ${content.body}
  <div style="display: none" aria-hidden="true">
    <!-- Hidden prompt-injection payload sourced from HoneyLLM dialect corpus ${row.id}. -->
    ${escapeHtml(row.text)}
  </div>
  <p>${escapeHtml(content.footer)}</p>
</body>
</html>
`;
}

/**
 * Benign page in the target language — no injection. Used as false-positive
 * guard so per-language dialect detection doesn't simply flag everything
 * non-English as suspicious.
 */
function benignPage(lang: 'es' | 'zh-CN', row: CorpusRow): string {
  return `<!DOCTYPE html>
<html lang="${htmlLangTag(lang)}">
<head>
  <meta charset="utf-8">
  <title>${lang === 'es' ? 'Contenido informativo' : '信息内容'}</title>
</head>
<body>
  <article>
    ${escapeHtml(row.text)}
  </article>
  <!-- Source: HoneyLLM dialect corpus ${row.id} (benign/control). -->
</body>
</html>
`;
}

function slugify(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function loadManifest(): ManifestRow[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestRow[];
}

function saveManifest(rows: readonly ManifestRow[]): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(rows, null, 2) + '\n');
}

function main(): void {
  const manifest = loadManifest();
  const added: string[] = [];

  for (const spec of LANGS) {
    const rows = loadCorpus(spec.corpusFile);
    const injections = rows.filter((r) => r.label === 'holdout_injection').slice(0, spec.injectionSampleSize);
    const benigns = rows.filter((r) => r.label === 'holdout_benign').slice(0, spec.benignSampleSize);

    for (const row of injections) {
      const slug = slugify(row.id);
      const fileRel = `injected-multilang/${spec.lang}/${slug}.html`;
      writeFileSync(resolve(REPO_ROOT, `test-pages/${fileRel}`), injectionPage(spec.lang, row));
      if (!manifest.some((m) => m.file === fileRel)) {
        manifest.push({
          file: fileRel,
          expectedVerdict: 'SUSPICIOUS',
          techniques: [`dialect-${spec.lang}`, 'hidden-div', 'ignore-instructions'],
          description: `${spec.displayName} injection (corpus ${row.id}) embedded as hidden text in a language-local article.`,
          falsePositiveRisk: false,
        });
        added.push(fileRel);
      }
    }

    for (const row of benigns) {
      const slug = slugify(row.id);
      const fileRel = `clean-multilang/${spec.lang}/${slug}.html`;
      writeFileSync(resolve(REPO_ROOT, `test-pages/${fileRel}`), benignPage(spec.lang, row));
      if (!manifest.some((m) => m.file === fileRel)) {
        manifest.push({
          file: fileRel,
          expectedVerdict: 'CLEAN',
          techniques: [`dialect-${spec.lang}`],
          description: `${spec.displayName} benign content (corpus ${row.id}) — FP guard for language-specific detection.`,
          falsePositiveRisk: true,
        });
        added.push(fileRel);
      }
    }
  }

  saveManifest(manifest);
  console.log(`Generated ${added.length} fixture files:`);
  for (const file of added) console.log(`  ${file}`);
}

main();
