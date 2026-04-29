import type {
  RescanPageMessage,
  RescanWithMitigationMessage,
} from '@/types/messages.js';
import { isTestingModeEnabled, setTestingMode } from '@/shared/testing-mode.js';

/**
 * Issue #113 (N2) — popup observe-mode toggle. Reads the current flag,
 * sets the checkbox state, and attaches a change listener that
 * persists user toggles via setTestingMode. Failures bubble out via
 * the onToast callback so the caller can route to the popup's existing
 * showToast affordance.
 */
export async function initTestingModeToggle(
  checkbox: HTMLInputElement,
  onToast: (message: string) => void,
): Promise<void> {
  checkbox.checked = await isTestingModeEnabled();
  checkbox.addEventListener('change', () => {
    void (async () => {
      try {
        await setTestingMode(checkbox.checked);
        onToast(
          checkbox.checked
            ? 'Testing mode ON — mitigations suppressed'
            : 'Testing mode OFF — normal mitigation',
        );
      } catch (err) {
        // Roll back the visual state so the checkbox doesn't lie
        // about persisted state.
        checkbox.checked = !checkbox.checked;
        onToast('Failed to save testing-mode toggle');
        console.error('testing-mode persist failed', err);
      }
    })();
  });
}

/**
 * Issue #113 (N2) — popup "Rescan with prevention" button. The button
 * is only meaningful when there's a verdict that warrants mitigation;
 * it stays disabled for CLEAN, UNKNOWN, or absent verdicts. The click
 * dispatches RESCAN_WITH_MITIGATION to the SW, which fans out a
 * TRIGGER_RESCAN to the active tab.
 */
export function initRescanButton(
  button: HTMLButtonElement,
  verdictStatus: string | undefined,
  onToast: (message: string) => void,
): void {
  const canRescan = verdictStatus === 'SUSPICIOUS' || verdictStatus === 'COMPROMISED';
  button.disabled = !canRescan;
  if (!canRescan) return;

  button.addEventListener('click', () => {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) {
          onToast('No active tab — cannot rescan');
          return;
        }
        const msg: RescanWithMitigationMessage = {
          type: 'RESCAN_WITH_MITIGATION',
          tabId: tab.id,
        };
        await chrome.runtime.sendMessage(msg);
        onToast('Rescan triggered — mitigations will apply');
      } catch (err) {
        onToast('Rescan failed to start');
        console.error('rescan dispatch failed', err);
      }
    })();
  });
}

/**
 * Issue #114 (N3) — popup header "Rescan" button. Always-available rescan
 * that does NOT force mitigations; the testing-mode gate in the SW applies
 * normally. Enabled only for scannable tabs (http/https) with a defined
 * tab id; disabled for chrome://, chrome-extension://, about:, and any
 * tab missing a URL or id.
 *
 * Distinct from initRescanButton (N2, testing-mode-only, forces mitigations
 * on, verdict-status-gated). This button is verdict-agnostic: a user may
 * always re-run analysis on a normal page.
 */
export async function initRescanPageButton(
  button: HTMLButtonElement,
  onToast: (message: string) => void,
): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const tabId = tab?.id;
  const isScannableUrl = url.startsWith('http://') || url.startsWith('https://');
  const canScan = isScannableUrl && tabId !== undefined;

  button.disabled = !canScan;
  if (!canScan) return;

  // tabId is captured here; the popup IIFE re-runs on each open so a
  // stale capture across tab switches is not a concern (the popup
  // closes when the active tab changes).
  const capturedTabId = tabId;

  button.addEventListener('click', () => {
    void (async () => {
      try {
        const msg: RescanPageMessage = {
          type: 'RESCAN_PAGE',
          tabId: capturedTabId,
        };
        await chrome.runtime.sendMessage(msg);
        onToast('Rescan triggered');
      } catch (err) {
        onToast('Rescan failed to start');
        console.error('rescan-page dispatch failed', err);
      }
    })();
  });
}
