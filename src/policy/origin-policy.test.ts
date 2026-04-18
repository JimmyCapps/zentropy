import { describe, it, expect } from 'vitest';
import {
  resolveOriginPolicy,
  extractHost,
  describeDecision,
  DEFAULT_DENY_LIST,
  type OverrideMap,
} from './origin-policy.js';

describe('extractHost', () => {
  it('returns the hostname from a full URL', () => {
    expect(extractHost('https://mail.google.com/inbox')).toBe('mail.google.com');
  });

  it('lowercases the host', () => {
    expect(extractHost('https://Mail.Google.COM/')).toBe('mail.google.com');
  });

  it('strips port from a bare host', () => {
    expect(extractHost('localhost:3000')).toBe('localhost');
  });

  it('accepts a bare host verbatim (except case)', () => {
    expect(extractHost('example.com')).toBe('example.com');
    expect(extractHost('EXAMPLE.COM')).toBe('example.com');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(extractHost('')).toBeNull();
    expect(extractHost('   ')).toBeNull();
  });

  it('returns null for unparseable URL with scheme', () => {
    expect(extractHost('https://')).toBeNull();
  });

  it('handles tolerant URL parser quirks (https:///path → "path")', () => {
    // Node's URL treats https:///path as https://path/. Not our problem to
    // second-guess: the parser says this is a hostname, we return it.
    expect(extractHost('https:///path')).toBe('path');
  });

  it('handles chrome:// URLs', () => {
    expect(extractHost('chrome://extensions/')).toBe('extensions');
  });
});

describe('resolveOriginPolicy — default deny-list', () => {
  it('skips Gmail by exact match', () => {
    const decision = resolveOriginPolicy('mail.google.com');
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('deny_list_match');
    expect(decision.matchedRule).toBe('Gmail');
  });

  it('skips a subdomain of a subdomain-rule host', () => {
    const decision = resolveOriginPolicy('support.1password.com');
    expect(decision.action).toBe('skip');
    expect(decision.matchedRule).toBe('1Password');
  });

  it('skips the exact parent of a subdomain rule (e.g. chase.com itself)', () => {
    const decision = resolveOriginPolicy('chase.com');
    expect(decision.action).toBe('skip');
    expect(decision.matchedRule).toBe('Chase');
  });

  it('skips via suffix rule', () => {
    const decision = resolveOriginPolicy('account.proton.me');
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('deny_list_match');
  });

  it('scans origins not in the deny-list', () => {
    const decision = resolveOriginPolicy('example.com');
    expect(decision.action).toBe('scan');
    expect(decision.reason).toBe('default_scan');
    expect(decision.matchedRule).toBeNull();
  });

  it('is case-insensitive on the input origin', () => {
    const decision = resolveOriginPolicy('Mail.Google.COM');
    expect(decision.action).toBe('skip');
    expect(decision.matchedRule).toBe('Gmail');
  });

  it('accepts a full URL and extracts the host', () => {
    const decision = resolveOriginPolicy('https://mail.google.com/mail/u/0/#inbox');
    expect(decision.action).toBe('skip');
  });

  it('does NOT match a subdomain rule on an unrelated lookalike', () => {
    // 'notchase.com' ends with 'chase.com' textually but is a different
    // registrable domain — subdomain rule should not match.
    const decision = resolveOriginPolicy('notchase.com');
    expect(decision.action).toBe('scan');
  });
});

describe('resolveOriginPolicy — user overrides', () => {
  it('user "skip" beats default scan', () => {
    const overrides: OverrideMap = { 'example.com': 'skip' };
    const decision = resolveOriginPolicy('example.com', overrides);
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('user_override_skip');
  });

  it('user "scan" beats deny-list match', () => {
    const overrides: OverrideMap = { 'mail.google.com': 'scan' };
    const decision = resolveOriginPolicy('mail.google.com', overrides);
    expect(decision.action).toBe('scan');
    expect(decision.reason).toBe('user_override_scan');
    expect(decision.matchedRule).toBeNull();
  });

  it('override is keyed by exact host; does not apply to subdomains', () => {
    const overrides: OverrideMap = { '1password.com': 'scan' };
    // Override applies to 1password.com itself, but support.1password.com
    // still matches the deny-list subdomain rule.
    const decision = resolveOriginPolicy('support.1password.com', overrides);
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('deny_list_match');
  });

  it('override lookup is case-insensitive', () => {
    const overrides: OverrideMap = { 'example.com': 'skip' };
    const decision = resolveOriginPolicy('EXAMPLE.COM', overrides);
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('user_override_skip');
  });
});

describe('resolveOriginPolicy — edge cases', () => {
  it('empty origin resolves to default scan (fail-open)', () => {
    const decision = resolveOriginPolicy('');
    expect(decision.action).toBe('scan');
    expect(decision.reason).toBe('default_scan');
  });

  it('custom empty deny-list means no origin is skipped by default', () => {
    const decision = resolveOriginPolicy('mail.google.com', {}, []);
    expect(decision.action).toBe('scan');
    expect(decision.reason).toBe('default_scan');
  });

  it('localhost scans by default', () => {
    const decision = resolveOriginPolicy('localhost');
    expect(decision.action).toBe('scan');
  });

  it('chrome-extension URLs extract hostname and scan by default', () => {
    const decision = resolveOriginPolicy('chrome-extension://abc123/popup.html');
    expect(decision.action).toBe('scan');
  });
});

describe('describeDecision', () => {
  it('describes user-override scan', () => {
    const decision = resolveOriginPolicy('mail.google.com', {
      'mail.google.com': 'scan',
    });
    expect(describeDecision(decision)).toContain('you enabled');
  });

  it('describes user-override skip', () => {
    const decision = resolveOriginPolicy('example.com', {
      'example.com': 'skip',
    });
    expect(describeDecision(decision)).toContain('you disabled');
  });

  it('describes deny-list match with the matched rule label', () => {
    const decision = resolveOriginPolicy('mail.google.com');
    expect(describeDecision(decision)).toContain('Gmail');
  });

  it('describes default scan', () => {
    const decision = resolveOriginPolicy('example.com');
    expect(describeDecision(decision)).toBe('Scanning');
  });
});

describe('DEFAULT_DENY_LIST integrity', () => {
  it('has at least one entry (sanity check that we didn\'t ship an empty list)', () => {
    expect(DEFAULT_DENY_LIST.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty label', () => {
    for (const rule of DEFAULT_DENY_LIST) {
      expect(rule.label.length).toBeGreaterThan(0);
    }
  });

  it('every exact and suffix rule has a non-empty host/suffix', () => {
    for (const rule of DEFAULT_DENY_LIST) {
      if (rule.kind === 'exact') expect(rule.host.length).toBeGreaterThan(0);
      if (rule.kind === 'suffix') expect(rule.suffix.length).toBeGreaterThan(0);
      if (rule.kind === 'subdomain') expect(rule.parent.length).toBeGreaterThan(0);
    }
  });
});
