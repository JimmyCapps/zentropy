import { KEEPALIVE_ALARM_NAME, KEEPALIVE_ALARM_PERIOD_SECONDS } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('Keepalive');

let offscreenPort: chrome.runtime.Port | null = null;

export function startKeepalive(): void {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_ALARM_PERIOD_SECONDS / 60,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM_NAME) {
      log.debug('Keepalive alarm fired');
    }
  });

  log.info(`Keepalive alarm set at ${KEEPALIVE_ALARM_PERIOD_SECONDS}s intervals`);
}

export function connectOffscreenPort(): void {
  if (offscreenPort !== null) return;

  offscreenPort = chrome.runtime.connect({ name: 'honeyllm-offscreen-keepalive' });

  offscreenPort.onDisconnect.addListener(() => {
    log.warn('Offscreen port disconnected');
    offscreenPort = null;
  });

  log.info('Offscreen keepalive port connected');
}

export function stopKeepalive(): void {
  chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
  offscreenPort?.disconnect();
  offscreenPort = null;
}
