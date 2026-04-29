// Issue #126 (N7a) — stream-end debouncer for portal MutationObserver
// callbacks. Hybrid model:
//   - bump(key) starts/resets a debounce timer; firing happens after
//     `debounceMs` of silence.
//   - markComplete(key) bypasses the timer and fires immediately, used
//     by adapters that detect a completion-marker DOM signal (e.g.
//     ChatGPT's "regenerate" button, Claude's data-is-streaming="false").
//   - A max-latency clamp force-fires after `maxLatencyMs` even if the
//     bumps keep coming, preventing pathological never-fires on slow
//     generation that lacks a completion marker (Gemini case).
//
// Each key (typically `${portalId}:${messageId}`) maintains an isolated
// timer pair so concurrent assistant turns don't interfere.

interface PendingTimer {
  readonly debounceTimer: ReturnType<typeof setTimeout>;
  readonly maxLatencyTimer: ReturnType<typeof setTimeout>;
}

interface StreamEndDebouncerOpts {
  readonly debounceMs: number;
  readonly maxLatencyMs: number;
  readonly onFire: (key: string) => void;
}

export interface StreamEndDebouncer {
  bump(key: string): void;
  markComplete(key: string): void;
  dispose(): void;
}

export function createStreamEndDebouncer(opts: StreamEndDebouncerOpts): StreamEndDebouncer {
  const pending = new Map<string, PendingTimer>();

  function fire(key: string): void {
    const t = pending.get(key);
    if (t === undefined) return;
    clearTimeout(t.debounceTimer);
    clearTimeout(t.maxLatencyTimer);
    pending.delete(key);
    opts.onFire(key);
  }

  function bump(key: string): void {
    const existing = pending.get(key);
    const debounceTimer = setTimeout(() => fire(key), opts.debounceMs);
    if (existing !== undefined) {
      // Re-arm only the debounce timer; the max-latency timer keeps its
      // original deadline so total wait is bounded.
      clearTimeout(existing.debounceTimer);
      pending.set(key, { ...existing, debounceTimer });
      return;
    }
    const maxLatencyTimer = setTimeout(() => fire(key), opts.maxLatencyMs);
    pending.set(key, { debounceTimer, maxLatencyTimer });
  }

  function markComplete(key: string): void {
    fire(key);
  }

  function dispose(): void {
    for (const [, t] of pending) {
      clearTimeout(t.debounceTimer);
      clearTimeout(t.maxLatencyTimer);
    }
    pending.clear();
  }

  return { bump, markComplete, dispose };
}
