import { LOG_PORT_NAME, type LogPortMessage } from '@/shared/log-bus.js';
import type { LogEntry, LogLevel, LogSource } from '@/shared/logger.js';

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
  scrollLock: document.getElementById('scroll-lock')!,
  search: document.getElementById('search-box') as HTMLInputElement,
  btnPause: document.getElementById('btn-pause') as HTMLButtonElement,
  btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
  btnCopy: document.getElementById('btn-copy') as HTMLButtonElement,
  btnExport: document.getElementById('btn-export') as HTMLButtonElement,
  btnLive: document.getElementById('btn-live') as HTMLButtonElement,
  importFile: document.getElementById('import-file') as HTMLInputElement,
  levelFilters: document.getElementById('level-filters')!,
  sourceFilters: document.getElementById('source-filters')!,
};

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
      scheduleRender();
    } else if (msg.type === 'APPEND') {
      appendEntry(msg.entry);
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
}

function init(): void {
  setupFilters();
  setupAutoScroll();
  setupButtons();
  connectPort();
}

init();
