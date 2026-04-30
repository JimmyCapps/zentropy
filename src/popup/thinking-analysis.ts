import type { PortalId, ThinkingVerdict } from '@/types/portal-response.js';

// Issue #131 (N7c) — popup renderer for the chat-portal thinking
// (reasoning) verdict accordion. Mirrors response-analysis.ts (#126):
// same `.placeholder` empty state, same `.card` body, same id-based
// binding (`thinking-analysis-body`). CSS classes prefixed `thinking-`
// so they don't collide with `response-`.
//
// Privacy posture: the accordion shows portal + char count + per-probe
// rows + a privacy note. It does NOT render the captured thinking text
// itself by default — thinking blocks frequently contain the user's
// prompt reformulated, which we treat as more sensitive than the
// already-public response text.

const PLACEHOLDER_TEXT = 'No thinking block captured yet — only fires when extended thinking / reasoning is active.';
const PRIVACY_NOTE = 'Thinking analysed locally on-device. Captured text never leaves the browser.';

const PORTAL_DISPLAY_NAME: Record<PortalId, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
};

function statusClass(status: ThinkingVerdict['status']): string {
  switch (status) {
    case 'CLEAN':
      return 'thinking-status-clean';
    case 'SUSPICIOUS':
      return 'thinking-status-suspicious';
    case 'COMPROMISED':
      return 'thinking-status-compromised';
    case 'UNKNOWN':
    default:
      return 'thinking-status-unknown';
  }
}

function renderHeader(verdict: ThinkingVerdict): HTMLElement {
  const header = document.createElement('div');
  header.className = 'thinking-header';

  const badge = document.createElement('span');
  badge.className = `thinking-status-badge ${statusClass(verdict.status)}`;
  badge.textContent = verdict.status;
  header.appendChild(badge);

  const portal = document.createElement('span');
  portal.className = 'thinking-portal-name';
  portal.textContent = PORTAL_DISPLAY_NAME[verdict.portalId];
  header.appendChild(portal);

  return header;
}

function renderMeta(verdict: ThinkingVerdict): HTMLElement {
  const meta = document.createElement('div');
  meta.className = 'thinking-meta';
  meta.textContent = `${verdict.thinkingTextLength} chars · score ${verdict.totalScore}`;
  return meta;
}

function renderError(verdict: ThinkingVerdict): HTMLElement {
  const err = document.createElement('div');
  err.className = 'thinking-error';
  err.textContent = `Analysis error: ${verdict.analysisError ?? 'unknown'}`;
  return err;
}

function renderProbeRows(verdict: ThinkingVerdict): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'thinking-probe-list';
  for (const probe of verdict.probeResults) {
    const li = document.createElement('li');
    li.className = `thinking-probe-row ${probe.passed ? 'passed' : 'flagged'}`;
    const name = document.createElement('span');
    name.className = 'thinking-probe-name';
    name.textContent = probe.probeName;
    const status = document.createElement('span');
    status.className = 'thinking-probe-status';
    status.textContent = probe.errorMessage !== null ? 'error' : probe.passed ? 'pass' : 'flag';
    li.append(name, status);
    ul.appendChild(li);
  }
  return ul;
}

function renderPrivacyNote(): HTMLElement {
  const note = document.createElement('div');
  note.className = 'thinking-privacy-note';
  note.textContent = PRIVACY_NOTE;
  return note;
}

export function renderThinkingVerdict(
  body: HTMLElement,
  verdict: ThinkingVerdict | null | undefined,
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
