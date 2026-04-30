#!/usr/bin/env tsx
/**
 * Build the injection corpus for #129 (Tier 2.5 embeddings vector index).
 *
 * Stage 1 scope (this script): bootstrap a corpus file at
 * `data/injection-corpus.json` from materials already in the repo:
 *
 *   1. The hand-curated `test-pages/injected/*.html` honeypots (~15 entries
 *      with rich `techniques` metadata in `test-pages/manifest.json`).
 *   2. A balanced sample from the DM-4 1250-fixture corpus across
 *      `test-pages/injected-corpus/{en,es,zh-CN}/`. The DM-4 corpus was
 *      committed in PR #111 as part of issue #110.
 *
 * What this script does NOT do:
 *
 *   - Compute embeddings. The `embedding` field is left null. Stage 2 (a
 *     separate script using transformers.js) populates it.
 *   - Curate from public datasets (Lakera Gandalf, jailbreak-prompts,
 *     OWASP LLM Top 10). Those need licence + provenance review and are
 *     deferred to Stage 3.
 *
 * Per #129 schema: `{ id, source, text, lang, techniques, embedding }`.
 *
 * Usage:
 *   npx tsx scripts/build-injection-corpus.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
const TEST_PAGES = resolve(REPO_ROOT, 'test-pages');
const OUT_PATH = resolve(REPO_ROOT, 'data/injection-corpus.json');

interface ManifestEntry {
  readonly file: string;
  readonly expectedVerdict: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  readonly techniques: readonly string[];
  readonly description: string;
  readonly falsePositiveRisk: boolean;
}

interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: 'en' | 'es' | 'zh-CN';
  readonly techniques: readonly string[];
  readonly embedding: null;
}

/**
 * Extract the visible injection payload from a fixture HTML page. The
 * honeypot pages all stash the payload inside a `display:none`,
 * `aria-hidden="true"`, tiny-font, or comment-wrapped block. We strip all
 * tags and entities, collapse whitespace, and trim. The result is the
 * text the LLM-consumer actually sees if it rendered the hidden content.
 */
function extractPayload(html: string): string {
  // Pull body content out so we don't pick up titles or meta.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1]! : html;

  // Heuristic: prioritise content inside hidden blocks, since that's where
  // injections live. Fall back to full body text if no hidden block found.
  const hiddenBlocks: string[] = [];
  const blockRx = /<(div|span|p|noscript)[^>]*(?:display\s*:\s*none|aria-hidden|font-size\s*:\s*0|opacity\s*:\s*0|white-on-white|color\s*:\s*white)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of body.matchAll(blockRx)) {
    hiddenBlocks.push(m[2]!);
  }
  // Comment-wrapped payloads (e.g. <!-- inject: ... -->)
  for (const m of body.matchAll(/<!--([\s\S]*?)-->/g)) {
    const c = m[1]!.trim();
    if (c.length > 20) hiddenBlocks.push(c);
  }
  // alt / aria-label / data-* attribute payloads
  for (const m of body.matchAll(/(?:alt|aria-label|data-[a-z-]+)\s*=\s*"([^"]{30,})"/gi)) {
    hiddenBlocks.push(m[1]!);
  }

  const candidate = hiddenBlocks.length > 0 ? hiddenBlocks.join(' ') : body;

  return cleanText(candidate);
}

function cleanText(s: string): string {
  return s
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryFromManifest(m: ManifestEntry): CorpusEntry | null {
  if (m.expectedVerdict === 'CLEAN') return null;
  const html = readFileSync(resolve(TEST_PAGES, m.file), 'utf-8');
  const text = extractPayload(html);
  if (text.length === 0) return null;
  const id = `honeypot/${m.file.replace(/\.html$/, '')}`;
  return {
    id,
    source: 'test-pages/injected/ (hand-curated honeypots, manifest.json)',
    text,
    lang: 'en',
    techniques: m.techniques,
    embedding: null,
  };
}

function entryFromDM4(file: string, lang: 'en' | 'es' | 'zh-CN'): CorpusEntry | null {
  const html = readFileSync(resolve(TEST_PAGES, 'injected-corpus', lang, file), 'utf-8');
  const text = extractPayload(html);
  if (text.length === 0) return null;
  const id = `dm4/${lang}/${basename(file, '.html')}`;
  return {
    id,
    source: `DM-4 1250-fixture corpus (test-pages/injected-corpus/${lang}/, PR #111 / issue #110)`,
    text,
    lang,
    techniques: ['dm4-corpus', `lang-${lang}`],
    embedding: null,
  };
}

function sample<T>(items: readonly T[], n: number): T[] {
  // Deterministic stride sampling — keeps the corpus stable across builds
  // without needing a seeded RNG. With items.length=500 and n=15 we land
  // at indices 0, 33, 66, ... which spans the corpus well.
  if (items.length <= n) return [...items];
  const stride = Math.floor(items.length / n);
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(items[i * stride]!);
  }
  return out;
}

function main(): void {
  const manifestPath = resolve(TEST_PAGES, 'manifest.json');
  const manifest: readonly ManifestEntry[] = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const entries: CorpusEntry[] = [];

  // Honeypot entries (hand-curated, all English by construction)
  for (const m of manifest) {
    const entry = entryFromManifest(m);
    if (entry !== null) entries.push(entry);
  }

  // DM-4 sample — 15 per language for balance
  for (const lang of ['en', 'es', 'zh-CN'] as const) {
    const dir = resolve(TEST_PAGES, 'injected-corpus', lang);
    const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
    for (const file of sample(files, 15)) {
      const entry = entryFromDM4(file, lang);
      if (entry !== null) entries.push(entry);
    }
  }

  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    schema: {
      id: 'string — stable identifier, hierarchical (e.g. honeypot/foo, dm4/en/bar)',
      source: 'string — provenance description',
      text: 'string — extracted injection payload (post-HTML strip, whitespace-collapsed)',
      lang: '"en" | "es" | "zh-CN" — primary language',
      techniques: 'string[] — technique tags',
      embedding: 'number[] | null — populated by Stage 2 build script (transformers.js + multilingual-e5-small)',
    },
    notes: [
      'Stage 1 corpus: bootstrapped from in-repo materials only (honeypots + DM-4).',
      'Stage 2 will populate embedding[] via transformers.js + intfloat/multilingual-e5-small.',
      'Stage 3 will extend with public datasets (Lakera Gandalf, OWASP LLM Top 10) after licence + provenance review.',
    ],
    count: entries.length,
    entries,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
  const byLang = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.lang] = (acc[e.lang] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  Per-language: ${JSON.stringify(byLang)}`);
}

main();
