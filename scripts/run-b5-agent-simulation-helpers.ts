/**
 * Helpers for `run-b5-agent-simulation.ts` (issue #84).
 *
 * Split out so the script's helpers can be unit-tested without invoking
 * the script's top-level env-var validation + main() entrypoint.
 *
 * Mitigation for the gemini-3.1-pro-preview agent-mode timeout class:
 *
 * - Pro-thinking models spend unbounded wall-clock reasoning over raw HTML.
 *   `extractVisibleText` strips scripts/styles/tags before the prompt is
 *   built, shrinking ~3KB of HTML to a few hundred bytes of prose. That
 *   removes most of what the model is "thinking" about.
 *
 * - Even with shorter inputs, pro-thinking can still be slower than the
 *   stock 120s timeout. `geminiCallConfig` raises the cap to 300s when
 *   the model id matches `/pro/`. Flash models stay at 120s — they don't
 *   need it.
 *
 * Together these match issue #84's "(1) extract visible text + (3) default
 * to flash" recommendation. The default model in the script also flips to
 * flash so the typical run never hits the pro timeout class at all.
 */

export const GEMINI_DEFAULT_TIMEOUT_MS = 120_000;
export const GEMINI_PRO_TIMEOUT_MS = 300_000;

export interface GeminiCallConfig {
  readonly timeoutMs: number;
  readonly payloadHtml: string;
}

const SCRIPT_BLOCK = /<script[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style[^>]*>[\s\S]*?<\/style>/gi;
const ANY_TAG = /<[^>]+>/g;
const WHITESPACE_RUN = /\s+/g;

export function extractVisibleText(html: string): string {
  return html
    .replace(SCRIPT_BLOCK, ' ')
    .replace(STYLE_BLOCK, ' ')
    .replace(ANY_TAG, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

export function isProModel(model: string): boolean {
  return /pro/i.test(model);
}

export function geminiCallConfig(model: string, html: string): GeminiCallConfig {
  if (isProModel(model)) {
    return {
      timeoutMs: GEMINI_PRO_TIMEOUT_MS,
      payloadHtml: extractVisibleText(html),
    };
  }
  return {
    timeoutMs: GEMINI_DEFAULT_TIMEOUT_MS,
    payloadHtml: html,
  };
}
