import {
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_CANARY,
  CANARY_CATALOG,
  DEFAULT_CANARY_ID,
  type CanaryId,
  type CanaryDefinition,
} from '@/shared/constants.js';
import {
  resolveOriginPolicy,
  describeDecision,
  extractHost,
  type ScanAction,
} from '@/policy/origin-policy.js';
import {
  getOverrides,
  setOverride,
  clearOverride,
} from '@/policy/origin-storage.js';

interface StoredVerdict {
  status: string;
  confidence: number;
  totalScore: number;
  timestamp: number;
  url: string;
  flags: string[];
  behavioralFlags: {
    roleDrift: boolean;
    exfiltrationIntent: boolean;
    instructionFollowing: boolean;
    hiddenContentAwareness: boolean;
  };
  // Phase 4 Stage 4A — absent on pre-migration verdicts (handled as null).
  analysisError?: string | null;
  // Phase 4 Stage 4D.3 — absent on pre-4D.3 verdicts.
  canaryId?: string | null;
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function setProbeResult(id: string, passed: boolean): void {
  const el = $(id);
  el.textContent = passed ? 'PASS' : 'FAIL';
  el.className = passed ? 'probe-pass' : 'probe-fail';
}

function setBehavioralFlag(id: string, detected: boolean): void {
  const el = $(id);
  el.textContent = detected ? 'DETECTED' : 'Clear';
  el.className = detected ? 'probe-fail' : 'probe-pass';
}

// Phase 4 Stage 4D.2 — canary selector.
//
// The popup shows all canaries in CANARY_CATALOG plus the 'auto' option,
// each with a live availability badge. The user's choice is persisted to
// chrome.storage.sync so it follows them across devices. The engine selector
// (offscreen/engine.ts) reads this value on every initEngine() call.

type AvailState = 'available' | 'download' | 'unavailable' | 'loaded' | 'checking';

interface CanaryRow {
  readonly id: CanaryId;
  readonly displayName: string;
  readonly note: string | null;
  readonly requiresEnrollment: boolean;
}

const CANARY_ROWS: readonly CanaryRow[] = [
  {
    id: 'auto',
    displayName: 'Auto',
    note: 'Prefer Nano → Gemma → Qwen based on availability',
    requiresEnrollment: false,
  },
  {
    id: 'gemma-2-2b-mlc',
    displayName: CANARY_CATALOG['gemma-2-2b-mlc'].displayName,
    note: 'Default canary (WebGPU). No enrollment required.',
    requiresEnrollment: false,
  },
  {
    id: 'chrome-builtin-gemini-nano',
    displayName: CANARY_CATALOG['chrome-builtin-gemini-nano'].displayName,
    note: 'Requires Chrome Early Preview Program enrollment',
    requiresEnrollment: true,
  },
  {
    id: 'qwen2.5-0.5b-mlc',
    displayName: CANARY_CATALOG['qwen2.5-0.5b-mlc'].displayName,
    note: 'Fast-path fallback (WebGPU).',
    requiresEnrollment: false,
  },
];

function availBadge(state: AvailState): { className: string; text: string } {
  switch (state) {
    case 'available': return { className: 'avail avail-available', text: 'Available' };
    case 'download': return { className: 'avail avail-download', text: 'Download' };
    case 'unavailable': return { className: 'avail avail-unavailable', text: 'Unavailable' };
    case 'loaded': return { className: 'avail avail-loaded', text: 'Loaded' };
    case 'checking': return { className: 'avail avail-checking', text: 'Checking…' };
  }
}

function renderCanaryRows(container: HTMLElement, selected: CanaryId): void {
  container.replaceChildren();
  for (const row of CANARY_ROWS) {
    const label = document.createElement('label');
    label.className = 'canary-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'canary';
    input.value = row.id;
    input.checked = row.id === selected;
    input.addEventListener('change', () => {
      void onCanaryChange(row.id);
    });

    const labelBlock = document.createElement('div');
    labelBlock.className = 'canary-label';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = row.displayName;
    labelBlock.appendChild(nameEl);
    if (row.note !== null) {
      const noteEl = document.createElement('span');
      noteEl.className = 'note';
      noteEl.textContent = row.note;
      labelBlock.appendChild(noteEl);
    }

    const availEl = document.createElement('span');
    availEl.dataset.canaryAvail = row.id;
    const { className, text } = availBadge('checking');
    availEl.className = className;
    availEl.textContent = text;

    label.append(input, labelBlock, availEl);
    container.appendChild(label);
  }
}

function updateAvailBadge(canaryId: CanaryId, state: AvailState): void {
  const el = document.querySelector<HTMLSpanElement>(`[data-canary-avail="${canaryId}"]`);
  if (el === null) return;
  const { className, text } = availBadge(state);
  el.className = className;
  el.textContent = text;
}

interface NanoLanguageModel {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
}

function getNanoApi(): NanoLanguageModel | null {
  const lm = (globalThis as unknown as { LanguageModel?: NanoLanguageModel }).LanguageModel;
  return lm ?? null;
}

async function checkCanaryAvailability(canary: CanaryDefinition): Promise<AvailState> {
  if (canary.engineTransport === 'chrome-prompt-api') {
    const api = getNanoApi();
    if (api === null) return 'unavailable';
    try {
      const avail = await api.availability();
      if (avail === 'available') return 'available';
      if (avail === 'downloadable' || avail === 'downloading') return 'download';
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  // MLC path: presence of navigator.gpu is a proxy for runnability. The real
  // "loaded" signal comes from the engine status, which this popup doesn't
  // hear directly; 'available' is the optimistic read.
  const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
  return gpu !== undefined ? 'available' : 'unavailable';
}

async function refreshAvailability(): Promise<void> {
  const nanoAvailPromise = checkCanaryAvailability(CANARY_CATALOG['chrome-builtin-gemini-nano']);
  const gemmaAvailPromise = checkCanaryAvailability(CANARY_CATALOG['gemma-2-2b-mlc']);
  const qwenAvailPromise = checkCanaryAvailability(CANARY_CATALOG['qwen2.5-0.5b-mlc']);

  const [nano, gemma, qwen] = await Promise.all([nanoAvailPromise, gemmaAvailPromise, qwenAvailPromise]);

  updateAvailBadge('chrome-builtin-gemini-nano', nano);
  updateAvailBadge('gemma-2-2b-mlc', gemma);
  updateAvailBadge('qwen2.5-0.5b-mlc', qwen);

  // 'auto' reflects whichever concrete canary the selector would land on.
  // If Nano is available, auto resolves to Nano; else Gemma; else Qwen.
  let autoState: AvailState = 'unavailable';
  if (nano === 'available') autoState = 'available';
  else if (gemma === 'available') autoState = 'available';
  else if (qwen === 'available') autoState = 'available';
  updateAvailBadge('auto', autoState);
}

function canaryDisplayName(id: string): string {
  if (id === 'auto') return 'Auto';
  if (id === 'gemma-2-2b-mlc' || id === 'chrome-builtin-gemini-nano' || id === 'qwen2.5-0.5b-mlc') {
    return CANARY_CATALOG[id].displayName;
  }
  return id;
}

async function getSelectedCanary(): Promise<CanaryId> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_CANARY);
    const raw = result[STORAGE_KEY_CANARY];
    if (raw === 'auto' || raw === 'gemma-2-2b-mlc' || raw === 'chrome-builtin-gemini-nano' || raw === 'qwen2.5-0.5b-mlc') {
      return raw;
    }
  } catch {
    // storage.sync unavailable; fall through to default.
  }
  return DEFAULT_CANARY_ID;
}

