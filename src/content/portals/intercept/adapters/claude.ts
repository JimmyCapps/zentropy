import type { InterceptAdapter } from './types.js';
import { querySelectorLadder, readInputText } from './selectors.js';

const INPUT_SELECTORS = [
  'div[contenteditable="true"][role="textbox"]',
  '[role="textbox"] div[contenteditable="true"]',
  '.ProseMirror',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label="Send Message"]',
  'button[aria-label*="Send" i]',
  'button[type="button"][aria-label]',
];

export const claudeInterceptAdapter: InterceptAdapter = {
  portalId: 'claude',
  matchesHost(hostname: string): boolean {
    return hostname === 'claude.ai';
  },
  findInput(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, INPUT_SELECTORS);
  },
  findSendButton(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, SEND_BUTTON_SELECTORS);
  },
  readInputText,
};
