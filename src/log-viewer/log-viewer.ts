import { LOG_PORT_NAME, type LogPortMessage } from '@/shared/log-bus.js';
import type { LogEntry, LogLevel, LogSource } from '@/shared/logger.js';
import {
  ensurePermission,
  flush as flushWriter,
  getSavedHandle,
  pickDirectory,
  startSession,
  stopSession,
  writeEntry,
  stats as writerStats,
} from './file-writer.js';

const FLUSH_INTERVAL_MS = 2000;

interface FilterState {
  readonly levels: ReadonlySet<LogLevel>;
  readonly sources: ReadonlySet<LogSource>;
  readonly query: string;
}

const state = {
  buffer: [] as LogEntry[],
  filter: {
    levels: new Set<LogLevel>(['info', 'warn', 'error']),
    sources: new Set<LogSource>(['sw', 'offscreen', 'content', 'popup']),
    query: '',
  } as FilterState,
  autoScroll: true,
  paused: false,
  mode: 'live' as 'live' | 'imported',
  port: null as chrome.runtime.Port | null,
  pendingRender: false,
};

const els = {
  container: document.getElementById('log-container')!,
  empty: document.getElementById('empty-state')!,
  status: document.getElementById('connection-status')!,
  statCount: document.getElementById('stat-count')!,
  statShown: document.getElementById('stat-shown')!,
  statSource: document.getElementById('stat-source')!,
  statDisk: document.getElementById('stat-disk')!,
  scrollLock: document.getElementById('scroll-lock')!,
  search: document.getElementById('search-box') as HTMLInputElement,
  btnPause: document.getElementById('btn-pause') as HTMLButtonElement,
  btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
  btnCopy: document.getElementById('btn-copy') as HTMLButtonElement,
  btnExport: document.getElementById('btn-export') as HTMLButtonElement,
  btnLive: document.getElementById('btn-live') as HTMLButtonElement,
  btnSave: document.getElementById('btn-save') as HTMLButtonElement,
  importFile: document.getElementById('import-file') as HTMLInputElement,
  levelFilters: document.getElementById('level-filters')!,
  sourceFilters: document.getElementById('source-filters')!,
  heartbeatGlobal: document.getElementById('heartbeat-global') as HTMLInputElement,
  heartbeatPerTab: document.getElementById('heartbeat-per-tab') as HTMLDetailsElement,
  heartbeatPerTabList: document.getElementById('heartbeat-per-tab-list')!,
};

// Issue #236 — heartbeat toggle UI. Master checkbox controls global
// default; per-tab section lists currently-tracked tabs and lets the
// user override the global. Storage shape:
//   chrome.storage.local['honeyllm:logging-state'] = {
//     connected: bool,
//     heartbeat: { global: bool, perTab: { [tabId]: bool } }
//   }
// Writing here triggers SW broadcast (PR1) which reaches every content
// script as SET_LOGGING_STATE.
const STORAGE_KEY_LOGGING_STATE = 'honeyllm:logging-state';

interface LoggingState {
  connected: boolean;
  heartbeat: { global: boolean; perTab: Record<number, boolean> };
}

interface KnownTab {
  readonly tabId: number;
  readonly url: string;
  readonly slug: string;
}

const loggingState = {
  current: null as LoggingState | null,
  knownTabs: new Map<number, KnownTab>(),
};

async function readLoggingState(): Promise<LoggingState> {
  const res = await chrome.storage.local.get(STORAGE_KEY_LOGGING_STATE);
  const stored = res[STORAGE_KEY_LOGGING_STATE] as Partial<LoggingState> | undefined;
  return {
    connected: stored?.connected ?? false,
    heartbeat: {
      global: stored?.heartbeat?.global ?? false,
      perTab: stored?.heartbeat?.perTab ?? {},
    },
  };
}

async function writeLoggingState(next: LoggingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_LOGGING_STATE]: next });
}

async function setConnected(connected: boolean): Promise<void> {
  const current = loggingState.current ?? (await readLoggingState());
  const next: LoggingState = { ...current, connected };
  loggingState.current = next;
  await writeLoggingState(next);
}

