/**
 * Centralised exfiltration-domain blocklist consumed by:
 * - src/content/main-world-inject.ts (runtime fetch/XHR guard)
 * - src/hunters/ner/extractors/exfil-domain.ts (entity extraction + score contribution)
 *
 * Patterns are case-insensitive substring matchers against URL strings.
 * The MAIN-world injection script inlines this list at build time via
 * Vite's IIFE bundling, so adding a pattern here propagates to both
 * consumers without runtime coordination.
 */
export const BLOCKED_PATTERNS: readonly RegExp[] = Object.freeze([
  /webhook\.site/i,
  /requestbin/i,
  /pipedream/i,
  /hookbin/i,
  /ngrok\.io/i,
  /burpcollaborator/i,
  /interact\.sh/i,
  /oastify\.com/i,
  /beeceptor/i,
]);
