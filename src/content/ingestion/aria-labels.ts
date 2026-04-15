const ARIA_SELECTORS = [
  '[aria-label]',
  '[aria-description]',
  '[title]',
];

export function extractAriaLabels(): string {
  const selector = ARIA_SELECTORS.join(',');
  const elements = document.querySelectorAll(selector);
  const parts: string[] = [];

  for (const el of elements) {
    for (const attr of ['aria-label', 'aria-description', 'title']) {
      const value = el.getAttribute(attr)?.trim();
      if (value && value.length > 20) {
        parts.push(value);
      }
    }
  }

  return parts.join('\n');
}
