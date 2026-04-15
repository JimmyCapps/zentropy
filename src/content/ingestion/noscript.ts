export function extractNoscriptText(): string {
  const elements = document.querySelectorAll('noscript');
  const parts: string[] = [];

  for (const el of elements) {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.join('\n');
}
