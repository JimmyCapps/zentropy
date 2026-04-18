/**
 * Per-origin scan policy (issue #20).
 *
 * Resolves the scan decision for a given page origin before any ingestion or
 * probe work happens. The policy layer is pure and chrome-free so it can be
 * unit-tested without the extension loaded.
 *
 * Resolution order (highest precedence first):
 *   1. Explicit user override in `overrides` (`scan` or `skip`).
 *   2. Built-in deny-list match (returns `skip`).
 *   3. Default (returns `scan`).
 *
 * "Origin" here is the hostname portion (e.g. `mail.google.com`), not the
 * full URL origin with scheme. This matches `PageSnapshot.metadata.origin`
 * shape in practice — callers that receive full URLs should strip to host
 * before passing in.
 */

export type ScanAction = 'scan' | 'skip';

/**
 * Decision returned by the resolver. `reason` distinguishes why a decision
 * was reached, so the popup can show the user whether their override is
 * active vs. a built-in rule is matching.
 */
export interface ScanDecision {
  readonly action: ScanAction;
  readonly reason:
    | 'user_override_scan'
    | 'user_override_skip'
    | 'deny_list_match'
    | 'default_scan';
  /**
   * When `reason` is `deny_list_match`, names the matching rule so the popup
   * can surface "skipped because this looks like a banking domain". Null for
   * other reasons.
   */
  readonly matchedRule: string | null;
}

type DenyRule =
  | { readonly kind: 'exact'; readonly host: string; readonly label: string }
  | { readonly kind: 'suffix'; readonly suffix: string; readonly label: string }
  | { readonly kind: 'subdomain'; readonly parent: string; readonly label: string };

/**
 * Conservative default deny-list. Kept deliberately small — false-positive
 * skips (scanning was actually desired) are high-friction to recover from
 * since the user has to notice scanning isn't happening and toggle it on.
 *
 * Selection criteria:
 *   - Overwhelmingly sensitive content.
 *   - Low chance of a legitimate "I want HoneyLLM to scan this" scenario.
 *   - Recognisable hostname pattern (don't rely on TLS cert metadata or
 *     hand-curated lists of every bank in every region).
 *
 * Explicitly NOT included:
 *   - Banking by TLD (`*.bank`): exists but rarely used; falls through to
 *     explicit origins below. Users in regions with other conventions can
 *     add their banks via the override UI.
 *   - `*.gov` / `*.health`: too broad — includes public-information sites
 *     (`nhs.uk/conditions/*`, `usa.gov/*`) that are reasonable to scan.
 *     Users who need them can add explicit skips.
 *
 * Rationale for each entry is captured in the `label`.
 */
export const DEFAULT_DENY_LIST: readonly DenyRule[] = [
  // Email — private correspondence.
  { kind: 'exact', host: 'mail.google.com', label: 'Gmail' },
  { kind: 'exact', host: 'outlook.live.com', label: 'Outlook (personal)' },
  { kind: 'exact', host: 'outlook.office365.com', label: 'Outlook (work)' },
  { kind: 'exact', host: 'outlook.office.com', label: 'Outlook (work alt)' },
  { kind: 'suffix', suffix: '.proton.me', label: 'Proton Mail' },
  { kind: 'exact', host: 'mail.proton.me', label: 'Proton Mail' },
  { kind: 'exact', host: 'app.fastmail.com', label: 'Fastmail' },

  // Password managers.
  { kind: 'exact', host: 'vault.bitwarden.com', label: 'Bitwarden vault' },
  { kind: 'subdomain', parent: '1password.com', label: '1Password' },
  { kind: 'subdomain', parent: 'lastpass.com', label: 'LastPass' },
  { kind: 'exact', host: 'app.dashlane.com', label: 'Dashlane' },

  // Major banking origins (sample — users extend via override UI).
  { kind: 'subdomain', parent: 'chase.com', label: 'Chase' },
  { kind: 'subdomain', parent: 'bankofamerica.com', label: 'Bank of America' },
  { kind: 'subdomain', parent: 'wellsfargo.com', label: 'Wells Fargo' },
  { kind: 'subdomain', parent: 'barclays.co.uk', label: 'Barclays' },
  { kind: 'subdomain', parent: 'hsbc.com', label: 'HSBC' },
  { kind: 'subdomain', parent: 'commbank.com.au', label: 'Commonwealth Bank' },
  { kind: 'subdomain', parent: 'anz.com.au', label: 'ANZ' },
  { kind: 'subdomain', parent: 'westpac.com.au', label: 'Westpac' },
  { kind: 'subdomain', parent: 'nab.com.au', label: 'NAB' },

  // Health portals with obvious patterns.
  { kind: 'subdomain', parent: 'myhealthrecord.gov.au', label: 'My Health Record (AU)' },
  { kind: 'subdomain', parent: 'mymedicare.gov', label: 'Medicare (US)' },
  { kind: 'subdomain', parent: 'nhs.uk', label: 'NHS login area' },

  // Government auth portals (login-only; public-info *.gov sites excluded
  // on purpose — too broad).
  { kind: 'subdomain', parent: 'my.gov.au', label: 'myGov (AU)' },
  { kind: 'subdomain', parent: 'login.gov', label: 'login.gov (US)' },
];

