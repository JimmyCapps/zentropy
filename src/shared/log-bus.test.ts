import { describe, it, expect, beforeEach } from 'vitest';
import { LogBus, type LogPort, type LogPortMessage } from './log-bus.js';
import type { LogEntry } from './logger.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    seq: 1,
    timestampMs: 1_000,
    elapsedMs: 12.3,
    source: 'sw',
    context: 'Test',
    level: 'info',
    message: 'hello',
    args: [],
    ...overrides,
  };
}

class FakePort implements LogPort {
  readonly received: LogPortMessage[] = [];
  private disconnectCb: (() => void) | null = null;
  readonly onDisconnect = {
    addListener: (cb: () => void) => {
      this.disconnectCb = cb;
    },
  };
  postMessage(message: unknown): void {
    this.received.push(message as LogPortMessage);
  }
  triggerDisconnect(): void {
    this.disconnectCb?.();
  }
}

describe('LogBus', () => {
  let bus: LogBus;

  beforeEach(() => {
    bus = new LogBus(3);
  });

  it('stores pushed entries up to maxSize and evicts oldest on overflow', () => {
    bus.push(makeEntry({ seq: 1 }));
    bus.push(makeEntry({ seq: 2 }));
    bus.push(makeEntry({ seq: 3 }));
    bus.push(makeEntry({ seq: 4 }));
    const snap = bus.snapshot();
    expect(snap.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(bus.size()).toBe(3);
  });

  it('sends INIT with current snapshot when a port connects', () => {
    bus.push(makeEntry({ seq: 1 }));
    bus.push(makeEntry({ seq: 2 }));
    const port = new FakePort();
    bus.connect(port);
    expect(port.received).toHaveLength(1);
    const init = port.received[0]!;
    expect(init.type).toBe('INIT');
    if (init.type === 'INIT') {
      expect(init.entries.map((e) => e.seq)).toEqual([1, 2]);
    }
  });

  it('broadcasts APPEND to all connected ports on push', () => {
    const a = new FakePort();
    const b = new FakePort();
    bus.connect(a);
    bus.connect(b);
    bus.push(makeEntry({ seq: 99, message: 'broadcast' }));
    const aLast = a.received[a.received.length - 1]!;
    const bLast = b.received[b.received.length - 1]!;
    expect(aLast.type).toBe('APPEND');
    expect(bLast.type).toBe('APPEND');
    if (aLast.type === 'APPEND') expect(aLast.entry.seq).toBe(99);
    if (bLast.type === 'APPEND') expect(bLast.entry.seq).toBe(99);
  });

  it('removes ports on disconnect', () => {
    const port = new FakePort();
    bus.connect(port);
    expect(bus.portCount()).toBe(1);
    port.triggerDisconnect();
    expect(bus.portCount()).toBe(0);
  });

  it('drops a port that throws on postMessage during broadcast', () => {
    const good = new FakePort();
    let badCalls = 0;
    const bad: LogPort = {
      onDisconnect: { addListener: () => {} },
      postMessage: () => {
        badCalls += 1;
        if (badCalls > 1) throw new Error('disconnected mid-broadcast');
      },
    };
    bus.connect(good);
    bus.connect(bad);
    expect(bus.portCount()).toBe(2);
    bus.push(makeEntry({ seq: 1 }));
    expect(bus.portCount()).toBe(1);
    expect(good.received.length).toBeGreaterThan(0);
  });

  it('clear() empties the ring without affecting subsequent pushes', () => {
    bus.push(makeEntry({ seq: 1 }));
    bus.clear();
    expect(bus.size()).toBe(0);
    bus.push(makeEntry({ seq: 2 }));
    expect(bus.snapshot().map((e) => e.seq)).toEqual([2]);
  });
});