async function setHeartbeatGlobal(on: boolean): Promise<void> {
  const current = loggingState.current ?? (await readLoggingState());
  const next: LoggingState = {
    connected: current.connected,
    heartbeat: { global: on, perTab: current.heartbeat.perTab },
  };
  loggingState.current = next;
  await writeLoggingState(next);
}

async function setHeartbeatPerTab(tabId: number, on: boolean | null): Promise<void> {
  const current = loggingState.current ?? (await readLoggingState());
  const nextPerTab: Record<number, boolean> = { ...current.heartbeat.perTab };
  if (on === null) {
    delete nextPerTab[tabId];
  } else {
    nextPerTab[tabId] = on;
  }
  const next: LoggingState = {
    connected: current.connected,
    heartbeat: { global: current.heartbeat.global, perTab: nextPerTab },
  };
  loggingState.current = next;
  await writeLoggingState(next);
}

function renderHeartbeatToggles(state: LoggingState, tabs: readonly KnownTab[]): void {
  els.heartbeatGlobal.checked = state.heartbeat.global;
  if (tabs.length === 0) {
    els.heartbeatPerTab.style.display = 'none';
    return;
  }
  els.heartbeatPerTab.style.display = '';
  clearChildren(els.heartbeatPerTabList);
  for (const tab of tabs) {
    const li = document.createElement('li');
    li.style.padding = '2px 0';
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.gap = '6px';
    label.style.alignItems = 'center';
    label.style.cursor = 'pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const override = state.heartbeat.perTab[tab.tabId];
    if (override === undefined) {
      cb.indeterminate = true;
      cb.checked = state.heartbeat.global;
    } else {
      cb.checked = override;
    }
    cb.addEventListener('change', () => {
      void setHeartbeatPerTab(tab.tabId, cb.checked);
    });
    cb.addEventListener('dblclick', () => {
      // Double-click clears the override (back to inheriting global).
      void setHeartbeatPerTab(tab.tabId, null);
    });
    label.appendChild(cb);
    const text = document.createElement('span');
    text.textContent = `${tab.slug} (#${tab.tabId})`;
    text.style.fontFamily = "'SF Mono', Menlo, Monaco, Consolas, monospace";
    text.style.fontSize = '11px';
    label.appendChild(text);
    li.appendChild(label);
    els.heartbeatPerTabList.appendChild(li);
  }
}

async function refreshKnownTabs(): Promise<void> {
  // Enumerate live tabs so the per-tab toggle list reflects what the SW
  // would broadcast to. Filters to http(s) — chrome:// pages have no
  // content script and can't be heartbeated.
  try {
    const tabs = await chrome.tabs.query({});
    loggingState.knownTabs.clear();
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      if (tab.url === undefined || !/^https?:\/\//.test(tab.url)) continue;
      loggingState.knownTabs.set(tab.id, {
        tabId: tab.id,
        url: tab.url,
        slug: tab.url.replace(/^https?:\/\//, '').slice(0, 50),
      });
    }
    if (loggingState.current !== null) {
      renderHeartbeatToggles(loggingState.current, [...loggingState.knownTabs.values()]);
    }
  } catch {
    // tabs permission missing or chrome shutting down — leave list as-is.
  }
}

async function initHeartbeatControls(): Promise<void> {
  loggingState.current = await readLoggingState();

  // Mark connected on viewer open.
  await setConnected(true);

  // Master checkbox.
  els.heartbeatGlobal.addEventListener('change', () => {
    void setHeartbeatGlobal(els.heartbeatGlobal.checked);
  });

  // Listen for external state changes (popup banner click, another viewer).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY_LOGGING_STATE] === undefined) return;
    const newValue = changes[STORAGE_KEY_LOGGING_STATE].newValue as Partial<LoggingState> | undefined;
    if (newValue === undefined) return;
    loggingState.current = {
      connected: newValue.connected ?? false,
      heartbeat: {
        global: newValue.heartbeat?.global ?? false,
        perTab: newValue.heartbeat?.perTab ?? {},
      },
    };
    renderHeartbeatToggles(loggingState.current, [...loggingState.knownTabs.values()]);
  });

  // Keep the per-tab list fresh as tabs come and go.
  chrome.tabs.onCreated.addListener(() => void refreshKnownTabs());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'complete' || info.url !== undefined) void refreshKnownTabs();
  });
  chrome.tabs.onRemoved.addListener(() => void refreshKnownTabs());

  await refreshKnownTabs();
  renderHeartbeatToggles(loggingState.current, [...loggingState.knownTabs.values()]);
}

