// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  embedStamp,
  installStampObservers,
  installNavigationTeardown,
} from './page-stamp-embed.js';
import type { PageStamp } from '@/types/page-stamp.js';
import { STAMP_VERSION } from '@/shared/constants.js';

const FIXTURE_STAMP: PageStamp = {
  v: STAMP_VERSION,
  url: 'https://example.com/page',
  status: 'CLEAN',
  timestamp: 1_700_000_000_000,
  nonce: 'AbCdEfGhIjKlMnOpQrStUv',
  hmac: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function countStampNodes(): number {
  return document.querySelectorAll('[data-honeyllm-stamp]').length;
}

function resetDom(): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
}

describe('embedStamp', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('inserts three [data-honeyllm-stamp] elements (badge in body, meta in head, invisible in body)', () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    expect(nodes.badge.parentNode).toBe(document.body);
    expect(nodes.meta.parentNode).toBe(document.head);
    expect(nodes.invisible.parentNode).toBe(document.body);
    expect(countStampNodes()).toBe(3);
  });

  it('renders the visible badge with the shield prefix and first 8 chars of stamp.hmac', () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    expect(nodes.badge.textContent).toContain('🛡️');
    expect(nodes.badge.textContent).toContain('HoneyLLM scanned');
    expect(nodes.badge.textContent).toContain(FIXTURE_STAMP.hmac.slice(0, 8));
    expect(nodes.badge.style.position).toBe('fixed');
  });

  it('round-trips the full stamp via base64url(JSON.stringify) in the meta tag content', () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const content = nodes.meta.getAttribute('content');
    expect(content).not.toBeNull();
    const standard = content!.replaceAll('-', '+').replaceAll('_', '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    expect(decoded).toEqual(FIXTURE_STAMP);
  });

  it('renders the invisible div as aria-hidden display:none with non-empty content', () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    expect(nodes.invisible.getAttribute('aria-hidden')).toBe('true');
    expect(nodes.invisible.style.display).toBe('none');
    expect(nodes.invisible.textContent).not.toBe('');
  });

  it('is idempotent: a second call leaves exactly 3 stamp nodes (no duplicates)', () => {
    embedStamp(FIXTURE_STAMP);
    embedStamp(FIXTURE_STAMP);
    expect(countStampNodes()).toBe(3);
  });
});

describe('installStampObservers', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('re-adds the stamp when the badge is removed by another script', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    try {
      nodes.badge.remove();
      expect(countStampNodes()).toBe(2);
      await flushMicrotasks();
      expect(countStampNodes()).toBe(3);
    } finally {
      obs.disconnect();
    }
  });

  it('does not loop on its own re-adds (count stays at 3 after one removal+re-embed cycle)', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    try {
      nodes.invisible.remove();
      await flushMicrotasks();
      await flushMicrotasks();
      expect(countStampNodes()).toBe(3);
    } finally {
      obs.disconnect();
    }
  });

  it('re-adds when the meta tag is removed (head observer is wired)', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    try {
      nodes.meta.remove();
      expect(document.head.querySelector('meta[name="honeyllm-stamp"]')).toBeNull();
      await flushMicrotasks();
      expect(document.head.querySelector('meta[name="honeyllm-stamp"]')).not.toBeNull();
    } finally {
      obs.disconnect();
    }
  });
});

describe('installNavigationTeardown', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('removes all stamp nodes and disconnects observers on popstate', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    installNavigationTeardown(obs, nodes);
    expect(countStampNodes()).toBe(3);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flushMicrotasks();
    expect(countStampNodes()).toBe(0);
    // After teardown, observers are gone — clearing children must NOT trigger re-add
    resetDom();
    await flushMicrotasks();
    expect(countStampNodes()).toBe(0);
  });

  it('also tears down on hashchange', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    installNavigationTeardown(obs, nodes);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushMicrotasks();
    expect(countStampNodes()).toBe(0);
  });

  // Issue #231 — manual teardown handle so a fresh VERDICT can dispose
  // the prior stamp lifecycle before installing a new one.
  it('returns a handle whose teardown() disconnects observers and removes stamp nodes', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    const handle = installNavigationTeardown(obs, nodes);
    expect(countStampNodes()).toBe(3);
    handle.teardown();
    expect(countStampNodes()).toBe(0);
    // Observers should be disconnected — adding/removing nodes must not re-embed
    resetDom();
    await flushMicrotasks();
    expect(countStampNodes()).toBe(0);
  });

  it('handle.teardown() is idempotent (manual + popstate fires safely)', async () => {
    const nodes = embedStamp(FIXTURE_STAMP);
    const obs = installStampObservers(nodes, FIXTURE_STAMP);
    const handle = installNavigationTeardown(obs, nodes);
    handle.teardown();
    expect(() => handle.teardown()).not.toThrow();
    // popstate after manual teardown must not throw or re-create state
    expect(() => window.dispatchEvent(new PopStateEvent('popstate'))).not.toThrow();
    expect(countStampNodes()).toBe(0);
  });
});
