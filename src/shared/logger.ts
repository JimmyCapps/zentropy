type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';
let nextSeq = 1;
const startMs = nowMs();

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function elapsedMs(): string {
  const ms = nowMs() - startMs;
  return ms.toFixed(1);
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function resetLoggerForTests(): void {
  nextSeq = 1;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatMessage(context: string, level: LogLevel, message: string): string {
  const seq = nextSeq++;
  return `[HoneyLLM:${context} #${seq} t=${elapsedMs()}ms] ${level.toUpperCase()}: ${message}`;
}

export function createLogger(context: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) console.debug(formatMessage(context, 'debug', message), ...args);
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) console.info(formatMessage(context, 'info', message), ...args);
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) console.warn(formatMessage(context, 'warn', message), ...args);
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) console.error(formatMessage(context, 'error', message), ...args);
    },
  } as const;
}
