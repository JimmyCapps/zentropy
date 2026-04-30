import type { InterceptAdapter } from './types.js';
import { querySelectorLadder, readInputText } from './selectors.js';

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"][role="textbox"]',
  '[data-testid="chat-input"]',
];

const SEND_BUTTON_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="Send" i]',
  'form button[type="submit"]',
];

export const chatgptInterceptAdapter: InterceptAdapter = {
  portalId: 'chatgpt',
  matchesHost(hostname: string): boolean {
    return hostname === 'chatgpt.com' || hostname === 'chat.openai.com';
  },
  findInput(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, INPUT_SELECTORS);
  },
  findSendButton(root: ParentNode): HTMLElement | null {
    return querySelectorLadder(root, SEND_BUTTON_SELECTORS);
  },
  readInputText,
};
