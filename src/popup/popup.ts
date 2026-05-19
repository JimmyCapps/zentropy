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
import {
  initTestingModeToggle,
  initRescanButton,
  initRescanPageButton,
} from './testing-mode-controls.js';
import { renderHunterSummary, type HunterSummary } from './hunter-findings.js';
import { renderEntitySummary, type EntitySummary } from './entities.js';
import { renderEmbeddingsFindings } from './embeddings-findings.js';
import type { EmbeddingsFinding } from '@/hunters/embeddings/types.js';
import { renderImageInjectionFindings } from './image-injection-findings.js';
import type { ImageInjectionFinding } from '@/probes/image-injection.js';
import { renderResponseVerdict } from './response-analysis.js';
import { renderThinkingVerdict } from './thinking-analysis.js';
import type { ResponseVerdict, ThinkingVerdict } from '@/types/portal-response.js';
import { getCacheStats, clearCache } from '@/service-worker/scan-cache.js';
import { getRegistryStats, resetRegistryTelemetry } from '@/registry/telemetry.js';
import { renderRegistryStats } from './registry-stats.js';
import { initPendingInterceptPanel } from './pending-intercept.js';
import { initHeartbeatBanner } from './heartbeat-banner.js';

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
  // Issue #114 (N3) — surfaced in the Mitigations applied accordion.
  // Absent on pre-N3 verdicts; SecurityVerdict has always carried it.
  mitigationsApplied?: readonly string[];
  // Issue #112 (N1) — compact hunter tier summary, rendered by #144.
  // Absent on pre-#112 verdicts; null when orchestrator reported
  // perChunkAnalysis === null (origin-skipped or empty page).
  hunterSummary?: HunterSummary | null;
  // Issue #122 (N14d) — rolled-up entity summary. Absent on pre-#122
  // verdicts; null when no chunks produced packets.
  entitySummary?: EntitySummary | null;
  // Issue #126 (N7a) — chat-portal response verdict. Absent on pre-#126
  // verdicts; null on origins where no portal response was observed.
  responseVerdict?: ResponseVerdict | null;
  // Issue #131 (N7c) — chat-portal thinking-block verdict. Absent on
  // pre-#131 verdicts; null on origins where no thinking block was
  // observed (the steady state for most conversations on most portals).
  thinkingVerdict?: ThinkingVerdict | null;
  // Issue #129 Stage 5 — per-chunk embeddings-Hunter findings (top-K
  // corpus matches + cosine scores). Absent on pre-Stage-5 verdicts;
  // null when no chunk matched (the steady state on most pages).
  embeddingsFindings?: readonly EmbeddingsFinding[] | null;
  // Issue #9 Stage 4G.6a — popup-side surfacing of image_injection probe
  // output. Absent on pre-4G.6a verdicts (rendered as "no data yet");
  // null when no images were analysed (rendered as "no images analysed").
  // Orchestrator wiring lands in 4G.6b — until then this stays absent
  // and the popup renderer falls through to the legacy placeholder.
  imageInjectionFindings?: readonly ImageInjectionFinding[] | null;
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
  // Issue #48 — recognise the `unsupported_language:` prefix so non-English
  // pages render an informational message rather than the engine-failure
  // wording.
  const errorCard = $('error-card');
  const errorMessageEl = $('error-message');
  const isOriginDenied = verdict.analysisError?.startsWith('origin_denied:') ?? false;
  const isUnsupportedLang = verdict.analysisError?.startsWith('unsupported_language:') ?? false;
  if (verdict.analysisError && !isOriginDenied) {
    errorCard.style.display = 'block';
    if (isUnsupportedLang) {
      const lang = verdict.analysisError.slice('unsupported_language: '.length);
      errorMessageEl.textContent = `Not analysed — page is in ${lang}`;
    } else {
      errorMessageEl.textContent = verdict.status === 'UNKNOWN'
        ? `Analysis incomplete: ${verdict.analysisError}`
        : `Partial analysis failure: ${verdict.analysisError}`;
    }
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
    container.replaceChildren();
    for (const flag of verdict.flags) {
      const tag = document.createElement('span');
      tag.className = 'flag-tag';
      tag.textContent = flag;
      container.appendChild(tag);
    }
  }

  const date = new Date(verdict.timestamp);
  $('timestamp-info').textContent = `Last analyzed: ${date.toLocaleString()} | ${verdict.url}`;

  // Issue #114 (N3) — surface mitigationsApplied in its accordion. The
  // field is on SecurityVerdict but was previously not shown. `?? []`
  // handles legacy verdicts written before the popup typed the field.
  const mitigations = verdict.mitigationsApplied ?? [];
  const mitigationsList = $('mitigations-list');
  mitigationsList.textContent = mitigations.length > 0 ? mitigations.join(', ') : 'None';
  mitigationsList.className = mitigations.length > 0 ? '' : 'placeholder';

  renderHunterSummary($('hunter-findings-body'), verdict.hunterSummary);
  renderEntitySummary($('entities-body'), verdict.entitySummary);
  renderEmbeddingsFindings($('embeddings-findings-body'), verdict.embeddingsFindings);
  renderImageInjectionFindings($('image-injection-body'), verdict.imageInjectionFindings);
  renderResponseVerdict($('response-analysis-body'), verdict.responseVerdict);
  renderThinkingVerdict($('thinking-analysis-body'), verdict.thinkingVerdict);

  // Issue #113 (N2) — rescan-with-prevention button is verdict-aware:
  // only enabled when the current verdict is SUSPICIOUS or COMPROMISED.
  // Called here (inside loadVerdict) so the verdict status drives the
  // initial enable/disable state without an extra round-trip.
  initRescanButton(
    $('rescan-with-prevention-btn') as HTMLButtonElement,
    verdict.status,
    showToast,
  );
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

