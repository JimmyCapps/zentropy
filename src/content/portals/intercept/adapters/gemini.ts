import type { InterceptAdapter } from './types.js';
import { querySelectorLadder, readInputText } from './selectors.js';

const INPUT_SELECTORS = [
  'rich-textarea div[contenteditable="true"]',
  'rich-textarea .ql-editor',
  'div[contenteditable="true"][aria-label*="prompt" i]',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label*="Send" i]',
  'button.send-button',
  'button[mattooltip*="Send" i]',
];

export const geminiInterceptAdapter: InterceptAdapter = {
  portalId: 'gemini',
  matchesHost(hostname: string): boolean {
    return hostname === 'gemini.google.com';
  },
  findInput(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, INPUT_SELECTORS);
  },
  findSendButton(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, SEND_BUTTON_SELECTORS);
  },
  readInputText,
};