function showToast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('visible');
  window.setTimeout(() => {
    el.classList.remove('visible');
  }, 2400);
}

async function onCanaryChange(canaryId: CanaryId): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY_CANARY]: canaryId });
    showToast('Canary updated — takes effect on next analysis');
  } catch (err) {
    showToast('Failed to save canary choice');
    console.error('canary persist failed', err);
  }
}

async function initCanarySelector(): Promise<void> {
  const container = $('canary-options');
  const selected = await getSelectedCanary();
  renderCanaryRows(container, selected);
  await refreshAvailability();
}

async function loadVerdict(): Promise<void> {
  // Always show the content container so the canary selector is visible
  // regardless of verdict state.
  $('loading').style.display = 'none';
  $('content').style.display = 'block';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    $('no-data').style.display = 'block';
    $('verdict-content').style.display = 'none';
    return;
  }

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    $('no-data').style.display = 'block';
    $('verdict-content').style.display = 'none';
    return;
  }

  const key = STORAGE_KEY_PREFIX + origin;
  const result = await chrome.storage.local.get(key);
  const verdict = result[key] as StoredVerdict | undefined;

  if (!verdict) {
    $('no-data').style.display = 'block';
    $('verdict-content').style.display = 'none';
    return;
  }

  $('no-data').style.display = 'none';
  $('verdict-content').style.display = 'block';

  const badge = $('status-badge');
  badge.textContent = verdict.status;
  badge.className = `status-badge status-${verdict.status}`;

  $('confidence-value').textContent = `${Math.round(verdict.confidence * 100)}%`;

  const fill = $('confidence-fill') as HTMLElement;
  fill.style.width = `${Math.round(verdict.confidence * 100)}%`;

  const colors: Record<string, string> = {
    CLEAN: '#4ade80',
    SUSPICIOUS: '#facc15',
    COMPROMISED: '#f87171',
    UNKNOWN: '#9ca3af',
  };
  fill.style.background = colors[verdict.status] ?? '#818cf8';

  $('score-info').textContent = `Risk score: ${verdict.totalScore} / 150`;

  // Phase 4 Stage 4A — surface analysisError so UNKNOWN verdicts (all probes
  // errored) and partial failures are visible instead of masquerading as CLEAN.
  // Issue #20 — recognise the `origin_denied:` prefix so policy-skips don't
  // read as engine failures. The per-site card already shows the skip reason
  // in-context; here we just suppress the red "analysis incomplete" card.
  const errorCard = $('error-card');
  const errorMessageEl = $('error-message');
  const isOriginDenied = verdict.analysisError?.startsWith('origin_denied:') ?? false;
  if (verdict.analysisError && !isOriginDenied) {
    errorCard.style.display = 'block';
    errorMessageEl.textContent = verdict.status === 'UNKNOWN'
      ? `Analysis incomplete: ${verdict.analysisError}`
      : `Partial analysis failure: ${verdict.analysisError}`;
  } else {
    errorCard.style.display = 'none';
  }

  // Phase 4 Stage 4D.3 — compare verdict's actual canary to the user's
  // stored preference. If they diverge, the engine's fallback chain
  // kicked in (e.g. user chose Nano but EPP is not available, so
  // Gemma ran instead). Surface this on the verdict row so the user
  // understands why their selection didn't apply.
  if (verdict.canaryId !== null && verdict.canaryId !== undefined) {
    const userChoice = await getSelectedCanary();
    if (userChoice !== 'auto' && userChoice !== verdict.canaryId) {
      const resolvedName = canaryDisplayName(verdict.canaryId);
      const requestedName = canaryDisplayName(userChoice);
      showToast(`Requested ${requestedName} unavailable — used ${resolvedName}`);
    }
  }

  setProbeResult('probe-summarization', !verdict.flags.some((f) => f.includes('ai_self') || f.includes('url_in') || f.includes('action_instruction')));
  setProbeResult('probe-detection', !verdict.flags.some((f) => f.includes('injection_detected')));
  setProbeResult('probe-adversarial', !verdict.flags.some((f) => f.includes('role_adoption') || f.includes('exfiltration') || f.includes('jailbreak')));

  setBehavioralFlag('flag-role-drift', verdict.behavioralFlags.roleDrift);
  setBehavioralFlag('flag-exfiltration', verdict.behavioralFlags.exfiltrationIntent);
  setBehavioralFlag('flag-instruction', verdict.behavioralFlags.instructionFollowing);

  if (verdict.flags.length > 0) {
    $('flags-card').style.display = 'block';
    const container = $('flags-container');
    container.innerHTML = '';
    for (const flag of verdict.flags) {
      const tag = document.createElement('span');
      tag.className = 'flag-tag';
      tag.textContent = flag;
      container.appendChild(tag);
    }
  }

  const date = new Date(verdict.timestamp);
  $('timestamp-info').textContent = `Last analyzed: ${date.toLocaleString()} | ${verdict.url}`;
}