const writerState = {
  active: false,
  pendingWrites: Promise.resolve(),
  flushTimer: null as ReturnType<typeof setInterval> | null,
};

function updateDiskStat(): void {
  const s = writerStats();
  if (!s.active) {
    els.statDisk.textContent = 'disk: off';
    return;
  }
  const kb = (s.bytesWritten / 1024).toFixed(1);
  els.statDisk.textContent = `disk: ${s.sessionId} (${kb} KB, ${s.pageCount} pages)`;
}

function maybePersistEntry(entry: LogEntry): void {
  if (!writerState.active) return;
  // Serialise writes through a single tail-promise so concurrent
  // appendEntry callbacks don't interleave at the FS level.
  writerState.pendingWrites = writerState.pendingWrites
    .then(() => writeEntry(entry))
    .then(() => updateDiskStat())
    .catch((err) => {
      console.error('[log-viewer] write failed', err);
    });
}

function setStatus(text: string, cls: 'live' | 'disconnected' | 'imported' | ''): void {
  els.status.textContent = text;
  els.status.className = `status${cls === '' ? '' : ' ' + cls}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const fff = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${fff}`;
}

function renderArgsText(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  try {
    return ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  } catch {
    return ' [unrenderable args]';
  }
}

function entryMatches(entry: LogEntry, f: FilterState): boolean {
  if (!f.levels.has(entry.level)) return false;
  if (!f.sources.has(entry.source)) return false;
  if (f.query.length > 0) {
    const q = f.query.toLowerCase();
    if (
      !entry.message.toLowerCase().includes(q) &&
      !entry.context.toLowerCase().includes(q) &&
      !JSON.stringify(entry.args).toLowerCase().includes(q)
    ) {
      return false;
    }
  }
  return true;
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function entryToElement(entry: LogEntry): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `entry ${entry.level}`;
  div.dataset.seq = String(entry.seq);

  const meta = `${formatTime(entry.timestampMs)} +${entry.elapsedMs.toFixed(1)}ms #${entry.seq}`;
  div.appendChild(span('meta', meta));
  div.appendChild(document.createTextNode(' '));
  div.appendChild(span(`src ${entry.source}`, `[${entry.source}]`));
  div.appendChild(span('ctx', `[${entry.context}]`));
  div.appendChild(document.createTextNode(` ${entry.level.toUpperCase()}: ${entry.message}`));
  if (entry.args.length > 0) {
    div.appendChild(span('args', renderArgsText(entry.args)));
  }
  return div;
}

function scheduleRender(): void {
  if (state.pendingRender) return;
  state.pendingRender = true;
  requestAnimationFrame(() => {
    state.pendingRender = false;
    renderAll();
  });
}

