#!/usr/bin/env tsx
/**
 * Phase 4 Stage 4D.4 — build extension icons from public/icons/src/canary.svg.
 *
 * Produces:
 *   - Neutral default:  public/icons/icon-{16,32,48,128}.png
 *   - Per-verdict:      public/icons/icon-<state>-{16,32,48,128}.png
 *     state ∈ {clean, suspicious, compromised, unknown}
 *
 * The SVG uses {{PLACEHOLDER}} tokens (not CSS variables) so that we can
 * produce genuinely distinct rasterised output per variant. librsvg, which
 * sharp uses for SVG rendering, does not resolve CSS custom properties
 * declared in an inline <style>; string substitution is the reliable path.
 *
 * Usage:
 *   npx tsx scripts/build-icons.ts
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
const SVG_PATH = resolve(REPO_ROOT, 'public/icons/src/canary.svg');
const OUTPUT_DIR = resolve(REPO_ROOT, 'public/icons');

const SIZES: readonly number[] = [16, 32, 48, 128];

interface Palette {
  readonly BG: string;
  readonly BORDER: string;
  readonly BODY: string;
  readonly WING: string;
  readonly BEAK: string;
  readonly FOOT: string;
  readonly EYE: string;
}

interface Variant {
  readonly suffix: string;
  readonly palette: Palette;
}

const YELLOW_BODY: Omit<Palette, 'BG' | 'BORDER'> = {
  BODY: '#facc15',
  WING: '#eab308',
  BEAK: '#f97316',
  FOOT: '#f97316',
  EYE: '#111111',
};

const GREYED_BODY: Omit<Palette, 'BG' | 'BORDER'> = {
  BODY: '#9ca3af',
  WING: '#6b7280',
  BEAK: '#6b7280',
  FOOT: '#6b7280',
  EYE: '#111111',
};

const VARIANTS: readonly Variant[] = [
  { suffix: '',             palette: { BG: '#1a1a1a', BORDER: '#2a2a2a', ...YELLOW_BODY } },
  { suffix: '-clean',       palette: { BG: '#0f1f0f', BORDER: '#4ade80', ...YELLOW_BODY } },
  { suffix: '-suspicious',  palette: { BG: '#1f1f0f', BORDER: '#facc15', ...YELLOW_BODY } },
  { suffix: '-compromised', palette: { BG: '#1f0f0f', BORDER: '#f87171', ...YELLOW_BODY, FOOT: '#f87171' } },
  { suffix: '-unknown',     palette: { BG: '#1a1a1a', BORDER: '#9ca3af', ...GREYED_BODY } },
];

function substitute(svg: string, palette: Palette): string {
  let out = svg;
  for (const [key, value] of Object.entries(palette)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const baseSvg = readFileSync(SVG_PATH, 'utf-8');

  let total = 0;
  for (const variant of VARIANTS) {
    const svg = substitute(baseSvg, variant.palette);
    for (const size of SIZES) {
      const outPath = resolve(OUTPUT_DIR, `icon${variant.suffix}-${size}.png`);
      const buffer = await sharp(Buffer.from(svg), { density: 300 })
        .resize(size, size, { fit: 'contain' })
        .png()
        .toBuffer();
      writeFileSync(outPath, buffer);
      total += 1;
    }
  }
  console.log(`Built ${total} PNG variants from ${SVG_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
