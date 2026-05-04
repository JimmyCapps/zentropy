import type { SecurityVerdict } from '@/types/verdict.js';

/**
 * Mitigation lifecycle handler. Issue #220 — the original inline
 * implementation in `content/index.ts` only activated mitigations on
 * COMPROMISED but never deactivated them on a downgrade, so once a
 * tab saw a COMPROMISED verdict the network guard and redirect blocker
 * stayed on for the lifetime of the tab. The popup rescan flow (#114)
 * and the testing-mode toggle (#113) both rely on a downgrade actually
 * lifting the mitigations.
 *
 * Extracted from `content/index.ts` into its own module so the lifecycle
 * can be unit-tested without pulling in `chrome.runtime`. Dependencies
 * are passed in (DI), letting tests substitute spies.
 */

export interface MitigationDeps {
  readonly sanitizeSuspiciousNodes: () => readonly string[];
  readonly activateNetworkGuard: () => void;
  readonly deactivateNetworkGuard: () => void;
  readonly activateRedirectBlocker: () => void;
  readonly deactivateRedirectBlocker: () => void;
}

/**
 * Apply or tear down mitigations to match `verdict.status`. Returns the
 * verdict with `mitigationsApplied` extended if anything was added; the
 * deactivate path doesn't add to `mitigationsApplied` — the field
 * records mitigations that *are* active right now, and a downgrade
 * leaves the field unchanged on the verdict (the verdict is from the
 * SW; the SW already knows what it asked for).
 */
export function applyMitigations(
  verdict: SecurityVerdict,
  deps: MitigationDeps,
): SecurityVerdict {
  const applied: string[] = [];

  if (verdict.status === 'COMPROMISED') {
    const removed = deps.sanitizeSuspiciousNodes();
    if (removed.length > 0) {
      applied.push(`dom_sanitized:${removed.length}`);
    }

    deps.activateNetworkGuard();
    applied.push('network_guard_active');

    deps.activateRedirectBlocker();
    applied.push('redirect_blocker_active');
  } else {
    // Downgrade — tear down anything we previously activated. Both
    // deactivators are idempotent (their underlying state is guarded),
    // so calling them when nothing is active is a no-op.
    deps.deactivateNetworkGuard();
    deps.deactivateRedirectBlocker();

    if (verdict.status === 'SUSPICIOUS') {
      const removed = deps.sanitizeSuspiciousNodes();
      if (removed.length > 0) {
        applied.push(`dom_sanitized:${removed.length}`);
      }
    }
  }

  return applied.length > 0
    ? { ...verdict, mitigationsApplied: [...verdict.mitigationsApplied, ...applied] }
    : verdict;
}