function clearChildren(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

function renderAll(): void {
  const filtered = state.buffer.filter((e) => entryMatches(e, state.filter));
  clearChildren(els.container);
  if (filtered.length === 0) {
    els.empty.textContent =
      state.buffer.length === 0
        ? 'Waiting for log entries…'
        : 'No entries match current filters.';
    els.container.appendChild(els.empty);
  } else {
    const frag = document.createDocumentFragment();
    for (const entry of filtered) frag.appendChild(entryToElement(entry));
    els.container.appendChild(frag);
  }
  els.statCount.textContent = `${state.buffer.length} entries`;
  els.statShown.textContent = `${filtered.length} visible`;
  if (state.autoScroll && !state.paused) {
    els.container.scrollTop = els.container.scrollHeight;
  }
}

function appendEntry(entry: LogEntry): void {
  state.buffer.push(entry);
  if (!entryMatches(entry, state.filter)) {
    els.statCount.textContent = `${state.buffer.length} entries`;
    return;
  }
  if (els.empty.parentElement === els.container) {
    scheduleRender();
    return;
  }
  els.container.appendChild(entryToElement(entry));
  els.statCount.textContent = `${state.buffer.length} entries`;
  const shown = parseInt(els.statShown.textContent ?? '0', 10);
  els.statShown.textContent = `${shown + 1} visible`;
  if (state.autoScroll && !state.paused) {
    els.container.scrollTop = els.container.scrollHeight;
  }
}

function connectPort(): void {
  try {
    state.port = chrome.runtime.connect({ name: LOG_PORT_NAME });
  } catch (err) {
    setStatus('disconnected', 'disconnected');
    console.error('Failed to connect to log bus', err);
    return;
  }
  setStatus('live', 'live');
  state.mode = 'live';
  els.statSource.textContent = 'live';
  els.btnLive.disabled = true;

  state.port.onMessage.addListener((msg: LogPortMessage) => {
    if (state.mode !== 'live') return;
    if (msg.type === 'INIT') {
      state.buffer = [...msg.entries];
      // Replay INIT entries into the disk session so the on-disk view
      // matches the on-screen view from connect time forward.
      if (writerState.active) {
        for (const entry of msg.entries) maybePersistEntry(entry);
      }
      scheduleRender();
    } else if (msg.type === 'APPEND') {
      appendEntry(msg.entry);
      maybePersistEntry(msg.entry);
    }
  });

  state.port.onDisconnect.addListener(() => {
    setStatus('disconnected — retrying…', 'disconnected');
    state.port = null;
    setTimeout(connectPort, 1500);
  });
}

function setMode(mode: 'live' | 'imported'): void {
  state.mode = mode;
  if (mode === 'imported') {
    setStatus('imported', 'imported');
    els.statSource.textContent = 'imported file';
    els.btnLive.disabled = false;
    if (state.port !== null) {
      state.port.disconnect();
      state.port = null;
    }
  } else {
    connectPort();
  }
}

function setupFilters(): void {
  els.levelFilters.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.tagName !== 'INPUT') return;
    const level = target.dataset.level as LogLevel;
    const next = new Set(state.filter.levels);
    if (target.checked) next.add(level);
    else next.delete(level);
    state.filter = { ...state.filter, levels: next };
    target.parentElement?.classList.toggle('active', target.checked);
    scheduleRender();
  });

  els.sourceFilters.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.tagName !== 'INPUT') return;
    const source = target.dataset.source as LogSource;
    const next = new Set(state.filter.sources);
    if (target.checked) next.add(source);
    else next.delete(source);
    state.filter = { ...state.filter, sources: next };
    target.parentElement?.classList.toggle('active', target.checked);
    scheduleRender();
  });

  els.search.addEventListener('input', () => {
    state.filter = { ...state.filter, query: els.search.value.trim() };
    scheduleRender();
  });
}

function setupAutoScroll(): void {
  els.container.addEventListener('scroll', () => {
    const atBottom =
      els.container.scrollTop + els.container.clientHeight >= els.container.scrollHeight - 4;
    state.autoScroll = atBottom;
    els.scrollLock.textContent = `auto-scroll: ${atBottom ? 'on' : 'off (locked)'}`;
    els.scrollLock.classList.toggle('locked', !atBottom);
  });
}

