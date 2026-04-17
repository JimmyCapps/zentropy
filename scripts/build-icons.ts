#!/usr/bin/env tsx
/**
 * Phase 4 Stage 4D.4 — build extension icons from public/icons/src/canary.svg.
 *
 * Produces:
 *   - Neutral default:  public/icons/icon-{16,32,48,128}.png
 *   - Per-verdict:      public/icons/icon-<state>-{16,32,48,128}.png
 *     state ∈ {clean, suspicious, compromised, unknown}
 *
 * Each variant injects CSS custom-property overrides into the SVG before
 * rasterising, so the base canary shape stays stable and only the border
 * colour changes per verdict state. chrome.action.setIcon() in the SW
 * picks the appropriate variant per tab on every persistVerdict() call.
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

interface Variant {
  readonly suffix: string;
  readonly style: string;
}

const VARIANTS: readonly Variant[] = [
  {
    suffix: '',
    style: `
      :root {
        --bg-color: #1a1a1a;
        --border-color: #2a2a2a;
        --body-color: #facc15;
        --wing-color: #eab308;
        --beak-color: #f97316;
        --foot-color: #f97316;
        --eye-color: #111;
      }
    `,
  },
  {
    suffix: '-clean',
    style: `
      :root {
        --bg-color: #0f1f0f;
        --border-color: #4ade80;
        --body-color: #facc15;
        --wing-color: #eab308;
        --beak-color: #f97316;
        --foot-color: #f97316;
        --eye-color: #111;
      }
    `,
  },
  {
    suffix: '-suspicious',
    style: `
      :root {
        --bg-color: #1f1f0f;
        --border-color: #facc15;
        --body-color: #facc15;
        --wing-color: #eab308;
        --beak-color: #f97316;
        --foot-color: #f97316;
        --eye-color: #111;
      }
    `,
  },
  {
    suffix: '-compromised',
    style: `
      :root {
        --bg-color: #1f0f0f;
        --border-color: #f87171;
        --body-color: #facc15;
        --wing-color: #eab308;
        --beak-color: #f97316;
        --foot-color: #f87171;
        --eye-color: #111;
      }
    `,
  },
  {
    suffix: '-unknown',
    style: `
      :root {
        --bg-color: #1a1a1a;
        --border-color: #9ca3af;
        --body-color: #9ca3af;
        --wing-color: #6b7280;
        --beak-color: #6b7280;
        --foot-color: #6b7280;
        --eye-color: #111;
      }
    `,
  },
];

function injectStyle(svg: string, style: string): string {
  const insertion = `<style>${style}</style>`;
  return svg.replace(/<svg([^>]*)>/, `<svg$1>${insertion}`);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const baseSvg = readFileSync(SVG_PATH, 'utf-8');

  let total = 0;
  for (const variant of VARIANTS) {
    const svg = injectStyle(baseSvg, variant.style);
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
