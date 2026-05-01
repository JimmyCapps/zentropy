import type { PageSnapshot } from '@/types/snapshot.js';
import { MAX_HIDDEN_TEXT_CHARS } from '@/shared/constants.js';
import { extractVisibleText } from './visible-text.js';
import { extractHiddenText } from './hidden-dom.js';
import { extractScriptFingerprints } from './script-summary.js';
import { extractMetadata } from './metadata.js';
import { extractComments } from './comments.js';
import { extractAltText } from './alt-text.js';
import { extractAriaLabels } from './aria-labels.js';
import { extractCSSContent } from './css-content.js';
import { extractDataAttributes } from './data-attrs.js';
import { extractNoscriptText } from './noscript.js';
import { extractImages } from './images.js';

interface AuxiliarySection {
  readonly label: string;
  readonly content: string;
}

/**
 * Each aux extractor in `src/content/ingestion/` covers an injection vector
 * that the base `extractHiddenText` selector list misses (HTML comments,
 * `alt`/`aria-label`/`title` attributes, CSS `content` pseudo-elements,
 * suspicious `data-*` attributes, `<noscript>` text). Section markers
 * preserve provenance for downstream consumers — Hawk treats the combined
 * blob as one chunk, but the LLM probe receives a labelled view via
 * `buildAnalysisText` in the orchestrator. Capped at MAX_HIDDEN_TEXT_CHARS
 * combined to bound LLM token cost; per-extractor caps remain.
 */
function combineHiddenSections(base: string, aux: readonly AuxiliarySection[]): string {
  const parts: string[] = base.length > 0 ? [base] : [];
  let totalLen = base.length;
  for (const section of aux) {
    if (section.content.length === 0) continue;
    const block = `[${section.label}]\n${section.content}`;
    if (totalLen + block.length + 1 > MAX_HIDDEN_TEXT_CHARS) {
      const remaining = MAX_HIDDEN_TEXT_CHARS - totalLen - section.label.length - 4;
      if (remaining > 0) {
        parts.push(`[${section.label}]\n${section.content.slice(0, remaining)}`);
      }
      break;
    }
    parts.push(block);
    totalLen += block.length + 1;
  }
  return parts.join('\n');
}

export async function extractPageSnapshot(): Promise<PageSnapshot> {
  const visibleText = extractVisibleText();
  const baseHidden = extractHiddenText();
  const hiddenText = combineHiddenSections(baseHidden, [
    { label: 'COMMENTS', content: extractComments() },
    { label: 'ALT', content: extractAltText() },
    { label: 'ARIA', content: extractAriaLabels() },
    { label: 'CSS_CONTENT', content: extractCSSContent() },
    { label: 'DATA_ATTRS', content: extractDataAttributes() },
    { label: 'NOSCRIPT', content: extractNoscriptText() },
  ]);
  const scriptFingerprints = await extractScriptFingerprints();
  const metadata = extractMetadata();
  // SR-F (registry-#51) — capture the raw outer HTML so the SW can fingerprint
  // static-frame zones against the signed registry. Absent → registry MISS.
  const pageHtml = document.documentElement.outerHTML;
  // Phase 4 Stage 4G.2 (#9) — top-N images for the future image-injection probe.
  const images = extractImages();

  return {
    visibleText,
    hiddenText,
    scriptFingerprints,
    metadata,
    extractedAt: Date.now(),
    charCount: visibleText.length + hiddenText.length,
    pageHtml,
    images,
  };
}
