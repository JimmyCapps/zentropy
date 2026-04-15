export function extractCSSContent(): string {
  const parts: string[] = [];

  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        const style = getComputedStyle(el, pseudo);
        const content = style.getPropertyValue('content');

        if (
          content &&
          content !== 'none' &&
          content !== 'normal' &&
          content !== '""' &&
          content !== "''"
        ) {
          const cleaned = content.replace(/^["']|["']$/g, '');
          if (cleaned.length > 20) {
            parts.push(cleaned);
          }
        }
      } catch {
        // getComputedStyle can throw on some elements
      }
    }
  }

  return parts.join('\n');
}
