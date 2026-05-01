export type SecurityStatus = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';

export interface SecurityVerdict {
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly url: string;
  readonly timestamp: number;
  readonly analysisError: string | null;
}

export interface AnalyzerResult {
  readonly content: string;
  readonly verdict: SecurityVerdict;
  readonly mitigationsApplied: readonly string[];
}

export interface Analyzer {
  readonly analyzeHtml: (
    params: Readonly<{ html: string; url?: string }>,
  ) => Promise<AnalyzerResult>;
}

export type WrapPolicy =
  | 'flag-only'
  | 'block-on-compromised'
  | 'block-on-suspicious';

export interface ScreenedSafe {
  readonly blocked: false;
  readonly content: string;
  readonly verdict: SecurityVerdict;
  readonly mitigationsApplied: readonly string[];
}

export interface ScreenedBlocked {
  readonly blocked: true;
  readonly verdict: SecurityVerdict;
  readonly mitigationsApplied: readonly string[];
  readonly reason: string;
}

export type ScreenedResult = ScreenedSafe | ScreenedBlocked;

export class HoneyLLMBlockedError extends Error {
  readonly verdict: SecurityVerdict;
  readonly mitigationsApplied: readonly string[];

  constructor(verdict: SecurityVerdict, mitigationsApplied: readonly string[], reason: string) {
    super(reason);
    this.name = 'HoneyLLMBlockedError';
    this.verdict = verdict;
    this.mitigationsApplied = mitigationsApplied;
  }
}
