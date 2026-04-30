import type {
  HoneyLLMMessage,
  InterceptScanRequestMessage,
  InterceptVerdict,
  InterceptVerdictMessage,
} from '@/types/messages.js';
import { INTERCEPT_INPUT_DEBOUNCE_MS } from '@/shared/constants.js';
import { extractUrls } from './url-extract.js';
import {
  disableSendButton,
  isHoneyLLMDisabled,
  restoreSendButton,
} from './send-button.js';
import type { InterceptAdapter } from './adapters/types.js';
import { chatgptInterceptAdapter } from './adapters/chatgpt.js';
import { claudeInterceptAdapter } from './adapters/claude.js';
import { geminiInterceptAdapter } from './adapters/gemini.js';

const ALL_INTERCEPT_ADAPTERS: readonly InterceptAdapter[] = [
  chatgptInterceptAdapter,
  claudeInterceptAdapter,
  geminiInterceptAdapter,
];

export function selectInterceptAdapter(hostname: string): InterceptAdapter | null {
  for (const adapter of ALL_INTERCEPT_ADAPTERS) {
    if (adapter.matchesHost(hostname)) return adapter;
  }
  return null;
}

interface AttachOptions {
  readonly adapter: InterceptAdapter;
  readonly hostname: string;
  /** Optional override for tests / manual smoke runs. Default: window.location.origin */
  readonly originForRequest?: string;
}

type Disposer = () => void;

interface PendingScan {
  readonly requestId: string;
  readonly url: string;
}

export function attachInterceptObserver(opts: AttachOptions): Disposer {
  // Hostname guard. The bootstrap may pass any host; we only run when the
  // adapter accepts it. Returning a no-op disposer keeps callers symmetric.
  if (!opts.adapter.matchesHost(opts.hostname)) {
    return () => undefined;
  }

  const adapter = opts.adapter;
  const origin = opts.originForRequest ?? (typeof window !== 'undefined' ? window.location.origin : '');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Track per-URL pending scans so deliverVerdict can correlate replies.
  const pendingScans = new Map<string, PendingScan>(); // requestId → scan
  // Latest verdict per URL — used to recompute the gate state when input changes.
  const verdictByUrl = new Map<string, InterceptVerdict>();
  // Currently extracted URLs (most recent extraction, ordered).
  let currentUrls: readonly string[] = [];

  function generateRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `intercept-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function dispatchScanRequest(url: string): void {
    const requestId = generateRequestId();
    pendingScans.set(requestId, { requestId, url });
    const msg: InterceptScanRequestMessage = {
      type: 'INTERCEPT_SCAN_REQUEST',
      tabId: -1, // SW reads sender.tab.id; this is informational
      portalId: adapter.portalId,
      url,
      requestId,
      origin,
    };
    try {
      void chrome.runtime.sendMessage(msg);
    } catch {
      // SW may be initializing; the input observer will retry on next change.
    }
  }

  function gateState(): {
    disabled: boolean;
    reason: string;
  } {
    if (currentUrls.length === 0) {
      return { disabled: false, reason: '' };
    }
    // Gate by the worst verdict among all currently-typed URLs:
    // missing → scanning, CLEAN → ok (this URL), SUSPICIOUS/COMPROMISED → blocked, UNKNOWN → blocked
    let scanning = false;
    let blocked: 'SUSPICIOUS' | 'COMPROMISED' | 'UNKNOWN' | null = null;
    for (const url of currentUrls) {
      const v = verdictByUrl.get(url);
      if (v === undefined) {
        scanning = true;
        continue;
      }
      if (v.status === 'COMPROMISED') {
        blocked = 'COMPROMISED';
        break;
      }
      if (v.status === 'SUSPICIOUS') {
        if (blocked === null || blocked === 'UNKNOWN') {
          blocked = 'SUSPICIOUS';
        }
      } else if (v.status === 'UNKNOWN' && blocked === null) {
        blocked = 'UNKNOWN';
      }
    }
    if (blocked !== null) {
      return { disabled: true, reason: `HoneyLLM blocked: ${blocked} — open extension popup for details` };
    }
    if (scanning) {
      return { disabled: true, reason: 'HoneyLLM scanning…' };
    }
    return { disabled: false, reason: '' };
  }

  function applyGate(): void {
    const button = adapter.findSendButton(document);
    if (button === null) return;
    const state = gateState();
    if (state.disabled) {
      disableSendButton(button, state.reason);
    } else if (isHoneyLLMDisabled(button)) {
      restoreSendButton(button);
    }
  }

  function findInput(): HTMLElement | null {
    return adapter.findInput(document);
  }

  function onInput(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      const input = findInput();
      if (input === null) return;
      const text = adapter.readInputText(input);
      const newUrls = extractUrls(text);
      // Drop verdicts for URLs no longer present (user deleted them).
      const newSet = new Set(newUrls);
      for (const url of [...verdictByUrl.keys()]) {
        if (!newSet.has(url)) verdictByUrl.delete(url);
      }
      // Dispatch new scans for URLs we haven't seen before AND that aren't
      // currently in flight.
      const inFlightUrls = new Set([...pendingScans.values()].map((p) => p.url));
      for (const url of newUrls) {
        if (!verdictByUrl.has(url) && !inFlightUrls.has(url)) {
          dispatchScanRequest(url);
        }
      }
      currentUrls = newUrls;
      applyGate();
    }, INTERCEPT_INPUT_DEBOUNCE_MS);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') return;
    if (ev.shiftKey) return; // Shift-Enter is a newline in chat composers; let it through.
    const button = adapter.findSendButton(document);
    if (button === null) return;
    if (isHoneyLLMDisabled(button)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  function onChromeMessage(msg: HoneyLLMMessage): void {
    if (msg.type !== 'INTERCEPT_VERDICT') return;
    const verdictMsg = msg as InterceptVerdictMessage;
    const pending = pendingScans.get(verdictMsg.requestId);
    if (pending === undefined) return;
    pendingScans.delete(verdictMsg.requestId);
    verdictByUrl.set(pending.url, verdictMsg.verdict);
    applyGate();
  }

  // Attach listeners. Use document for capture so we see keydown before the
  // page handles it. Input event bubbles from the contenteditable.
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeyDown, true);
  chrome.runtime.onMessage.addListener(onChromeMessage);

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('keydown', onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onChromeMessage);
    // Best-effort restore the button on dispose.
    const button = adapter.findSendButton(document);
    if (button !== null && isHoneyLLMDisabled(button)) restoreSendButton(button);
  };
}
