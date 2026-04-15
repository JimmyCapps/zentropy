const SUSPICIOUS_DATA_PATTERNS = [
  /data-(?:ai|prompt|instruction|context|system|override|inject)/i,
];

export function extractDataAttributes(): string {
  const allElements = document.querySelectorAll('*');
  const parts: string[] = [];

  for (const el of allElements) {
    for (const attr of el.attributes) {
      if (!attr.name.startsWith('data-')) continue;

      const matchesSuspicious = SUSPICIOUS_DATA_PATTERNS.some((p) => p.test(attr.name));
      const hasLongValue = attr.value.length > 50;

      if (matchesSuspicious || hasLongValue) {
        parts.push(`[${attr.name}]: ${attr.value}`);
      }
    }
  }

  return parts.join('\n');
}
