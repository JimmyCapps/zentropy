import type { LogEntry } from '@/shared/logger.js';

const SLUG_MAX = 60;

export interface PageRoutingTarget {
  readonly kind: 'page' | 'source';
  readonly key: string;
  readonly filename: string;
}

function sanitize(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function urlToSlug(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return sanitize(url).slice(0, SLUG_MAX) || 'unknown';
  }
  const host = sanitize(parsed.hostname);
  const path = sanitize(parsed.pathname);
  const slug = path.length > 0 ? `${host}_${path}` : host;
  return slug.slice(0, SLUG_MAX) || 'unknown';
}

export function deriveTarget(entry: LogEntry): PageRoutingTarget {
  if (entry.pageUrl !== undefined && entry.pageUrl.length > 0) {
    const key = urlToSlug(entry.pageUrl);
    return { kind: 'page', key, filename: `${key}.jsonl` };
  }
  const sourceKey = `_${entry.source}`;
  return { kind: 'source', key: sourceKey, filename: `${sourceKey}.jsonl` };
}
