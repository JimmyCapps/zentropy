import type { LogEntry } from './logger.js';

export const LOG_PORT_NAME = 'honeyllm-logs';
export const LOG_BUS_RING_SIZE = 1000;

export interface LogPort {
  postMessage(message: unknown): void;
  onDisconnect: { addListener(cb: () => void): void };
}

interface InitMessage {
  readonly type: 'INIT';
  readonly entries: readonly LogEntry[];
}

interface AppendMessage {
  readonly type: 'APPEND';
  readonly entry: LogEntry;
}

export type LogPortMessage = InitMessage | AppendMessage;

export class LogBus {
  private readonly ring: LogEntry[] = [];
  private readonly ports = new Set<LogPort>();
  private readonly maxSize: number;

  constructor(maxSize: number = LOG_BUS_RING_SIZE) {
    this.maxSize = maxSize;
  }

  push(entry: LogEntry): void {
    this.ring.push(entry);
    if (this.ring.length > this.maxSize) this.ring.shift();
    const msg: AppendMessage = { type: 'APPEND', entry };
    for (const port of this.ports) {
      try {
        port.postMessage(msg);
      } catch {
        this.ports.delete(port);
      }
    }
  }

  snapshot(): readonly LogEntry[] {
    return [...this.ring];
  }

  size(): number {
    return this.ring.length;
  }

  clear(): void {
    this.ring.length = 0;
  }

  connect(port: LogPort): void {
    this.ports.add(port);
    const msg: InitMessage = { type: 'INIT', entries: this.snapshot() };
    try {
      port.postMessage(msg);
    } catch {
      this.ports.delete(port);
      return;
    }
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
    });
  }

  portCount(): number {
    return this.ports.size;
  }
}
