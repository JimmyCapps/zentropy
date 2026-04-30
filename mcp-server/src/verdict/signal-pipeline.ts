import { runHawk } from '../probes/hawk-runner.js';
import { runSpider } from '../probes/spider-runner.js';
import { runInstructionDetectionCanary } from '../probes/canary-runner.js';
import type { ProbeRunResult } from '../probes/canary-runner.js';
import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import type { HunterResult } from '../../../src/hunters/base-hunter.js';
import type {
  BrowseToolResult,
  McpReport,
  McpSecurityStatus,
  McpVerdict,
} from './types.js';

export interface CombinedScore {
  readonly status: McpSecurityStatus;
  readonly totalScore: number;
  readonly confidence: number;
  readonly analysisError: string | null;
}

export function combineSignals(
  hunters: readonly HunterResult[],
  probes: readonly ProbeRunResult[],
): CombinedScore {
  const hunterScore = hunters.reduce((acc, h) => acc + h.score, 0);
  const probeScore = probes.reduce((acc, p) => acc + p.score, 0);
  const totalScore = hunterScore + probeScore;
  const anyHunterMatched = hunters.some((h) => h.matched);
  const anyProbeFailed = probes.some((p) => p.passed === false && p.errorMessage === null);
  const allHuntersErrored =
    hunters.length === 0 ? true : hunters.every((h) => h.errorMessage !== null);
  const allProbesErrored =
    probes.length === 0 ? true : probes.every((p) => p.errorMessage !== null);
  const analysisError =
    allHuntersErrored && allProbesErrored && (hunters.length > 0 || probes.length > 0)
      ? [
          ...hunters
            .filter((h) => h.errorMessage !== null)
            .map((h) => `${h.hunterName}: ${h.errorMessage}`),
          ...probes
            .filter((p) => p.errorMessage !== null)
            .map((p) => `${p.probeName}: ${p.errorMessage}`),
        ].join('; ')
      : null;
  if ((!anyHunterMatched && !anyProbeFailed) || totalScore === 0) {
    return { status: 'CLEAN', totalScore: 0, confidence: 0, analysisError };
  }
  const confidenceCandidates: number[] = [
    ...hunters.map((h) => h.confidence),
    ...probes.map((p) => p.confidence),
  ];
  const confidence = confidenceCandidates.length > 0 ? Math.max(...confidenceCandidates) : 0;
  const status: McpSecurityStatus = totalScore >= 40 ? 'COMPROMISED' : 'SUSPICIOUS';
  return { status, totalScore, confidence, analysisError };
}

export function unknownVerdict(url: string, timestamp: number, error: string): McpVerdict {
  return {
    status: 'UNKNOWN',
    confidence: 0,
    totalScore: 0,
    url,
    timestamp,
    analysisError: error,
  };
}

export function emptyReport(): McpReport {
  return { hunters: [], probes: [] };
}

export function unknownResult(
  url: string,
  timestamp: number,
  error: string,
): BrowseToolResult {
  return {
    content: '',
    verdict: unknownVerdict(url, timestamp, error),
    report: emptyReport(),
    mitigationsApplied: [],
  };
}

export function validateUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: `invalid url: ${raw}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `unsupported scheme: ${parsed.protocol}` };
  }
  return { ok: true, url: parsed.toString() };
}

export async function runProbesIfConfigured(
  text: string,
  endpoint: LlmEndpoint | undefined,
): Promise<readonly ProbeRunResult[]> {
  if (endpoint === undefined) return [];
  const settled = await Promise.allSettled([runInstructionDetectionCanary(text, endpoint)]);
  return settled.map((s) => {
    if (s.status === 'fulfilled') return s.value;
    const reason = s.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    return {
      probeName: 'instruction_detection',
      passed: false,
      flags: [],
      score: 0,
      confidence: 0,
      errorMessage: message,
    };
  });
}

export async function analyzeText(
  text: string,
  finalUrl: string,
  timestamp: number,
  endpoint: LlmEndpoint | undefined,
): Promise<BrowseToolResult> {
  const [hunters, probes] = await Promise.all([
    Promise.all([runHawk(text), runSpider(text)]),
    runProbesIfConfigured(text, endpoint),
  ]);
  const combined = combineSignals(hunters, probes);
  const verdict: McpVerdict = {
    status: combined.status,
    confidence: combined.confidence,
    totalScore: combined.totalScore,
    url: finalUrl,
    timestamp,
    analysisError: combined.analysisError,
  };
  return {
    content: text,
    verdict,
    report: { hunters, probes },
    mitigationsApplied: [],
  };
}