/**
 * User-defined overrides, keyed by exact hostname. Values override the
 * deny-list; `scan` forces scanning even if a rule matches, `skip` forces
 * skipping even if nothing matches.
 */
export type OverrideMap = Readonly<Record<string, ScanAction>>;

/**
 * Case-insensitive, handles leading dot on suffix rules, handles exact
 * subdomain parent match too (so `parent: 'chase.com'` matches both
 * `chase.com` and `banking.chase.com`).
 */
function hostMatchesRule(host: string, rule: DenyRule): boolean {
  const normalised = host.toLowerCase();
  switch (rule.kind) {
    case 'exact':
      return normalised === rule.host.toLowerCase();
    case 'suffix':
      return normalised.endsWith(rule.suffix.toLowerCase());
    case 'subdomain': {
      const parent = rule.parent.toLowerCase();
      return normalised === parent || normalised.endsWith(`.${parent}`);
    }
  }
}

function findMatchingRule(host: string, rules: readonly DenyRule[]): DenyRule | null {
  for (const rule of rules) {
    if (hostMatchesRule(host, rule)) return rule;
  }
  return null;
}

/**
 * Resolve whether a given origin should be scanned.
 *
 * `origin` accepts either a bare hostname (`example.com`) or a full URL;
 * URLs have scheme + path + query stripped. Unparseable or empty values
 * resolve to `scan` / `default_scan` — failing open is the safer default
 * because a missing origin usually means a local-file or internal URL
 * where scan/skip is academic.
 */
export function resolveOriginPolicy(
  origin: string,
  overrides: OverrideMap = {},
  denyList: readonly DenyRule[] = DEFAULT_DENY_LIST,
): ScanDecision {
  const host = extractHost(origin);
  if (host === null) {
    return { action: 'scan', reason: 'default_scan', matchedRule: null };
  }

  const override = overrides[host.toLowerCase()];
  if (override === 'scan') {
    return { action: 'scan', reason: 'user_override_scan', matchedRule: null };
  }
  if (override === 'skip') {
    return { action: 'skip', reason: 'user_override_skip', matchedRule: null };
  }

  const matched = findMatchingRule(host, denyList);
  if (matched !== null) {
    return {
      action: 'skip',
      reason: 'deny_list_match',
      matchedRule: matched.label,
    };
  }

  return { action: 'scan', reason: 'default_scan', matchedRule: null };
}

/**
 * Extract the hostname from either a bare host or a full URL. Returns null
 * for genuinely empty input so the caller can short-circuit — we never
 * return a malformed host string that could hash-collide with a legitimate
 * one in the override map.
 */
export function extractHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.includes('://')) {
    // Already a bare host; strip port if present.
    return trimmed.split(':')[0]!.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Convenience for the popup: gives the human-readable label of the current
 * policy state. Consumed by the "This site" card.
 */
export function describeDecision(decision: ScanDecision): string {
  switch (decision.reason) {
    case 'user_override_scan':
      return 'Scanning (you enabled it for this site)';
    case 'user_override_skip':
      return 'Not scanning (you disabled it for this site)';
    case 'deny_list_match':
      return decision.matchedRule !== null
        ? `Not scanning (default: ${decision.matchedRule})`
        : 'Not scanning (default)';
    case 'default_scan':
      return 'Scanning';
  }
}
