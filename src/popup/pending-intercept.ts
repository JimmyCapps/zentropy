import type { InterceptVerdict, PortalId } from '@/types/messages.js';
import {
  MAX_INTERCEPT_LATENCY_EXTENSION_MS,
  STORAGE_KEY_PENDING_INTERCEPT,
} from '@/shared/constants.js';
import {
  recordOverride,
  shouldPromptWhitelist,
} from '@/policy/intercept-overrides.js';

export interface PendingInterceptRecord {
  readonly requestId: string;
  readonly portalId: PortalId;
  readonly portalOrigin: string;
  readonly scannedUrl: string;
  readonly status: 'scanning' | 'verdict-ready';
  readonly verdict: InterceptVerdict | null;
  readonly startedAt: number;
  readonly timeoutAt: number;
  readonly timeoutExtended: boolean;
}

export function renderPendingIntercept(
  root: HTMLElement,
  record: PendingInterceptRecord | null,
): void {
  while (root.firstChild !== null) root.removeChild(root.firstChild);
  if (record === null) return;

  const panel = document.createElement('section');
  panel.className = 'pending-intercept';
  panel.setAttribute('data-status', record.status);

  const heading = document.createElement('h2');
  heading.textContent = record.status === 'scanning' ? 'Scanning URL…' : 'URL scan complete';
  panel.appendChild(heading);

  const target = document.createElement('p');
  target.className = 'pending-intercept-url';
  target.textContent = record.scannedUrl;
  panel.appendChild(target);

  if (record.status === 'verdict-ready' && record.verdict !== null) {
    const status = document.createElement('p');
    status.className = `pending-intercept-status status-${record.verdict.status.toLowerCase()}`;
    status.textContent = `Verdict: ${record.verdict.status}`;
    panel.appendChild(status);

    const breakdown = document.createElement('p');
    breakdown.className = 'pending-intercept-breakdown';
    const pb = record.verdict.probeBreakdown;
    breakdown.textContent = `Probes: ${pb.totalProbes} run · ${pb.suspiciousProbes} suspicious · ${pb.compromisedProbes} compromised`;
    panel.appendChild(breakdown);

    if (record.verdict.analysisError !== null) {
      const err = document.createElement('p');
      err.className = 'pending-intercept-error';
      err.textContent = `Error: ${record.verdict.analysisError}`;
      panel.appendChild(err);
    }
  }

  const showWait = canShowWait(record);
  const showButtons =
    record.status === 'scanning' ||
    (record.verdict !== null && record.verdict.status !== 'CLEAN');

  if (showButtons) {
    const buttons = document.createElement('div');
    buttons.className = 'pending-intercept-buttons';

    const sendAnywayBtn = document.createElement('button');
    sendAnywayBtn.type = 'button';
    sendAnywayBtn.dataset.action = 'send-anyway';
    sendAnywayBtn.textContent = 'Send anyway';
    sendAnywayBtn.addEventListener('click', () => {
      void onSendAnyway(record, root);
    });
    buttons.appendChild(sendAnywayBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      void onCancel(root);
    });
    buttons.appendChild(cancelBtn);

    if (showWait) {
      const waitBtn = document.createElement('button');
      waitBtn.type = 'button';
      waitBtn.dataset.action = 'wait';
      waitBtn.textContent = 'Wait';
      waitBtn.addEventListener('click', () => {
        void onWait(record, root);
      });
      buttons.appendChild(waitBtn);
    }

    panel.appendChild(buttons);
  }

  // Whitelist CTA — async check; appended once shouldPromptWhitelist resolves.
  const whitelistContainer = document.createElement('div');
  whitelistContainer.className = 'pending-intercept-whitelist';
  panel.appendChild(whitelistContainer);
  void renderWhitelistCta(record, whitelistContainer);

  root.appendChild(panel);
}

function canShowWait(record: PendingInterceptRecord): boolean {
  if (record.status === 'scanning') return true;
  if (record.verdict === null) return false;
  if (record.timeoutExtended) return false;
  return record.verdict.analysisError === 'intercept_timeout';
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function onSendAnyway(record: PendingInterceptRecord, root: HTMLElement): Promise<void> {
  const domain = urlHost(record.scannedUrl);
  await recordOverride(record.portalId, domain);
  await chrome.storage.local.remove(STORAGE_KEY_PENDING_INTERCEPT);
  renderPendingIntercept(root, null);
}

async function onCancel(root: HTMLElement): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY_PENDING_INTERCEPT);
  renderPendingIntercept(root, null);
}

async function onWait(record: PendingInterceptRecord, root: HTMLElement): Promise<void> {
  const updated: PendingInterceptRecord = {
    ...record,
    timeoutAt: record.timeoutAt + MAX_INTERCEPT_LATENCY_EXTENSION_MS,
    timeoutExtended: true,
  };
  await chrome.storage.local.set({ [STORAGE_KEY_PENDING_INTERCEPT]: updated });
  renderPendingIntercept(root, updated);
}

async function renderWhitelistCta(
  record: PendingInterceptRecord,
  container: HTMLElement,
): Promise<void> {
  const domain = urlHost(record.scannedUrl);
  const should = await shouldPromptWhitelist(record.portalId, domain);
  if (!should) return;
  while (container.firstChild !== null) container.removeChild(container.firstChild);
  const cta = document.createElement('p');
  cta.textContent = `You've overridden HoneyLLM 3+ times for ${domain} this week. Whitelist this domain?`;
  container.appendChild(cta);
}

/**
 * Initialise the pending-intercept panel inside the popup.
 *
 * Reads `STORAGE_KEY_PENDING_INTERCEPT` on open and subscribes to
 * `chrome.storage.onChanged` for live updates while the popup is open.
 * If `rootEl` is null the function is a no-op (popup test harness).
 */
export async function initPendingInterceptPanel(rootEl: HTMLElement | null): Promise<void> {
  if (rootEl === null) return;

  const fetchAndRender = async (): Promise<void> => {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY_PENDING_INTERCEPT);
      const v = r[STORAGE_KEY_PENDING_INTERCEPT];
      const record = isPendingInterceptRecord(v) ? v : null;
      renderPendingIntercept(rootEl, record);
    } catch {
      renderPendingIntercept(rootEl, null);
    }
  };

  await fetchAndRender();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!(STORAGE_KEY_PENDING_INTERCEPT in changes)) return;
    void fetchAndRender();
  });
}

function isPendingInterceptRecord(v: unknown): v is PendingInterceptRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.requestId === 'string' &&
    typeof r.portalId === 'string' &&
    typeof r.scannedUrl === 'string' &&
    (r.status === 'scanning' || r.status === 'verdict-ready') &&
    typeof r.startedAt === 'number' &&
    typeof r.timeoutAt === 'number' &&
    typeof r.timeoutExtended === 'boolean'
  );
}
