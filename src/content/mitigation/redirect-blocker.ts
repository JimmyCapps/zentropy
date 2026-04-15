import { createLogger } from '@/shared/logger.js';

const log = createLogger('RedirectBlocker');

let active = false;

export function activateRedirectBlocker(): void {
  if (active) return;
  active = true;

  window.addEventListener('beforeunload', handleBeforeUnload);

  log.info('Redirect blocker activated');
}

export function deactivateRedirectBlocker(): void {
  if (!active) return;
  active = false;

  window.removeEventListener('beforeunload', handleBeforeUnload);
  log.info('Redirect blocker deactivated');
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!active) return;

  log.warn('Blocking potential redirect from compromised page');
  event.preventDefault();
}
