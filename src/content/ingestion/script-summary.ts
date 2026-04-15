import type { ScriptFingerprint } from '@/types/snapshot.js';
import { SCRIPT_PREVIEW_LENGTH } from '@/shared/constants.js';

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function extractScriptFingerprints(): Promise<readonly ScriptFingerprint[]> {
  const scripts = document.querySelectorAll('script');
  const fingerprints: ScriptFingerprint[] = [];

  for (const script of scripts) {
    const src = script.src || null;
    const content = script.textContent ?? '';

    if (content.length === 0 && src === null) continue;

    const preview = content.slice(0, SCRIPT_PREVIEW_LENGTH);
    const hash = content.length > 0 ? await hashContent(content) : '';

    fingerprints.push({
      src,
      preview,
      hash,
      length: content.length,
    });
  }

  return fingerprints;
}