function flashButton(btn: HTMLButtonElement, label: string): void {
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

function setupButtons(): void {
  els.btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    els.btnPause.textContent = state.paused ? 'Resume' : 'Pause';
  });

  els.btnClear.addEventListener('click', () => {
    state.buffer = [];
    scheduleRender();
  });

  els.btnCopy.addEventListener('click', async () => {
    const filtered = state.buffer.filter((e) => entryMatches(e, state.filter));
    const text = filtered
      .map(
        (e) =>
          `${formatTime(e.timestampMs)} +${e.elapsedMs.toFixed(1)}ms #${e.seq} [${e.source}][${e.context}] ${e.level.toUpperCase()}: ${e.message}${renderArgsText(e.args)}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flashButton(els.btnCopy, 'Copied');
    } catch (err) {
      console.error('Clipboard write failed', err);
      flashButton(els.btnCopy, 'Failed');
    }
  });

  els.btnExport.addEventListener('click', () => {
    const filtered = state.buffer.filter((e) => entryMatches(e, state.filter));
    const payload = {
      schema: 'honeyllm-logs/v1',
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      entries: filtered,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `honeyllm-logs-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0];
    if (file === undefined) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        schema?: string;
        entries?: unknown;
      };
      if (data.schema !== 'honeyllm-logs/v1' || !Array.isArray(data.entries)) {
        throw new Error('Unrecognised file format');
      }
      state.buffer = data.entries as LogEntry[];
      setMode('imported');
      scheduleRender();
    } catch (err) {
      console.error('Import failed', err);
      alert(`Could not load file: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      els.importFile.value = '';
    }
  });

  els.btnLive.addEventListener('click', () => {
    state.buffer = [];
    setMode('live');
    scheduleRender();
  });

  els.btnSave.addEventListener('click', () => {
    if (writerState.active) {
      void deactivateWriter();
    } else {
      void activateWriter();
    }
  });
}

async function activateWriter(): Promise<void> {
  els.btnSave.disabled = true;
  els.btnSave.textContent = 'Starting…';
  try {
    let handle = await getSavedHandle();
    if (handle !== null) {
      const status = await ensurePermission(handle);
      if (status !== 'granted') handle = null;
    }
    if (handle === null) {
      const picked = await pickDirectory();
      handle = picked.handle;
    }
    const { sessionPath } = await startSession(handle);
    writerState.active = true;
    els.btnSave.textContent = 'Stop saving';
    els.statDisk.textContent = `disk: ${sessionPath}`;
    // Backfill: write everything currently in the buffer so the disk
    // record opens with the same context the user is looking at.
    for (const entry of state.buffer) maybePersistEntry(entry);
    // Issue #225 — periodic flush so the .jsonl files become tail-readable
    // with bounded latency. Serialised through pendingWrites so flushes
    // never race in-flight writes.
    writerState.flushTimer = setInterval(() => {
      if (!writerState.active) return;
      writerState.pendingWrites = writerState.pendingWrites
        .then(() => flushWriter())
        .then(() => updateDiskStat())
        .catch((err) => {
          console.error('[log-viewer] periodic flush failed', err);
        });
    }, FLUSH_INTERVAL_MS);
  } catch (err) {
    console.error('[log-viewer] activate writer failed', err);
    const msg = err instanceof Error ? err.message : 'unknown error';
    alert(`Could not start saving to disk: ${msg}`);
    writerState.active = false;
    els.btnSave.textContent = 'Save to disk';
    els.statDisk.textContent = 'disk: off';
  } finally {
    els.btnSave.disabled = false;
  }
}

async function deactivateWriter(): Promise<void> {
  els.btnSave.disabled = true;
  els.btnSave.textContent = 'Stopping…';
  writerState.active = false;
  if (writerState.flushTimer !== null) {
    clearInterval(writerState.flushTimer);
    writerState.flushTimer = null;
  }
  try {
    await writerState.pendingWrites;
    await stopSession();
  } catch (err) {
    console.error('[log-viewer] deactivate writer failed', err);
  } finally {
    els.btnSave.textContent = 'Save to disk';
    els.statDisk.textContent = 'disk: off';
    els.btnSave.disabled = false;
  }
}

window.addEventListener('beforeunload', () => {
  if (writerState.active) {
    // Best effort; FS Access streams may not flush within the tear-down
    // window, but stopSession at least closes the writable handles.
    void stopSession();
  }
  // Issue #236 — flip viewer-connected so content scripts stop shipping
  // logs as soon as the viewer closes. SW Port disconnect also fires the
  // same flip; this is belt-and-braces for clean teardown.
  void setConnected(false);
});

function init(): void {
  setupFilters();
  setupAutoScroll();
  setupButtons();
  connectPort();
  void initHeartbeatControls();
}

init();
