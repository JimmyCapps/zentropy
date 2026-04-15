import type { SecurityStatus } from '@/types/verdict.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('MetaTag');

const META_NAME = 'ai-security-status';

export function setSecurityMetaTag(status: SecurityStatus): void {
  let meta = document.querySelector(`meta[name="${META_NAME}"]`);

  if (meta === null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', META_NAME);
    document.head.appendChild(meta);
  }

  meta.setAttribute('content', status);
  log.info(`Meta tag set: <meta name="${META_NAME}" content="${status}">`);
}