/**
 * Quick-links card at the bottom of the popup. Two shortcuts for now:
 *   - fixture catalog index on the public fixture host (Cloudflare Pages
 *     serving test-pages/ verbatim per docs/testing/phase4/FIXTURE_HOSTING_VERIFIED.md)
 *   - chrome://extensions so the user can toggle / debug HoneyLLM without
 *     hunting through menus. chrome.tabs.create is privileged enough to
 *     navigate to chrome:// URLs, unlike ordinary page-link clicks.
 *
 * The manual-test harness link was intentionally omitted: the harness is
 * internal testing infrastructure and must not be reachable from a public
 * URL. Until the harness is moved out of the deployed test-pages/ tree,
 * the popup cannot expose it as a link.
 */
const FIXTURE_HOST = 'https://fixtures.host-things.online';

function initQuickLinks(): void {
  const bindings: ReadonlyArray<{ readonly id: string; readonly url: string }> = [
    { id: 'ql-fixtures', url: `${FIXTURE_HOST}/` },
    { id: 'ql-extensions', url: 'chrome://extensions/' },
    // Issue #218 — in-extension log viewer. chrome.runtime.getURL
    // resolves to chrome-extension://<id>/dist/log-viewer/log-viewer.html
    // which the SW LogBus's onConnect handler accepts.
    { id: 'ql-logs', url: chrome.runtime.getURL('dist/log-viewer/log-viewer.html') },
  ];
  for (const { id, url } of bindings) {
    const btn = document.getElementById(id);
    if (btn === null) continue;
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url }).catch((err) => {
        console.error(`quick-link failed (${id})`, err);
        showToast('Could not open link');
      });
    });
  }
}

/**
 * Issue #127 (N11) — render the Scan cache accordion. Reads stats
 * directly from the cache module (which itself reads IndexedDB +
 * chrome.storage); the popup runs in extension context so it shares
 * the same origin as the SW and can hit the same DB. Includes a
 * "Clear cache" button that drops every entry and resets telemetry.
 */
async function initCacheAccordion(): Promise<void> {
  const bodyEl = document.getElementById('cache-body');
  if (bodyEl === null) return;
  const body: HTMLElement = bodyEl;

  async function refresh(): Promise<void> {
    try {
      const stats = await getCacheStats();
      const sizeKb = (stats.sizeBytes / 1024).toFixed(1);
      const maxMb = (stats.maxBytes / 1024 / 1024).toFixed(0);
      const ttlH = (stats.ttlMs / 1000 / 60 / 60).toFixed(1);
      const hitRateText =
        stats.hitRate === null
          ? '— (no lookups yet)'
          : `${(stats.hitRate * 100).toFixed(1)}% (${stats.hits} hit / ${stats.misses} miss)`;
      const wrapper = document.createElement('div');
      wrapper.className = 'meta';
      wrapper.style.lineHeight = '1.6';

      const stats1 = document.createElement('div');
      stats1.textContent = `Entries: ${stats.entries}   Size: ${sizeKb} KB / ${maxMb} MB   TTL: ${ttlH}h`;
      wrapper.appendChild(stats1);

      const stats2 = document.createElement('div');
      stats2.textContent = `Hit rate: ${hitRateText}`;
      wrapper.appendChild(stats2);

      const btnRow = document.createElement('div');
      btnRow.style.marginTop = '8px';
      const btn = document.createElement('button');
      btn.textContent = 'Clear cache';
      btn.className = 'quick-link';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Clearing…';
        try {
          await clearCache();
          showToast('Cache cleared');
          await refresh();
        } catch (err) {
          console.error('clearCache failed', err);
          showToast('Could not clear cache');
          btn.disabled = false;
          btn.textContent = 'Clear cache';
        }
      });
      btnRow.appendChild(btn);
      wrapper.appendChild(btnRow);

      body.replaceChildren(wrapper);
    } catch (err) {
      console.error('cache stats render failed', err);
      body.textContent = 'Cache stats unavailable.';
    }
  }

  await refresh();
}

