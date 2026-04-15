type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatMessage(context: string, level: LogLevel, message: string): string {
  return `[HoneyLLM:${context}] ${level.toUpperCase()}: ${message}`;
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
