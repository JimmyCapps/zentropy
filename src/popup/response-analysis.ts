import type { PortalId, ResponseVerdict } from '@/types/portal-response.js';

// Issue #126 (N7a) — popup renderer for the chat-portal response
// verdict accordion. Mirrors the hunter-findings / entities accordions
// in popup.html: same `.placeholder` empty state, same `.card` body,
// same id-based binding (`response-analysis-body`).
//
// Render states:
//   - undefined / null verdict   → placeholder text
//   - CLEAN / SUSPICIOUS /        → status badge + per-probe rows + meta
//     COMPROMISED
//   - UNKNOWN + analysisError    → error card with the error string
//
// Always includes a one-line privacy note: response analysed locally;
// never exfiltrated.

const PLACEHOLDER_TEXT = 'No response analysed yet — only fires on chat portals.';
const PRIVACY_NOTE = 'Response analysed locally on-device. Never exfiltrated.';

const PORTAL_DISPLAY_NAME: Record<PortalId, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
};

function statusClass(status: ResponseVerdict['status']): string {
  switch (status) {
    case 'CLEAN':
      return 'response-status-clean';
    case 'SUSPICIOUS':
      return 'response-status-suspicious';
    case 'COMPROMISED':
      return 'response-status-compromised';
    case 'UNKNOWN':
    default:
      return 'response-status-unknown';
  }
}

function renderHeader(verdict: ResponseVerdict): HTMLElement {
  const header = document.createElement('div');
  header.className = 'response-header';

  const badge = document.createElement('span');
  badge.className = `response-status-badge ${statusClass(verdict.status)}`;
  badge.textContent = verdict.status;
  header.appendChild(badge);

  const portal = document.createElement('span');
  portal.className = 'response-portal-name';
  portal.textContent = PORTAL_DISPLAY_NAME[verdict.portalId];
  header.appendChild(portal);

  return header;
}

function renderMeta(verdict: ResponseVerdict): HTMLElement {
  const meta = document.createElement('div');
  meta.className = 'response-meta';
  meta.textContent = `${verdict.responseTextLength} chars · score ${verdict.totalScore}`;
  return meta;
}

function renderError(verdict: ResponseVerdict): HTMLElement {
  const err = document.createElement('div');
  err.className = 'response-error';
  err.textContent = `Analysis error: ${verdict.analysisError ?? 'unknown'}`;
  return err;
}

function renderProbeRows(verdict: ResponseVerdict): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'response-probe-list';
  for (const probe of verdict.probeResults) {
    const li = document.createElement('li');
    li.className = `response-probe-row ${probe.passed ? 'passed' : 'flagged'}`;
    const name = document.createElement('span');
    name.className = 'response-probe-name';
    name.textContent = probe.probeName;
    const status = document.createElement('span');
    status.className = 'response-probe-status';
    status.textContent = probe.errorMessage !== null ? 'error' : probe.passed ? 'pass' : 'flag';
    li.append(name, status);
    ul.appendChild(li);
  }
  return ul;
}

function renderPrivacyNote(): HTMLElement {
  const note = document.createElement('div');
  note.className = 'response-privacy-note';
  note.textContent = PRIVACY_NOTE;
  return note;
}

export function renderResponseVerdict(
  body: HTMLElement,
  verdict: ResponseVerdict | null | undefined,
): void {
  if (verdict === null || verdict === undefined) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_TEXT;
    return;
  }

  const children: Node[] = [renderHeader(verdict), renderMeta(verdict)];

  if (verdict.analysisError !== null) {
    children.push(renderError(verdict));
  }

  if (verdict.probeResults.length > 0) {
    children.push(renderProbeRows(verdict));
  }

  children.push(renderPrivacyNote());

  body.replaceChildren(...children);
  body.className = '';
}
