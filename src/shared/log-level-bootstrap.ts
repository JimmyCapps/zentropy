import { setLogLevel, type LogLevel } from './logger.js';
import { STORAGE_KEY_LOG_LEVEL } from './constants.js';

const VALID_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>([
  'debug',
  'info',
  'warn',
  'error',
]);
const DEFAULT_LEVEL: LogLevel = 'info';

function asLogLevel(value: unknown): LogLevel | null {
  return typeof value === 'string' && VALID_LEVELS.has(value as LogLevel)
    ? (value as LogLevel)
    : null;
}

function applyValue(value: unknown): void {
  const level = asLogLevel(value);
  setLogLevel(level ?? DEFAULT_LEVEL);
}

interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

export async function bootstrapLogLevel(): Promise<void> {
  if (typeof chrome === 'undefined' || chrome.storage?.local?.get === undefined) {
    return;
  }

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_LOG_LEVEL);
    const stored = result[STORAGE_KEY_LOG_LEVEL];
    if (stored !== undefined) applyValue(stored);
  } catch {
    // Storage unavailable; leave logger at its current level.
  }

  if (chrome.storage.onChanged?.addListener === undefined) return;
  const listener: StorageChangeListener = (changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY_LOG_LEVEL];
    if (change === undefined) return;
    applyValue(change.newValue);
  };
  chrome.storage.onChanged.addListener(listener);
}