/**
 * SR-G (registry-#51) — render the site-structure registry's hit/miss/
 * stale telemetry. Reads counters lazily on popup open via
 * `getRegistryStats`; no live refresh while the panel is mounted (per
 * SR-G drift carry-forward — telemetry is read-on-open). Includes a
 * "Reset counters" button that zeros the hit/miss/perOrigin maps but
 * preserves bundle metadata so the stale-bundle warning isn't lost.
 */
async function initRegistryAccordion(): Promise<void> {
  const bodyEl = document.getElementById('registry-body');
  if (bodyEl === null) return;
  const body: HTMLElement = bodyEl;

  async function refresh(): Promise<void> {
    try {
      const stats = await getRegistryStats();
      const wrapper = document.createElement('div');
      const statsContainer = document.createElement('div');
      renderRegistryStats(statsContainer, stats);
      wrapper.appendChild(statsContainer);

      const btnRow = document.createElement('div');
      btnRow.style.marginTop = '8px';
      const btn = document.createElement('button');
      btn.textContent = 'Reset counters';
      btn.className = 'quick-link';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Resetting…';
        try {
          await resetRegistryTelemetry();
          showToast('Registry counters reset');
          await refresh();
        } catch (err) {
          console.error('resetRegistryTelemetry failed', err);
          showToast('Could not reset registry counters');
          btn.disabled = false;
          btn.textContent = 'Reset counters';
        }
      });
      btnRow.appendChild(btn);
      wrapper.appendChild(btnRow);

      body.replaceChildren(wrapper);
    } catch (err) {
      console.error('registry stats render failed', err);
      body.textContent = 'Registry stats unavailable.';
    }
  }

  await refresh();
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
    // Issue #113 (N2) — observe-mode toggle. Independent of verdict;
    // initialised early so the user can flip it before / during a scan.
    await initTestingModeToggle(
      $('testing-mode-checkbox') as HTMLInputElement,
      showToast,
    );
  } catch (err) {
    console.error('testing-mode toggle init failed', err);
  }
  try {
    initQuickLinks();
  } catch (err) {
    console.error('quick links init failed', err);
  }
  try {
    // Issue #114 (N3) — header rescan button. Always-available rescan that
    // does not force mitigations; enabled for http/https tabs only. Wired
    // here (verdict-agnostic) rather than inside loadVerdict.
    await initRescanPageButton(
      $('rescan-page-btn') as HTMLButtonElement,
      showToast,
    );
  } catch (err) {
    console.error('rescan-page button init failed', err);
  }
  try {
    await loadVerdict();
  } catch (err) {
    console.error('loadVerdict failed', err);
  }
  try {
    await initCacheAccordion();
  } catch (err) {
    console.error('cache accordion init failed', err);
  }
  try {
    await initRegistryAccordion();
  } catch (err) {
    console.error('registry accordion init failed', err);
  }
  try {
    // Issue #130 (N7b) — pending-intercept panel. Renders only when
    // STORAGE_KEY_PENDING_INTERCEPT is set (a URL scan is in flight or
    // awaiting user action). Inert otherwise. Subscribes to
    // chrome.storage.onChanged for live updates while the popup is open.
    let panelRoot = document.getElementById('pending-intercept-root');
    if (panelRoot === null) {
      panelRoot = document.createElement('div');
      panelRoot.id = 'pending-intercept-root';
      document.body.insertBefore(panelRoot, document.body.firstChild);
    }
    await initPendingInterceptPanel(panelRoot);
  } catch (err) {
    console.error('pending-intercept init failed', err);
  }
  try {
    // Issue #236 — surface a heartbeat-active warning banner so a
    // heartbeat left on across Chrome restarts is never invisible.
    await initHeartbeatBanner();
  } catch (err) {
    console.error('heartbeat banner init failed', err);
  }
})();
