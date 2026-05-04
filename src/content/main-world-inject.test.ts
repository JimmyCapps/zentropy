import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installNetworkGuard, type MainWorldTarget } from './main-world-inject.js';

interface MockTarget {
  fetch: typeof window.fetch;
  XMLHttpRequest: { prototype: { open: (...args: unknown[]) => unknown } };
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  __AI_SITE_STATUS__?: string;
  __AI_SECURITY_REPORT__?: unknown;
  __HONEYLLM_GUARD_ACTIVE__?: boolean;
}

const NATIVE_FETCH = 'function fetch() { [native code] }';
const NATIVE_OPEN = 'function open() { [native code] }';
const NATIVE_TO_STRING = 'function toString() { [native code] }';

let originalToString: typeof Function.prototype.toString;

function makeTarget(overrides: Partial<MockTarget> = {}): MockTarget {
  const baseFetch = vi.fn(() => Promise.resolve(new Response('ok'))) as unknown as typeof fetch;
  const baseOpen = vi.fn();
  return {
    fetch: baseFetch,
    XMLHttpRequest: { prototype: { open: baseOpen } },
    addEventListener: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  originalToString = Function.prototype.toString;
});

afterEach(() => {
  Function.prototype.toString = originalToString;
});

describe('installNetworkGuard — toString masking (issue #217)', () => {
  it('wrapped fetch.toString() returns native-code string', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    expect(target.fetch.toString()).toBe(NATIVE_FETCH);
  });

  it('Function.prototype.toString.call(wrappedFetch) returns native-code string', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    expect(Function.prototype.toString.call(target.fetch)).toBe(NATIVE_FETCH);
  });

  it('wrapped XHR.open.toString() returns native-code string', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    const wrappedOpen = target.XMLHttpRequest.prototype.open as Function;
    expect(wrappedOpen.toString()).toBe(NATIVE_OPEN);
  });

  it('Function.prototype.toString.call(wrappedXhrOpen) returns native-code string', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    const wrappedOpen = target.XMLHttpRequest.prototype.open as Function;
    expect(Function.prototype.toString.call(wrappedOpen)).toBe(NATIVE_OPEN);
  });

  it('the patched Function.prototype.toString is itself self-masking', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    expect(Function.prototype.toString.call(Function.prototype.toString)).toBe(NATIVE_TO_STRING);
    expect(Function.prototype.toString.toString()).toBe(NATIVE_TO_STRING);
  });

  it('non-wrapped user functions still serialize to source (no global breakage)', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    function userFn(x: number): number {
      return x + 1;
    }
    const serialized = Function.prototype.toString.call(userFn);
    expect(serialized).toContain('return x + 1');
    expect(serialized).not.toBe(NATIVE_FETCH);
  });

  it('an unrelated native function still serializes to native via the patched toString', () => {
    const target = makeTarget();
    installNetworkGuard(target as unknown as MainWorldTarget);

    expect(Function.prototype.toString.call(Math.max)).toContain('[native code]');
  });

  it('preserves fetch pass-through when guard is inactive', async () => {
    const baseFetch = vi.fn(() => Promise.resolve(new Response('passthrough'))) as unknown as typeof fetch;
    const target = makeTarget({ fetch: baseFetch });
    installNetworkGuard(target as unknown as MainWorldTarget);

    const res = await target.fetch('https://example.com/asset.js');
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('passthrough');
  });

  it('preserves XHR.open pass-through when guard is inactive', () => {
    const baseOpen = vi.fn();
    const target = makeTarget({ XMLHttpRequest: { prototype: { open: baseOpen } } });
    installNetworkGuard(target as unknown as MainWorldTarget);

    const fakeXhr = {} as { readyState?: number };
    (target.XMLHttpRequest.prototype.open as Function).call(fakeXhr, 'GET', 'https://example.com/x');
    expect(baseOpen).toHaveBeenCalledWith('GET', 'https://example.com/x');
  });
});
