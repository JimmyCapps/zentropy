import type { PageMetadata } from '@/types/snapshot.js';

export function extractMetadata(): PageMetadata {
  const ogTags = new Map<string, string>();

  document.querySelectorAll('meta[property^="og:"]').forEach((meta) => {
    const property = meta.getAttribute('property') ?? '';
    const content = meta.getAttribute('content') ?? '';
    if (property && content) ogTags.set(property, content);
  });

  const cspMeta =
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
    null;

  const descriptionMeta =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';

  return {
    title: document.title,
    url: window.location.href,
    origin: window.location.origin,
    description: descriptionMeta,
    ogTags,
    cspMeta,
    lang: document.documentElement.lang || 'unknown',
  };
}
