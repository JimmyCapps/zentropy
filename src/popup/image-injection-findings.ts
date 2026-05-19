import type { ImageInjectionFinding } from '@/probes/image-injection.js';

const PLACEHOLDER_LEGACY = 'No image data yet.';
const PLACEHOLDER_EMPTY = 'No page images analysed on this page.';

function buildFindingRow(finding: ImageInjectionFinding): HTMLElement {
  const row = document.createElement('div');
  row.className =
    'image-injection-row ' +
    (finding.injectionPresent ? 'image-injection-fail' : 'image-injection-pass');

  const head = document.createElement('div');
  head.className = 'image-injection-head';

  const left = document.createElement('span');
  left.className = 'image-injection-src';
  left.title = finding.imageSrc;
  left.textContent = `chunk ${String(finding.chunkIndex)} · ${finding.imageSrc}`;

  const right = document.createElement('span');
  right.className = 'image-injection-verdict';
  right.textContent = finding.injectionPresent ? 'Injected' : 'Clean';

  head.append(left, right);
  row.appendChild(head);

  if (finding.injectionPresent && finding.technique !== null) {
    const chip = document.createElement('span');
    chip.className = 'image-injection-technique-chip';
    chip.textContent = finding.technique;
    row.appendChild(chip);
  }

  if (finding.extractedText.length > 0) {
    const text = document.createElement('div');
    text.className = 'image-injection-extracted-text';
    text.textContent = finding.extractedText;
    row.appendChild(text);
  }

  if (finding.rationale.length > 0) {
    const rationale = document.createElement('div');
    rationale.className = 'image-injection-rationale';
    rationale.textContent = finding.rationale;
    row.appendChild(rationale);
  }

  return row;
}

/**
 * Issue #9 Stage 4G.6a — render per-image findings from the
 * image_injection probe (PR #205). Three render branches:
 *
 * - `undefined`  → legacy verdict written before the slot existed; show
 *   the "no data yet" placeholder so users on cached pre-4G verdicts see
 *   an honest empty state rather than "no images" (which implies the
 *   probe ran).
 * - `null` or `[]` → probe ran but the page had no analysable images, or
 *   every image returned `injection_present: false` with no other signal;
 *   show the "no images analysed" placeholder.
 * - non-empty array → render one .image-injection-row per finding,
 *   ordered as produced by the orchestrator (chunk-index ascending).
 *
 * Pure DOM construction; idempotent re-render via `replaceChildren`.
 * No network or storage reads.
 */
export function renderImageInjectionFindings(
  body: HTMLElement,
  findings: readonly ImageInjectionFinding[] | null | undefined,
): void {
  if (findings === undefined) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_LEGACY;
    return;
  }
  if (findings === null || findings.length === 0) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_EMPTY;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'image-injection-list';
  for (const finding of findings) {
    wrapper.appendChild(buildFindingRow(finding));
  }
  body.replaceChildren(wrapper);
  body.className = '';
}
