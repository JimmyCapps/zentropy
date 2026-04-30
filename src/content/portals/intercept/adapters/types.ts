import type { PortalId } from '@/types/messages.js';

export interface InterceptAdapter {
  readonly portalId: PortalId;
  matchesHost(hostname: string): boolean;
  findInput(root: ParentNode): HTMLElement | null;
  findSendButton(root: ParentNode): HTMLElement | null;
  /** Read the current prompt text from the input element. Different across portals. */
  readInputText(input: HTMLElement): string;
}
