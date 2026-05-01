export type ExtractUrl<TInput = unknown> = (input: TInput) => string | undefined;

const URL_FIELD_PRECEDENCE = ['url', 'href', 'webPath', 'uri'] as const;

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

export function defaultExtractUrl(input: unknown): string | undefined {
  if (isHttpUrl(input)) return input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  for (const field of URL_FIELD_PRECEDENCE) {
    const value = obj[field];
    if (isHttpUrl(value)) return value;
  }
  return undefined;
}
