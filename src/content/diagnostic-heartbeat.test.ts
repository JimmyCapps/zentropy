import { describe, it, expect, beforeEach } from 'vitest';
import { startHeartbeat, HEARTBEAT_DEFAULT_INTERVAL_MS } from './diagnostic-heartbeat.js';
import { resetLoggerForTests, setLogSink, type LogEntry } from '@/shared/logger.js';

describe('startHeartbeat', () => {
  beforeEach(() => {
    resetLoggerForTests();
  });

  it('emits a structured snapshot via tick() and returns deltas after the first tick', () => {
    let now = 1000;
    const heap = { usedJSHeapSize: 100, totalJSHeapSize: 200 };
    let bodyChildren = 5;
    let nodeCount = 50;

    const handle = startHeartbeat({
      setIntervalFn: () => 1, // never auto-fires in tests
      clearIntervalFn: () => undefined,
      nowFn: () => now,
      readBodyChildren: () => bodyChildren,
      readNodeCount: () => nodeCount,
      readHeap: () => heap,
    });

    const first = handle.tick();
    expect(first).toMatchObject({
      tickIndex: 1,
      elapsedMs: 0,
      bodyChildren: 5,
      nodeCount: 50,
    });
    expect(first.heap.usedJSHeapSize).toBe(100);
    expect(first.heapDeltaBytes).toBeUndefined();
    expect(first.nodeDelta).toBeUndefined();

    now = 5500;
    heap.usedJSHeapSize = 200;
    bodyChildren = 6;
    nodeCount = 75;

    const second = handle.tick();
    expect(second).toMatchObject({
      tickIndex: 2,
      elapsedMs: 4500,
      bodyChildren: 6,
      nodeCount: 75,
    });
    expect(second.heapDeltaBytes).toBe(100);
    expect(second.nodeDelta).toBe(25);

    handle.stop();
  });

  it('schedules the periodic fire via setIntervalFn and stops via clearIntervalFn', () => {
    let scheduled: { ms: number; cb: () => void } | null = null;
    let cleared: unknown = null;

    const handle = startHeartbeat({
      setIntervalFn: (cb, ms) => {
        scheduled = { ms, cb };
        return 'opaque-handle';
      },
      clearIntervalFn: (h) => {
        cleared = h;
      },
      nowFn: () => 0,
      readBodyChildren: () => 0,
      readNodeCount: () => 0,
      readHeap: () => ({}),
    });

    expect(scheduled).not.toBeNull();
    expect(scheduled!.ms).toBe(HEARTBEAT_DEFAULT_INTERVAL_MS);

    handle.stop();
    expect(cleared).toBe('opaque-handle');
  });

  it('honors a custom intervalMs', () => {
    let scheduledMs = 0;
    startHeartbeat({
      intervalMs: 250,
      setIntervalFn: (_cb, ms) => {
        scheduledMs = ms;
        return 1;
      },
      clearIntervalFn: () => undefined,
      nowFn: () => 0,
      readBodyChildren: () => 0,
      readNodeCount: () => 0,
      readHeap: () => ({}),
    });
    expect(scheduledMs).toBe(250);
  });

  it('emits a log entry per tick via the logger sink', () => {
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));

    const handle = startHeartbeat({
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
      nowFn: () => 0,
      readBodyChildren: () => 1,
      readNodeCount: () => 10,
      readHeap: () => ({ usedJSHeapSize: 1024 }),
    });

    handle.tick();
    handle.tick();

    setLogSink(null);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.context).toBe('Heartbeat');
    expect(entries[0]!.level).toBe('info');
    expect(entries[0]!.message).toBe('heartbeat');
    // args[0] carries the snapshot object, serialized through safeSerializeArg
    const snap = entries[0]!.args[0] as Record<string, unknown>;
    expect(snap.tickIndex).toBe(1);
    expect(snap.bodyChildren).toBe(1);
    expect(snap.nodeCount).toBe(10);

    handle.stop();
  });
});
