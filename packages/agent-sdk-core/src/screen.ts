import { blockedReason, shouldBlock } from './policy.js';
import type { Analyzer, ScreenedResult, WrapPolicy } from './types.js';
import { HoneyLLMBlockedError } from './types.js';

export interface ScreenContentParams {
  readonly html: string;
  readonly url?: string;
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
}

const DEFAULT_POLICY: WrapPolicy = 'block-on-compromised';

export async function screenContent(params: ScreenContentParams): Promise<ScreenedResult> {
  const policy = params.policy ?? DEFAULT_POLICY;
  const analyzeArgs = params.url === undefined
    ? { html: params.html }
    : { html: params.html, url: params.url };
  const analyzed = await params.analyzer.analyzeHtml(analyzeArgs);
  if (shouldBlock(analyzed.verdict, policy)) {
    return {
      blocked: true,
      verdict: analyzed.verdict,
      mitigationsApplied: analyzed.mitigationsApplied,
      reason: blockedReason(analyzed.verdict),
    };
  }
  return {
    blocked: false,
    content: analyzed.content,
    verdict: analyzed.verdict,
    mitigationsApplied: analyzed.mitigationsApplied,
  };
}

export interface ScreenSafeOutput {
  readonly content: string;
  readonly verdict: import('./types.js').SecurityVerdict;
  readonly mitigationsApplied: readonly string[];
}

export async function screenContentOrThrow(
  params: ScreenContentParams,
): Promise<ScreenSafeOutput> {
  const result = await screenContent(params);
  if (result.blocked) {
    throw new HoneyLLMBlockedError(
      result.verdict,
      result.mitigationsApplied,
      result.reason,
    );
  }
  return {
    content: result.content,
    verdict: result.verdict,
    mitigationsApplied: result.mitigationsApplied,
  };
}
