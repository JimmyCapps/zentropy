/**
 * Example Playwright integration snippet for consuming HoneyLLM results.
 *
 * Usage: import these helpers in your own Playwright test suite to read
 * HoneyLLM verdicts from any page the extension is loaded on.
 */

import type { Page } from '@playwright/test';

export interface HoneyLLMReport {
  status: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  confidence: number;
  timestamp: number;
  url: string;
  probes: {
    summarization: { passed: boolean; flags: string[] };
    instructionDetection: { passed: boolean; found: string[] };
    adversarialCompliance: { passed: boolean; flags: string[] };
  };
  analysis: {
    roleDrift: boolean;
    exfiltrationIntent: boolean;
    instructionFollowing: boolean;
  };
  mitigationsApplied: string[];
}

export async function waitForHoneyLLM(
  page: Page,
  timeoutMs = 120_000,
): Promise<HoneyLLMReport> {
  await page.waitForFunction(
    () => (window as any).__AI_SECURITY_REPORT__ !== undefined,
    { timeout: timeoutMs },
  );

  return page.evaluate(() => (window as any).__AI_SECURITY_REPORT__) as Promise<HoneyLLMReport>;
}

export async function getStatus(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).__AI_SITE_STATUS__);
}

export async function isClean(page: Page, timeoutMs = 120_000): Promise<boolean> {
  const report = await waitForHoneyLLM(page, timeoutMs);
  return report.status === 'CLEAN';
}

export async function isSafe(
  page: Page,
  minConfidence = 0.7,
  timeoutMs = 120_000,
): Promise<boolean> {
  const report = await waitForHoneyLLM(page, timeoutMs);
  return report.status === 'CLEAN' && report.confidence >= minConfidence;
}

export async function getSecurityMeta(page: Page): Promise<string | null> {
  return page.getAttribute('meta[name="ai-security-status"]', 'content');
}
