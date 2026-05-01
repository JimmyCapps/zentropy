export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'sw' | 'offscreen' | 'content' | 'popup' | 'log-viewer' | 'unknown';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  readonly seq: number;
  readonly timestampMs: number;
  readonly elapsedMs: number;
  readonly source: LogSource;
  readonly context: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly args: readonly unknown[];
  // Issue #222 — optional page-routing hints. Populated by the
  // content-script sink decorator (which knows window.location); SW and
  // offscreen leave them undefined and entries land in source buckets.
  readonly tabId?: number;
  readonly pageUrl?: string;
}

export type LogSink = (entry: LogEntry) => void;

let minLevel: LogLevel = 'info';
let nextSeq = 1;
const startMs = nowMs();
let sink: LogSink | null = null;
let source: LogSource = 'unknown';

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function elapsedMs(): number {
  return nowMs() - startMs;
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function setLogSink(fn: LogSink | null): void {
  sink = fn;
}

export function setLogSource(s: LogSource): void {
  source = s;
}

export function resetLoggerForTests(): void {
  nextSeq = 1;
  sink = null;
  source = 'unknown';
  minLevel = 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatMessage(context: string, level: LogLevel, message: string, seq: number): string {
  return `[HoneyLLM:${context} #${seq} t=${elapsedMs().toFixed(1)}ms] ${level.toUpperCase()}: ${message}`;
}

function safeSerializeArg(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${value}n`;
  if (t === 'function') return `[Function: ${(value as () => void).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();
  if (value instanceof Error) {
    return { __error: true, name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
    if (Array.isArray(value)) {
      return value.map((v) => safeSerializeArg(v, seen));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      try {
        out[key] = safeSerializeArg((obj as Record<string, unknown>)[key], seen);
      } catch {
        out[key] = '[Unserializable]';
      }
    }
    return out;
  }
  return String(value);
}

function emit(context: string, level: LogLevel, message: string, args: readonly unknown[]): void {
  if (!shouldLog(level)) return;
  const seq = nextSeq++;
  const formatted = formatMessage(context, level, message, seq);

  switch (level) {
    case 'debug':
      console.debug(formatted, ...args);
      break;
    case 'info':
      console.info(formatted, ...args);
      break;
    case 'warn':
      console.warn(formatted, ...args);
      break;
    case 'error':
      console.error(formatted, ...args);
      break;
  }

  if (sink !== null) {
    try {
      const entry: LogEntry = {
        seq,
        timestampMs: Date.now(),
        elapsedMs: elapsedMs(),
        source,
        context,
        level,
        message,
        args: args.map((a) => safeSerializeArg(a)),
      };
      sink(entry);
    } catch {
      // Sinks must not break logging — swallow.
    }
  }
}

export function createLogger(context: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      emit(context, 'debug', message, args);
    },
    info(message: string, ...args: unknown[]) {
      emit(context, 'info', message, args);
    },
    warn(message: string, ...args: unknown[]) {
      emit(context, 'warn', message, args);
    },
    error(message: string, ...args: unknown[]) {
      emit(context, 'error', message, args);
    },
  } as const;
}
