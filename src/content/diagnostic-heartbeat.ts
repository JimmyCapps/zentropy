import { createLogger } from '@/shared/logger.js';

const log = createLogger('Heartbeat');

export const HEARTBEAT_DEFAULT_INTERVAL_MS = 5_000;

interface HeapMetrics {
  readonly usedJSHeapSize?: number;
  readonly totalJSHeapSize?: number;
  readonly jsHeapSizeLimit?: number;
}

export interface HeartbeatSnapshot {
  readonly tickIndex: number;
  readonly elapsedMs: number;
  readonly heap: HeapMetrics;
  readonly bodyChildren: number;
  readonly nodeCount: number;
  readonly heapDeltaBytes?: number;
  readonly nodeDelta?: number;
}

export interface HeartbeatDeps {
  readonly intervalMs?: number;
  readonly setIntervalFn?: (cb: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
  readonly nowFn?: () => number;
  readonly readBodyChildren?: () => number;
  readonly readNodeCount?: () => number;
  readonly readHeap?: () => HeapMetrics;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    readonly usedJSHeapSize?: number;
    readonly totalJSHeapSize?: number;
    readonly jsHeapSizeLimit?: number;
  };
}

function defaultReadHeap(): HeapMetrics {
  if (typeof performance === 'undefined') return {};
  const perf = performance as PerformanceWithMemory;
  if (perf.memory === undefined) return {};
  return {
    usedJSHeapSize: perf.memory.usedJSHeapSize,
    totalJSHeapSize: perf.memory.totalJSHeapSize,
    jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
  };
}

function defaultReadBodyChildren(): number {
  if (typeof document === 'undefined' || document.body === null) return 0;
  return document.body.children.length;
}

function defaultReadNodeCount(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelectorAll('*').length;
}

export interface HeartbeatHandle {
  stop(): void;
  tick(): HeartbeatSnapshot;
}

export function startHeartbeat(deps: HeartbeatDeps = {}): HeartbeatHandle {
  const intervalMs = deps.intervalMs ?? HEARTBEAT_DEFAULT_INTERVAL_MS;
  const setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h as number));
  const nowFn = deps.nowFn ?? (() => Date.now());
  const readBodyChildren = deps.readBodyChildren ?? defaultReadBodyChildren;
  const readNodeCount = deps.readNodeCount ?? defaultReadNodeCount;
  const readHeap = deps.readHeap ?? defaultReadHeap;

  const startedMs = nowFn();
  let tickIndex = 0;
  let prevHeapBytes: number | undefined;
  let prevNodeCount: number | undefined;

  function snapshot(): HeartbeatSnapshot {
    tickIndex += 1;
    const elapsedMs = nowFn() - startedMs;
    const heap = readHeap();
    const bodyChildren = readBodyChildren();
    const nodeCount = readNodeCount();

    const heapDeltaBytes =
      prevHeapBytes !== undefined && heap.usedJSHeapSize !== undefined
        ? heap.usedJSHeapSize - prevHeapBytes
        : undefined;
    const nodeDelta = prevNodeCount !== undefined ? nodeCount - prevNodeCount : undefined;

    prevHeapBytes = heap.usedJSHeapSize;
    prevNodeCount = nodeCount;

    return { tickIndex, elapsedMs, heap, bodyChildren, nodeCount, heapDeltaBytes, nodeDelta };
  }

  function fire(): HeartbeatSnapshot {
    const snap = snapshot();
    log.info('heartbeat', snap);
    return snap;
  }

  const handle = setIntervalFn(fire, intervalMs);

  return {
    stop(): void {
      clearIntervalFn(handle);
    },
    tick(): HeartbeatSnapshot {
      return fire();
    },
  };
}
