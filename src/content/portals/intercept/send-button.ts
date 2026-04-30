const HONEYLLM_FLAG = 'data-honeyllm-disabled';

export function disableSendButton(el: HTMLElement, reason: string): void {
  if ('disabled' in el && typeof (el as HTMLButtonElement).disabled === 'boolean') {
    (el as HTMLButtonElement).disabled = true;
  }
  el.setAttribute('aria-disabled', 'true');
  el.setAttribute('title', reason);
  el.setAttribute(HONEYLLM_FLAG, 'true');
}

export function restoreSendButton(el: HTMLElement): void {
  if (el.getAttribute(HONEYLLM_FLAG) !== 'true') return;
  if ('disabled' in el && typeof (el as HTMLButtonElement).disabled === 'boolean') {
    (el as HTMLButtonElement).disabled = false;
  }
  el.removeAttribute('aria-disabled');
  el.removeAttribute('title');
  el.removeAttribute(HONEYLLM_FLAG);
}

export function isHoneyLLMDisabled(el: HTMLElement): boolean {
  return el.getAttribute(HONEYLLM_FLAG) === 'true';
}
