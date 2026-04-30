// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  disableSendButton,
  restoreSendButton,
  isHoneyLLMDisabled,
} from './send-button.js';

function freshButton(): HTMLButtonElement {
  while (document.body.firstChild !== null) {
    document.body.removeChild(document.body.firstChild);
  }
  const btn = document.createElement('button');
  btn.id = 'b';
  btn.textContent = 'Send';
  document.body.appendChild(btn);
  return btn;
}

function freshDivButton(): HTMLElement {
  while (document.body.firstChild !== null) {
    document.body.removeChild(document.body.firstChild);
  }
  const el = document.createElement('div');
  el.id = 'd';
  el.setAttribute('role', 'button');
  el.textContent = 'Send';
  document.body.appendChild(el);
  return el;
}

describe('send-button gating helpers', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    btn = freshButton();
  });

  it('disables, sets aria-disabled, title, and the data flag', () => {
    disableSendButton(btn, 'HoneyLLM scanning…');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toBe('HoneyLLM scanning…');
    expect(btn.getAttribute('data-honeyllm-disabled')).toBe('true');
    expect(isHoneyLLMDisabled(btn)).toBe(true);
  });

  it('restoreSendButton clears all four side-effects when this code disabled it', () => {
    disableSendButton(btn, 'reason');
    restoreSendButton(btn);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.getAttribute('title')).toBeNull();
    expect(btn.getAttribute('data-honeyllm-disabled')).toBeNull();
    expect(isHoneyLLMDisabled(btn)).toBe(false);
  });

  it('restoreSendButton leaves a button alone if HoneyLLM did not disable it', () => {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('title', 'Page is loading');
    restoreSendButton(btn);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toBe('Page is loading');
  });

  it('updates an existing HoneyLLM-disabled button with a new reason without toggling', () => {
    disableSendButton(btn, 'first reason');
    disableSendButton(btn, 'second reason');
    expect(btn.getAttribute('title')).toBe('second reason');
    expect(btn.disabled).toBe(true);
  });

  it('disableSendButton tolerates a non-button HTMLElement (anchor or div with role)', () => {
    const el = freshDivButton();
    disableSendButton(el, 'why');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('title')).toBe('why');
    expect(el.getAttribute('data-honeyllm-disabled')).toBe('true');
  });
});
