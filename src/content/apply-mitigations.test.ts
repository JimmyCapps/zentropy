import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SecurityVerdict, SecurityStatus } from '@/types/verdict.js';
import { applyMitigations, type MitigationDeps } from './apply-mitigations.js';

function makeVerdict(status: SecurityStatus, mitigationsApplied: readonly string[] = []): SecurityVerdict {
  return {
    status,
    confidence: 0.9,
    totalScore: status === 'COMPROMISED' ? 80 : status === 'SUSPICIOUS' ? 40 : 0,
    probeResults: [],
    behavioralFlags: {} as SecurityVerdict['behavioralFlags'],
    mitigationsApplied,
    timestamp: 1_000_000,
    url: 'https://x.example/page',
    analysisError: null,
    canaryId: null,
    perChunkAnalysis: [],
    perChunkVisibility: [],
    hunterSummary: null,
    stamp: null,
  } as unknown as SecurityVerdict;
}

let deps: MitigationDeps;
let sanitize: ReturnType<typeof vi.fn<() => readonly string[]>>;
let activateNG: ReturnType<typeof vi.fn<() => void>>;
let deactivateNG: ReturnType<typeof vi.fn<() => void>>;
let activateRB: ReturnType<typeof vi.fn<() => void>>;
let deactivateRB: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  sanitize = vi.fn<() => readonly string[]>(() => []);
  activateNG = vi.fn<() => void>();
  deactivateNG = vi.fn<() => void>();
  activateRB = vi.fn<() => void>();
  deactivateRB = vi.fn<() => void>();
  deps = {
    sanitizeSuspiciousNodes: sanitize,
    activateNetworkGuard: activateNG,
    deactivateNetworkGuard: deactivateNG,
    activateRedirectBlocker: activateRB,
    deactivateRedirectBlocker: deactivateRB,
  };
});

describe('applyMitigations — COMPROMISED activates', () => {
  it('activates network guard and redirect blocker on COMPROMISED', () => {
    const result = applyMitigations(makeVerdict('COMPROMISED'), deps);
    expect(activateNG).toHaveBeenCalledTimes(1);
    expect(activateRB).toHaveBeenCalledTimes(1);
    expect(deactivateNG).not.toHaveBeenCalled();
    expect(deactivateRB).not.toHaveBeenCalled();
    expect(result.mitigationsApplied).toEqual(
      expect.arrayContaining(['network_guard_active', 'redirect_blocker_active']),
    );
  });

  it('records dom_sanitized count when sanitize returns removed nodes', () => {
    sanitize.mockReturnValueOnce(['node-a', 'node-b', 'node-c']);
    const result = applyMitigations(makeVerdict('COMPROMISED'), deps);
    expect(result.mitigationsApplied).toContain('dom_sanitized:3');
  });

  it('omits dom_sanitized label when sanitize removed nothing', () => {
    sanitize.mockReturnValueOnce([]);
    const result = applyMitigations(makeVerdict('COMPROMISED'), deps);
    expect(result.mitigationsApplied.some((m) => m.startsWith('dom_sanitized:'))).toBe(false);
    expect(result.mitigationsApplied).toContain('network_guard_active');
  });
});

// Issue #220 — the lifecycle bug. These pin the deactivation contract:
// once a tab transitions out of COMPROMISED, the network guard and redirect
// blocker MUST be torn down. Without these, the tab can't be navigated
// (beforeunload listener) or fetch external resources (network guard) even
// after a clean rescan or testing-mode toggle.
describe('applyMitigations — downgrade deactivates (#220 lifecycle)', () => {
  it('deactivates both on CLEAN', () => {
    applyMitigations(makeVerdict('CLEAN'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(1);
    expect(deactivateRB).toHaveBeenCalledTimes(1);
    expect(activateNG).not.toHaveBeenCalled();
    expect(activateRB).not.toHaveBeenCalled();
  });

  it('deactivates both on SUSPICIOUS (only DOM-sanitize stays)', () => {
    sanitize.mockReturnValueOnce(['removed-1']);
    const result = applyMitigations(makeVerdict('SUSPICIOUS'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(1);
    expect(deactivateRB).toHaveBeenCalledTimes(1);
    expect(activateNG).not.toHaveBeenCalled();
    expect(activateRB).not.toHaveBeenCalled();
    expect(result.mitigationsApplied).toContain('dom_sanitized:1');
    expect(result.mitigationsApplied).not.toContain('network_guard_active');
  });

  it('deactivates on UNKNOWN status', () => {
    applyMitigations(makeVerdict('UNKNOWN'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(1);
    expect(deactivateRB).toHaveBeenCalledTimes(1);
  });

  it('end-to-end lifecycle: COMPROMISED then CLEAN deactivates exactly once each', () => {
    applyMitigations(makeVerdict('COMPROMISED'), deps);
    expect(activateNG).toHaveBeenCalledTimes(1);
    expect(activateRB).toHaveBeenCalledTimes(1);
    expect(deactivateNG).not.toHaveBeenCalled();

    applyMitigations(makeVerdict('CLEAN'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(1);
    expect(deactivateRB).toHaveBeenCalledTimes(1);
  });

  it('end-to-end lifecycle: COMPROMISED then SUSPICIOUS deactivates network/redirect, runs sanitize', () => {
    applyMitigations(makeVerdict('COMPROMISED'), deps);
    sanitize.mockReturnValueOnce(['node']);

    const result = applyMitigations(makeVerdict('SUSPICIOUS'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(1);
    expect(deactivateRB).toHaveBeenCalledTimes(1);
    expect(result.mitigationsApplied).toContain('dom_sanitized:1');
  });

  it('CLEAN-after-CLEAN is idempotent (deactivators called each time but no-op semantically)', () => {
    applyMitigations(makeVerdict('CLEAN'), deps);
    applyMitigations(makeVerdict('CLEAN'), deps);
    expect(deactivateNG).toHaveBeenCalledTimes(2);
    expect(deactivateRB).toHaveBeenCalledTimes(2);
    expect(activateNG).not.toHaveBeenCalled();
    expect(activateRB).not.toHaveBeenCalled();
  });
});

describe('applyMitigations — verdict immutability', () => {
  it('returns the same verdict reference when nothing was applied', () => {
    const verdict = makeVerdict('CLEAN');
    sanitize.mockReturnValueOnce([]);
    const result = applyMitigations(verdict, deps);
    expect(result).toBe(verdict);
  });

  it('returns a new verdict object when mitigations were added', () => {
    const verdict = makeVerdict('COMPROMISED');
    const result = applyMitigations(verdict, deps);
    expect(result).not.toBe(verdict);
    expect(result.mitigationsApplied.length).toBeGreaterThan(verdict.mitigationsApplied.length);
  });

  it('preserves existing mitigationsApplied entries from the input', () => {
    const verdict = makeVerdict('COMPROMISED', ['prior_entry']);
    const result = applyMitigations(verdict, deps);
    expect(result.mitigationsApplied[0]).toBe('prior_entry');
    expect(result.mitigationsApplied).toContain('network_guard_active');
  });
});
