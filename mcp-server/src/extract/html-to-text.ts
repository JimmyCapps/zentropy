const DROP_TAGS = ['script', 'style', 'noscript', 'template'] as const;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+[0-9]?);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function dropTagBlocks(input: string): string {
  let out = input;
  for (const tag of DROP_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    out = out.replace(re, ' ');
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi');
    out = out.replace(selfClosing, ' ');
  }
  return out;
}

export function htmlToText(html: string): string {
  if (html.length === 0) return '';
  const withoutDropped = dropTagBlocks(html);
  const withoutComments = withoutDropped.replace(/<!--[\s\S]*?-->/g, ' ');
  const tagsStripped = withoutComments.replace(/<[a-zA-Z!/][^>]*>/g, ' ');
  const decoded = decodeEntities(tagsStripped);
  return decoded.replace(/\s+/g, ' ').trim();
}
