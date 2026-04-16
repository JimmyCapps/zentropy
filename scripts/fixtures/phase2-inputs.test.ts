import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PROBES,
  INPUTS,
  PROBE_NAMES,
  INPUT_NAMES,
  TOTAL_CELLS,
  classifyOutput,
} from './phase2-inputs.js';

interface Phase2Row {
  engine_model: string;
  probe: string;
  input: string;
  output: string;
  complied: boolean;
  leaked_prompt: boolean;
  included_url: boolean;
  skipped_reason: string | null;
}

const PHASE2_JSON = resolve(
  import.meta.dirname!,
  '..',
  '..',
  'docs',
  'testing',
  'inbrowser-results.json',
);

describe('Phase 2 fixtures parity (Track A regression guard)', () => {
  it('exposes 3 probes and 9 inputs totalling 27 cells', () => {
    expect(PROBE_NAMES).toHaveLength(3);
    expect(INPUT_NAMES).toHaveLength(9);
    expect(TOTAL_CELLS).toBe(27);
  });

  it('has every probe name as a non-empty sys/prefix pair', () => {
    for (const name of PROBE_NAMES) {
      const p = PROBES[name];
      expect(p.sys.length).toBeGreaterThan(0);
      expect(typeof p.prefix).toBe('string');
    }
  });

  it('every input has a category and text', () => {
    const validCategories = new Set(['clean', 'injected', 'borderline']);
    for (const name of INPUT_NAMES) {
      const inp = INPUTS[name];
      expect(validCategories.has(inp.category)).toBe(true);
      expect(inp.text.length).toBeGreaterThan(0);
    }
  });

  it('classifyOutput reproduces every committed Phase 2 row (byte-identical)', () => {
    const raw = readFileSync(PHASE2_JSON, 'utf-8');
    const parsed = JSON.parse(raw) as { results: Phase2Row[] };
    const realRows = parsed.results.filter((r) => !r.skipped_reason);
    // Committed Phase 2 baseline: 162 real rows (6 MLC models × 9 inputs × 3 probes).
    // Tighten guard so a partial write that still leaves >100 rows fails loudly.
    expect(realRows.length).toBeGreaterThanOrEqual(162);

    const mismatches: string[] = [];
    for (const row of realRows) {
      const c = classifyOutput(row.output);
      if (
        c.complied !== row.complied ||
        c.leaked_prompt !== row.leaked_prompt ||
        c.included_url !== row.included_url
      ) {
        mismatches.push(
          `${row.engine_model}|${row.probe}|${row.input}: ` +
            `got {c=${c.complied},l=${c.leaked_prompt},u=${c.included_url}} ` +
            `expected {c=${row.complied},l=${row.leaked_prompt},u=${row.included_url}}`,
        );
      }
    }
    expect(mismatches, `Parity drift on ${mismatches.length} rows:\n${mismatches.slice(0, 3).join('\n')}`).toEqual([]);
  });
});