/**
 * Issue #20 — per-site scan card. Resolves the current tab's host against
 * user overrides + the built-in deny-list, renders a three-way selector,
 * and persists changes via origin-storage. Scan state takes effect on the
 * tab's next PAGE_SNAPSHOT (reload, navigation, or keepalive wake) — a
 * toast makes that clear so the user isn't surprised by the tab's current
 * verdict not updating instantly.
 */
async function initSiteCard(): Promise<void> {
  const card = $('site-card');
  const hostEl = $('site-host');
  const stateEl = $('site-state');
  const select = $('site-scan-select') as HTMLSelectElement;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    return; // no active tab / internal page
  }
  const host = extractHost(tab.url);
  if (host === null || host === '' || host === 'extensions' || host === 'newtab') {
    // Internal Chrome pages (chrome://, newtab) have no meaningful origin
    // policy. Keep the card hidden.
    return;
  }

  card.style.display = 'block';
  hostEl.textContent = host;

  const overrides = await getOverrides();
  const decision = resolveOriginPolicy(host, overrides);
  stateEl.textContent = describeDecision(decision);

  const current = overrides[host];
  select.value = current ?? 'default';

  select.addEventListener('change', () => {
    void (async () => {
      const choice = select.value as 'default' | ScanAction;
      try {
        if (choice === 'default') {
          await clearOverride(host);
          showToast('Using default policy — applies on next page load');
        } else {
          await setOverride(host, choice);
          showToast(
            choice === 'skip'
              ? 'Never scanning this site — applies on next page load'
              : 'Always scanning this site — applies on next page load',
          );
        }
        // Re-describe so the user sees the updated state immediately even
        // though the actual scan behaviour only changes on next navigation.
        const refreshedOverrides = await getOverrides();
        const refreshed = resolveOriginPolicy(host, refreshedOverrides);
        stateEl.textContent = describeDecision(refreshed);
      } catch (err) {
        showToast('Failed to save site preference');
        console.error('site override persist failed', err);
      }
    })();
  });
}

void (async () => {
  try {
    await initSiteCard();
  } catch (err) {
    console.error('site card init failed', err);
  }
  try {
    await initCanarySelector();
  } catch (err) {
    console.error('canary selector init failed', err);
  }
  try {
    await loadVerdict();
  } catch (err) {
    console.error('loadVerdict failed', err);
  }
})();
