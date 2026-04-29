import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStreamEndDebouncer } from './debounce.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createStreamEndDebouncer', () => {
  it('fires after debounceMs of silence', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 5000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(599);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(fired).toEqual(['a']);
  });

  it('resets the timer on each bump', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 5000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    vi.advanceTimersByTime(500);
    d.bump('a'); // resets
    vi.advanceTimersByTime(500);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(101);
    expect(fired).toEqual(['a']);
  });

  it('completion-marker fires immediately and skips the timer', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 5000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    vi.advanceTimersByTime(50);
    d.markComplete('a');
    expect(fired).toEqual(['a']);
    // Timer no longer fires after marker (key already cleared).
    vi.advanceTimersByTime(700);
    expect(fired).toEqual(['a']);
  });

  it('forces fire after maxLatencyMs even with continuous bumps', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 2000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(100);
      d.bump('a');
    }
    expect(fired).toEqual(['a']);
  });

  it('dispose() cancels pending fires', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 5000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    d.dispose();
    vi.advanceTimersByTime(700);
    expect(fired).toEqual([]);
  });

  it('isolates timers per key', () => {
    const fired: string[] = [];
    const d = createStreamEndDebouncer({
      debounceMs: 600,
      maxLatencyMs: 5000,
      onFire: (key) => fired.push(key),
    });
    d.bump('a');
    vi.advanceTimersByTime(300);
    d.bump('b');
    vi.advanceTimersByTime(301);
    expect(fired).toEqual(['a']);
    vi.advanceTimersByTime(300);
    expect(fired).toEqual(['a', 'b']);
  });
});
