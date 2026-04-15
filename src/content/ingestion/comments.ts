export function extractComments(): string {
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_COMMENT,
  );

  const parts: string[] = [];
  let totalLength = 0;
  const MAX_COMMENT_CHARS = 10_000;

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim() ?? '';
    if (text.length === 0) continue;

    if (totalLength + text.length > MAX_COMMENT_CHARS) {
      parts.push(text.slice(0, MAX_COMMENT_CHARS - totalLength));
      break;
    }

    parts.push(text);
    totalLength += text.length;
  }

  return parts.join('\n');
}
