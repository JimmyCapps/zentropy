import type { SecurityVerdict } from '@/types/verdict.js';
import type {
  ApplyMitigationMessage,
  TriggerRescanMessage,
  VerdictMessage,
} from '@/types/messages.js';
import { isTestingModeEnabled } from '@/shared/testing-mode.js';

/**
 * Issue #113 (N2) — VERDICT + APPLY_MITIGATION dispatch with testing-mode gate.
 *
 * VERDICT is always dispatched: window-globals, meta tag, page-stamp embed,
 * and toolbar icon all key off it, and observe-mode is meant to leave those
 * surfaces working.
 *
 * APPLY_MITIGATION is dispatched only when:
 *   - verdict.status is 'COMPROMISED' or 'SUSPICIOUS' (status guard, outer)
 *   - AND (forceMitigation is true) OR (testing-mode is off)
 *
 * `forceMitigation` is set by the TRIGGER_RESCAN path (popup → SW →
 * content → SW). It overrides the testing-mode flag for this single
 * verdict only; the persisted toggle is not mutated. Origin-skipped
 * verdicts are 'UNKNOWN' so they fail the status guard and never
 * dispatch APPLY_MITIGATION regardless of testing-mode.
 *
 * Race window: a user toggle flip while analysis is in flight reads
 * the new state when this fires. Acceptable — applying current
 * testing-mode at dispatch time matches user intent at that moment.
 */
export async function dispatchVerdictMessages(
  tabId: number,
  verdict: SecurityVerdict,
  forceMitigation: boolean,
): Promise<void> {
  const verdictMsg: VerdictMessage = { type: 'VERDICT', verdict };
  chrome.tabs.sendMessage(tabId, verdictMsg);

  if (verdict.status !== 'COMPROMISED' && verdict.status !== 'SUSPICIOUS') return;

  if (!forceMitigation && (await isTestingModeEnabled())) return;

  const mitigateMsg: ApplyMitigationMessage = { type: 'APPLY_MITIGATION', verdict };
  chrome.tabs.sendMessage(tabId, mitigateMsg);
}

/**
 * Issue #113 (N2) — RESCAN_WITH_MITIGATION handler. Fans out a
 * TRIGGER_RESCAN to the named tab unconditionally; the content script
 * re-extracts and re-sends PAGE_SNAPSHOT with `forceMitigation: true`,
 * which then bypasses the testing-mode gate at dispatch time.
 */
export function handleRescanWithMitigation(tabId: number): void {
  const msg: TriggerRescanMessage = { type: 'TRIGGER_RESCAN', forceMitigation: true };
  chrome.tabs.sendMessage(tabId, msg);
}

/**
 * Issue #114 (N3) — RESCAN_PAGE handler. Fans out a TRIGGER_RESCAN with
 * `forceMitigation: false` to the named tab. The content script re-extracts
 * and re-sends PAGE_SNAPSHOT without the override, so the testing-mode
 * gate in dispatchVerdictMessages applies normally. Distinct from
 * handleRescanWithMitigation which forces mitigations on for one run.
 */
export function handleRescanPage(tabId: number): void {
  const msg: TriggerRescanMessage = { type: 'TRIGGER_RESCAN', forceMitigation: false };
  chrome.tabs.sendMessage(tabId, msg);
}
