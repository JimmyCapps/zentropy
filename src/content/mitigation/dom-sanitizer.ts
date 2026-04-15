import { createLogger } from '@/shared/logger.js';

const log = createLogger('DOMSanitizer');

const SUSPICIOUS_SELECTORS = [
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[style*="opacity:0"]',
  '[style*="opacity: 0"]',
  '[style*="position:absolute"][style*="left:-"]',
  '[style*="font-size:0"]',
  '[style*="font-size: 0"]',
  '[hidden]',
  '[aria-hidden="true"]',
];

const INJECTION_KEYWORDS = [
  'ignore previous',
  'ignore all',
  'disregard',
  'new instructions',
  'system prompt',
  'you are now',
  'act as',
  'override',
  'jailbreak',
  'DAN mode',
  'developer mode',
  'bypass',
  'send to',
  'exfiltrate',
  'webhook',
];

function containsInjection(text: string): boolean {
  const lower = text.toLowerCase();
  return INJECTION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function sanitizeSuspiciousNodes(): readonly string[] {
  const removed: string[] = [];
  const selector = SUSPICIOUS_SELECTORS.join(',');
  const elements = document.querySelectorAll(selector);

  for (const el of elements) {
    const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? '';

    if (text.length > 0 && containsInjection(text)) {
      const tag = el.tagName.toLowerCase();
      const preview = text.slice(0, 80);
      log.warn(`Removing suspicious hidden element: <${tag}> "${preview}..."`);

      el.remove();
      removed.push(`<${tag}>: ${preview}`);
    }
  }

  if (removed.length > 0) {
    log.info(`Removed ${removed.length} suspicious DOM node(s)`);
  }

  return removed;
}
