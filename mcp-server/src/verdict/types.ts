import type { HunterResult } from '../../../src/hunters/base-hunter.js';

export type McpSecurityStatus = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN';

export interface McpVerdict {
  readonly status: McpSecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly url: string;
  readonly timestamp: number;
  readonly analysisError: string | null;
}

export interface McpReport {
  readonly hunters: readonly HunterResult[];
}

export interface BrowseToolResult {
  readonly content: string;
  readonly verdict: McpVerdict;
  readonly report: McpReport;
  readonly mitigationsApplied: readonly string[];
}
