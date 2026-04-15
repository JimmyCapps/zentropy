import { MAX_HIDDEN_TEXT_CHARS } from '@/shared/constants.js';

const HIDDEN_SELECTORS = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[style*="opacity:0"]',
  '[style*="opacity: 0"]',
  '.sr-only',
  '.visually-hidden',
  '.hidden',
].join(',');

export function extractHiddenText(): string {
  const elements = document.querySelectorAll(HIDDEN_SELECTORS);
  const parts: string[] = [];
  let totalLength = 0;

  for (const el of elements) {
    const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? '';
    if (text.length === 0) continue;

    if (totalLength + text.length > MAX_HIDDEN_TEXT_CHARS) {
      parts.push(text.slice(0, MAX_HIDDEN_TEXT_CHARS - totalLength));
      break;
    }

    parts.push(text);
    totalLength += text.length;
  }

  return parts.join('\n');
}
