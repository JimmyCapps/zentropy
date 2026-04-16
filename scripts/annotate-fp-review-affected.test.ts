import { describe, it, expect } from 'vitest';
import {
  indexReviewTable,
  isFpSurface,
  stampRows,
  tallyByModel,
  type CurationRow,
  type FpReviewTable,
} from './annotate-fp-review-affected.js';

const QWEN = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const GEMMA = 'gemma-2-2b-it-q4f16_1-MLC';

function row(overrides: Partial<CurationRow> = {}): CurationRow {
  return {
    engine_model: QWEN,
    probe: 'summarization',
    input: 'clean_recipe',
    complied: false,
    leaked_prompt: false,
    included_url: false,
    skipped_reason: null,
    fp_review: null,
    ...overrides,
  };
}

function table(entries: FpReviewTable['entries']): FpReviewTable {
  return {
    schema_version: '1.0',
    reviewed_date: '2026-04-17',
    reviewer: 'manual-claude-stage7c',
    entries,
  };
}

describe('isFpSurface', () => {
  it('returns true when any classifier flag fires and the row is not skipped', () => {
    expect(isFpSurface(row({ complied: true }))).toBe(true);
    expect(isFpSurface(row({ leaked_prompt: true }))).toBe(true);
    expect(isFpSurface(row({ included_url: true }))).toBe(true);
    expect(isFpSurface(row({ complied: true, leaked_prompt: true, included_url: true }))).toBe(true);
  });

  it('returns false when the row has no flags', () => {
    expect(isFpSurface(row())).toBe(false);
  });

  it('returns false for skipped rows regardless of flags', () => {
    expect(isFpSurface(row({ complied: true, skipped_reason: 'availability-unavailable' }))).toBe(false);
  });
});

describe('indexReviewTable', () => {
  it('keys entries by engine_model|probe|input', () => {
    const map = indexReviewTable(
      table([
        {
          engine_model: QWEN,
          probe: 'summarization',
          input: 'inject_basic',
          verdict: 'real',
          rationale: 'r1',
        },
        {
          engine_model: GEMMA,
          probe: 'instruction_detection',
          input: 'inject_dan',
          verdict: 'false_positive',
          rationale: 'r2',
        },
      ]),
    );
    expect(map.size).toBe(2);
    expect(map.get(`${QWEN}|summarization|inject_basic`)?.verdict).toBe('real');
    expect(map.get(`${GEMMA}|instruction_detection|inject_dan`)?.verdict).toBe('false_positive');
  });

  it('throws on malformed verdict literals to prevent silent tally corruption', () => {
    expect(() =>
      indexReviewTable(
        table([
          {
            engine_model: QWEN,
            probe: 'summarization',
            input: 'inject_basic',
            // @ts-expect-error — exercising runtime guard against hand-edited JSON
            verdict: 'real ',
            rationale: 'r',
          },
        ]),
      ),
    ).toThrow(/Invalid verdict/);
  });

  it('throws on duplicate keys to surface author-error early', () => {
    expect(() =>
      indexReviewTable(
        table([
          {
            engine_model: QWEN,
            probe: 'summarization',
            input: 'inject_basic',
            verdict: 'real',
            rationale: 'r1',
          },
          {
            engine_model: QWEN,
            probe: 'summarization',
            input: 'inject_basic',
            verdict: 'ambiguous',
            rationale: 'r2',
          },
        ]),
      ),
    ).toThrow(/Duplicate review entry/);
  });
});

describe('stampRows', () => {
  it('stamps fp_review on matching FP-surface rows', () => {
    const rows = [
      row({ complied: true, probe: 'summarization', input: 'inject_basic' }),
      row({ leaked_prompt: true, probe: 'instruction_detection', input: 'inject_prompt_leak' }),
    ];
    const reviewMap = indexReviewTable(
      table([
        {
          engine_model: QWEN,
          probe: 'summarization',
          input: 'inject_basic',
          verdict: 'real',
          rationale: 'r',
        },
        {
          engine_model: QWEN,
          probe: 'instruction_detection',
          input: 'inject_prompt_leak',
          verdict: 'false_positive',
          rationale: 'r',
        },
      ]),
    );
    const result = stampRows(rows, reviewMap);
    expect(rows[0]!.fp_review).toBe('real');
    expect(rows[1]!.fp_review).toBe('false_positive');
    expect(result.unreviewedFlagged).toHaveLength(0);
    expect(result.unmatchedReview).toHaveLength(0);
  });

  it('leaves non-FP-surface rows at fp_review=null even if a spurious review entry exists', () => {
    const rows = [row({ complied: false, leaked_prompt: false, included_url: false })];
    const reviewMap = indexReviewTable(
      table([
        {
          engine_model: QWEN,
          probe: 'summarization',
          input: 'clean_recipe',
          verdict: 'real',
          rationale: 'spurious',
        },
      ]),
    );
    const result = stampRows(rows, reviewMap);
    expect(rows[0]!.fp_review).toBeNull();
    // The entry targets a row that exists but isn't FP-surface — it's unmatched
    // because the matched-key set is driven by the FP-surface predicate.
    expect(result.unmatchedReview).toEqual([`${QWEN}|summarization|clean_recipe`]);
  });

  it('reports FP-surface rows without a review entry', () => {
    const rows = [row({ complied: true, probe: 'summarization', input: 'inject_basic' })];
    const result = stampRows(rows, indexReviewTable(table([])));
    expect(rows[0]!.fp_review).toBeNull();
    expect(result.unreviewedFlagged).toEqual([`${QWEN}|summarization|inject_basic`]);
  });

  it('resets fp_review to null on non-FP-surface rows even if previously stamped', () => {
    // Models the case where someone flipped flags false in the data without
    // removing the review entry — we should de-stamp rather than silently
    // leave stale verdicts.
    const r = row({ complied: false, fp_review: 'real' });
    stampRows([r], indexReviewTable(table([])));
    expect(r.fp_review).toBeNull();
  });

  it('is idempotent: running twice produces the same row state', () => {
    const rows = [
      row({ complied: true, probe: 'summarization', input: 'inject_basic' }),
      row({ probe: 'summarization', input: 'clean_recipe' }),
    ];
    const reviewMap = indexReviewTable(
      table([
        {
          engine_model: QWEN,
          probe: 'summarization',
          input: 'inject_basic',
          verdict: 'real',
          rationale: 'r',
        },
      ]),
    );
    stampRows(rows, reviewMap);
    const firstPass = rows.map((r) => r.fp_review);
    stampRows(rows, reviewMap);
    const secondPass = rows.map((r) => r.fp_review);
    expect(secondPass).toEqual(firstPass);
    expect(firstPass).toEqual(['real', null]);
  });
});

describe('tallyByModel', () => {
  it('counts verdicts per engine_model and ignores null rows', () => {
    const rows: CurationRow[] = [
      row({ engine_model: QWEN, fp_review: 'real' }),
      row({ engine_model: QWEN, fp_review: 'false_positive' }),
      row({ engine_model: QWEN, fp_review: null }),
      row({ engine_model: GEMMA, fp_review: 'ambiguous' }),
      row({ engine_model: GEMMA, fp_review: 'real' }),
    ];
    const tally = tallyByModel(rows);
    expect(tally.get(QWEN)).toEqual({ real: 1, false_positive: 1, ambiguous: 0 });
    expect(tally.get(GEMMA)).toEqual({ real: 1, false_positive: 0, ambiguous: 1 });
  });
});
