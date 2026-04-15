import type { PageSnapshot } from '@/types/snapshot.js';
import { extractVisibleText } from './visible-text.js';
import { extractHiddenText } from './hidden-dom.js';
import { extractScriptFingerprints } from './script-summary.js';
import { extractMetadata } from './metadata.js';

export async function extractPageSnapshot(): Promise<PageSnapshot> {
  const visibleText = extractVisibleText();
  const hiddenText = extractHiddenText();
  const scriptFingerprints = await extractScriptFingerprints();
  const metadata = extractMetadata();

  return {
    visibleText,
    hiddenText,
    scriptFingerprints,
    metadata,
    extractedAt: Date.now(),
    charCount: visibleText.length + hiddenText.length,
  };
}
