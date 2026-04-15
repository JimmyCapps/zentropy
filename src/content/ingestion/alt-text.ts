export function extractAltText(): string {
  const elements = document.querySelectorAll('img[alt], area[alt], input[type="image"][alt]');
  const parts: string[] = [];

  for (const el of elements) {
    const alt = el.getAttribute('alt')?.trim();
    if (alt && alt.length > 0) {
      parts.push(alt);
    }
  }

  return parts.join('\n');
}
