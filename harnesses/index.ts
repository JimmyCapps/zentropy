/*
 * HoneyLLM Test Console — unified hash-routed harness.
 * Routes: s1, s2-baseline, s2-nano, s3-claude, s3-chatgpt, s3-gemini, s4.
 * summarizer/issue-graph are their own pages (nav links out).
 *
 * State lives in localStorage under STORAGE_KEY — every input change persists.
 * Per-cell Nano results also persist so a sweep can resume after a reload.
 */

import {
  FIXTURE_HOST,
  PRIORITY_FIXTURES,
  OTHER_BROWSERS,
  loadState,
  saveState,
  spiderScan,
  classifyChip,
  pendingChip,
  classifyAgentResponse,
  deriveAgentOutcome,
  acquireSweepLock,
  releaseSweepLock,
  isSweepLocked,
  pingExtension,
  currentRoute,
  onRouteChange,
  el,
  type StateBag,
  type Fixture,
  type AgentOutcome,
  type ChipResult,
  type ChipKind,
} from './lib/harness-state.js';

import {
  runSweep,
  PROBE_ORDER,
  INPUT_ORDER,
  INPUTS,
  type Availability,
  type SweepCellResult,
} from './lib/nano-sweep.js';

// ---------- State ----------

let state: StateBag = loadState();
const SECTION_PREFIXES: readonly string[] = ['s3.claude', 's3.chatgpt', 's3.gemini'];

interface SectionRow {
  readonly agentSelect: HTMLSelectElement;
  readonly verdictSelect: HTMLSelectElement;
  readonly fp: string;
}
const SECTION_ROWS: Record<string, SectionRow[]> = {};

interface PreviewRow {
  readonly path: string;
  readonly fixture: Fixture;
  readonly fp: string;
  readonly chip: HTMLSpanElement;
}
const PREVIEW_REGISTRY: PreviewRow[] = [];

// ---------- Router ----------

const ROUTE_IDS: readonly string[] = ['s1', 's2-baseline', 's2-nano', 's3-claude', 's3-chatgpt', 's3-gemini', 's4'];

function renderRoute(id: string): void {
  const active = ROUTE_IDS.includes(id) ? id : 's1';
  for (const section of document.querySelectorAll<HTMLElement>('[data-route-section]')) {
    const match = section.dataset.routeSection === active;
    section.classList.toggle('active', match);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.harness-nav a[data-route]')) {
    link.classList.toggle('active', link.dataset.route === active);
  }
}

// ---------- Status painting ----------

function paintStatus(testId: string, status: string): void {
  const pill = document.querySelector<HTMLElement>(`[data-status-for="${CSS.escape(testId)}"]`);
  if (pill === null) return;
  pill.className = `status-pill status-${status}`;
  pill.textContent = status;
}

function setStatus(testId: string, status: string): void {
  state[`${testId}.status`] = status;
  saveState(state);
  paintStatus(testId, status);
  updateNavProgress();
}

function paintAutoCheck(id: string, tone: 'ok' | 'warn' | 'err' | null, text?: string): void {
  const row = document.querySelector<HTMLElement>(`[data-check="${CSS.escape(id)}"]`);
  if (row === null) return;
  row.className = 'auto-check' + (tone !== null ? ` auto-${tone}` : '');
  const valueEl = row.querySelector<HTMLElement>('.auto-check-value');
  if (valueEl !== null && text !== undefined) valueEl.textContent = text;
}

// ---------- S1.1 host reachability ----------

async function checkFixtureHost(): Promise<void> {
  paintAutoCheck('s1.1.host', null, 'checking…');
  try {
    const res = await fetch(`${FIXTURE_HOST}/clean/simple-article`, { method: 'HEAD', redirect: 'follow' });
    if (res.ok) {
      paintAutoCheck('s1.1.host', 'ok', `✓ HTTP ${res.status}`);
      setStatus('s1.1', 'pass');
      state['s1.1.last_check'] = new Date().toISOString();
      saveState(state);
    } else {
      paintAutoCheck('s1.1.host', 'err', `✗ HTTP ${res.status}`);
      setStatus('s1.1', 'fail');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    paintAutoCheck('s1.1.host', 'err', `✗ ${msg}`);
    setStatus('s1.1', 'fail');
  }
}

// ---------- S1.2 WebGPU + Spider ----------

async function checkWebgpuForS12(): Promise<void> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (gpu === undefined) {
      paintAutoCheck('s1.2.webgpu', 'err', '✗ navigator.gpu absent');
      state['s1.2.webgpu_detected'] = false;
    } else {
      const adapter = await gpu.requestAdapter() as { info?: { vendor: string; architecture: string } } | null;
      if (adapter === null) {
        paintAutoCheck('s1.2.webgpu', 'err', '✗ no adapter');
        state['s1.2.webgpu_detected'] = false;
      } else {
        const info = adapter.info !== undefined
          ? `${adapter.info.vendor} / ${adapter.info.architecture}`
          : 'adapter (info unavailable)';
        paintAutoCheck('s1.2.webgpu', 'ok', `✓ ${info}`);
        state['s1.2.webgpu_detected'] = true;
        state['s1.2.webgpu_info'] = info;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    paintAutoCheck('s1.2.webgpu', 'err', `✗ ${msg}`);
    state['s1.2.webgpu_detected'] = false;
  }
  saveState(state);
  recomputeS12();
}

async function checkSpiderForS12(): Promise<void> {
  try {
    const res = await fetch(`${FIXTURE_HOST}/clean/simple-article`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const scan = spiderScan(body);
    if (scan.matched) {
      paintAutoCheck('s1.2.spider', 'err', `✗ Spider: ${scan.label}`);
      state['s1.2.spider_clean'] = false;
    } else {
      paintAutoCheck('s1.2.spider', 'ok', `✓ clean (${body.length}B)`);
      state['s1.2.spider_clean'] = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    paintAutoCheck('s1.2.spider', 'err', `✗ ${msg}`);
    state['s1.2.spider_clean'] = false;
  }
  saveState(state);
  recomputeS12();
}

function recomputeS12(): void {
  const web = state['s1.2.webgpu_detected'] === true;
  const spider = state['s1.2.spider_clean'] === true;
  const popup = state['s1.2.popup_confirmed'] === true;
  if (web && spider && popup) setStatus('s1.2', 'pass');
  else if (web === false || spider === false) setStatus('s1.2', 'fail');
  else setStatus('s1.2', 'pending');
}

// ---------- S2.1 SW probe ----------

const SW_SNIPPET = `(async () => {
  const langModelTypeof = typeof self.LanguageModel;
  let availability = 'n/a';
  if (langModelTypeof !== 'undefined') {
    try { availability = await self.LanguageModel.availability(); }
    catch (e) { availability = 'error: ' + e.message; }
  }
  let engineMode = 'unknown';
  try {
    const keys = await chrome.storage.local.get(null);
    for (const k of Object.keys(keys)) {
      const v = keys[k];
      if (v && typeof v === 'object' && 'engine' in v) { engineMode = v.engine; break; }
    }
  } catch {}
  const out = { langModelTypeof, availability, engineMode };
  console.log('HONEYLLM_S21 ' + JSON.stringify(out));
  return out;
})();`;

function detectS21Auto(): void {
  const ua = navigator.userAgent;
  const chromeMatch = /Chrome\/([\d.]+)/.exec(ua);
  const chromeVer = chromeMatch !== null ? chromeMatch[1]! : 'not Chrome';
  state['s2.1.chrome_version'] = chromeVer;

  void (async (): Promise<void> => {
    let gpu = 'no WebGPU';
    try {
      const navGpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      if (navGpu !== undefined) {
        const a = await navGpu.requestAdapter() as { info?: { vendor: string; architecture: string } } | null;
        gpu = (a !== null && a.info !== undefined) ? `${a.info.vendor} / ${a.info.architecture}` : 'adapter ok';
      }
    } catch (e) {
      gpu = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    state['s2.1.webgpu_info'] = gpu;
    saveState(state);
    paintAutoCheck('s2.1.auto', 'ok', `Chrome ${chromeVer} · WebGPU: ${gpu}`);
    recomputeS21();
  })();
}

function parseS21SwOutput(): void {
  const raw = (typeof state['s2.1.sw_output'] === 'string' ? state['s2.1.sw_output'] : '').trim();
  if (raw.length === 0) {
    paintAutoCheck('s2.1.parsed', null, 'waiting for paste…');
    state['s2.1.sw_parsed'] = null;
    saveState(state);
    recomputeS21();
    return;
  }
  const jsonMatch = /\{[\s\S]*\}/.exec(raw);
  if (jsonMatch === null) {
    state['s2.1.sw_parsed'] = null;
    paintAutoCheck('s2.1.parsed', 'err', '✗ no JSON object found in paste');
    saveState(state);
    recomputeS21();
    return;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    state['s2.1.sw_parsed'] = parsed;
    const parts: string[] = [];
    if (typeof parsed['langModelTypeof'] === 'string') parts.push(`LM:${parsed['langModelTypeof']}`);
    if (typeof parsed['availability'] === 'string') parts.push(`avail:${parsed['availability']}`);
    if (typeof parsed['engineMode'] === 'string') parts.push(`engine:${parsed['engineMode']}`);
    paintAutoCheck('s2.1.parsed', 'ok', `✓ ${parts.join(' · ')}`);
  } catch (err) {
    state['s2.1.sw_parsed'] = null;
    const msg = err instanceof Error ? err.message : String(err);
    paintAutoCheck('s2.1.parsed', 'err', `✗ JSON parse error: ${msg}`);
  }
  saveState(state);
  recomputeS21();
}

function recomputeS21(): void {
  const webgpuInfo = typeof state['s2.1.webgpu_info'] === 'string' ? state['s2.1.webgpu_info'] : '';
  const webgpu = webgpuInfo.length > 0 && !webgpuInfo.startsWith('no ') && !webgpuInfo.startsWith('error');
  const parsed = state['s2.1.sw_parsed'];
  if (parsed === null || parsed === undefined || typeof parsed !== 'object') { setStatus('s2.1', 'pending'); return; }
  const p = parsed as Record<string, unknown>;
  const nanoOnline = p['availability'] === 'available';
  const engineLoaded = p['engineMode'] === 'mlc' || p['engineMode'] === 'nano';
  const anyPathLive = p['langModelTypeof'] === 'function' && webgpu;
  if (nanoOnline || engineLoaded || anyPathLive) setStatus('s2.1', 'pass');
  else setStatus('s2.1', 'pending');
}

// ---------- Nano sweep wiring ----------

interface CellView {
  readonly tr: HTMLTableRowElement;
  readonly statusCell: HTMLTableCellElement;
  readonly latencyCell: HTMLTableCellElement;
  readonly outputCell: HTMLTableCellElement;
}

const cellViews: CellView[] = [];
let currentResults: SweepCellResult[] = [];
let sweepAborter: { abort: boolean } = { abort: false };

function buildNanoCellTable(): void {
  const tbody = document.getElementById('cells-body');
  if (tbody === null) return;
  tbody.replaceChildren();
  cellViews.length = 0;

  for (const probe of PROBE_ORDER) {
    for (const input of INPUT_ORDER) {
      const category = INPUTS[input]!.category;
      const tr = document.createElement('tr');
      const idx = cellViews.length;

      const make = (txt: string, cls?: string): HTMLTableCellElement => {
        const td = document.createElement('td');
        td.textContent = txt;
        if (cls !== undefined) td.className = cls;
        return td;
      };
      const statusCell = make('pending', 'status status-pending');
      const latencyCell = make('—');
      const outputCell = make('', 'muted');

      tr.append(
        make(String(idx + 1)),
        make(probe),
        make(input),
        make(category),
        statusCell,
        latencyCell,
        outputCell,
      );
      tbody.appendChild(tr);
      cellViews.push({ tr, statusCell, latencyCell, outputCell });
    }
  }
}

function renderCell(index: number, status: 'pending' | 'running' | 'done' | 'error', latencyMs: number | null, output: string): void {
  const view = cellViews[index];
  if (view === undefined) return;
  view.statusCell.textContent = status;
  view.statusCell.className = `status status-${status}`;
  view.latencyCell.textContent = latencyMs !== null ? `${latencyMs.toFixed(0)} ms` : '—';
  const truncated = output.length > 80 ? `${output.slice(0, 77)}…` : output;
  view.outputCell.textContent = truncated;
  view.outputCell.title = output;
}

function setProgress(done: number, total: number): void {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const fill = document.getElementById('progress-fill');
  if (fill !== null) (fill as HTMLElement).style.width = `${pct}%`;
  const text = document.getElementById('progress-text');
  if (text !== null) text.textContent = `${done} / ${total} cells complete`;
}

function setAvailability(avail: Availability | 'api-absent' | 'error'): void {
  const badge = document.getElementById('availability');
  if (badge === null) return;
  if (avail === 'api-absent') {
    badge.textContent = 'API absent';
    badge.className = 'availability avail-unavailable';
  } else if (avail === 'error') {
    badge.textContent = 'error';
    badge.className = 'availability avail-unavailable';
  } else {
    badge.textContent = avail;
    badge.className = `availability avail-${avail}`;
  }
  const chip = document.getElementById('nano-avail');
  if (chip !== null) {
    chip.textContent = `Nano: ${avail}`;
    chip.className = `engine-chip ${avail === 'available' ? 'live' : avail === 'api-absent' || avail === 'unavailable' ? 'absent' : 'busy'}`;
  }
}

function showNanoError(msg: string): void {
  const card = document.getElementById('error-card');
  const body = document.getElementById('error-body');
  if (card !== null) card.style.display = 'block';
  if (body !== null) body.textContent = msg;
}

function getReplicates(): number {
  const input = document.getElementById('replicates') as HTMLInputElement | null;
  if (input === null) return 1;
  const n = Number(input.value);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 1;
}

function updateCellTotal(): void {
  const totalEl = document.getElementById('cell-total');
  if (totalEl === null) return;
  const n = getReplicates();
  const cells = PROBE_ORDER.length * INPUT_ORDER.length;
  totalEl.textContent = n === 1 ? `Total: ${cells} cells` : `Total: ${cells * n} runs (${cells} cells × ${n} replicates)`;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
  if (startBtn !== null) startBtn.textContent = n === 1 ? `Start sweep (${cells} cells)` : `Start sweep (${cells * n} runs)`;
}

async function detectNanoAvailability(): Promise<void> {
  const api = window.LanguageModel;
  if (api === undefined) {
    setAvailability('api-absent');
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
    if (startBtn !== null) startBtn.disabled = true;
    return;
  }
  const TIMEOUT_MS = 10_000;
  try {
    const avail = await Promise.race([
      api.availability(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`availability() timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    setAvailability(avail);
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
    if (startBtn !== null) startBtn.disabled = avail !== 'available';
  } catch (err) {
    setAvailability('error');
    const msg = err instanceof Error ? err.message : String(err);
    showNanoError(`availability() failed: ${msg}`);
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
    if (startBtn !== null) startBtn.disabled = true;
  }
}

async function refreshEngineStrip(): Promise<void> {
  const lockChip = document.getElementById('nano-lock');
  if (lockChip !== null) {
    const locked = isSweepLocked('nano');
    lockChip.textContent = locked ? 'Lock: HELD (other tab?)' : 'Lock: free';
    lockChip.className = `engine-chip ${locked ? 'busy' : 'live'}`;
  }
  const extChip = document.getElementById('nano-ext');
  const navExt = document.getElementById('nav-extension');
  const status = await pingExtension();
  const extText = !status.available
    ? 'Extension: unreachable'
    : status.analysing
      ? `Extension: analysing${status.url !== null ? ' page' : ''}`
      : 'Extension: idle';
  const extCls = !status.available ? 'absent' : status.analysing ? 'busy' : 'live';
  if (extChip !== null) {
    extChip.textContent = extText;
    extChip.className = `engine-chip ${extCls}`;
  }
  if (navExt !== null) {
    navExt.textContent = !status.available ? 'ext: unreach' : status.analysing ? 'ext: busy' : 'ext: idle';
    navExt.className = `nav-pill ${!status.available ? 'err' : status.analysing ? 'warn' : 'ok'}`;
  }
  updateContentionBanner(status.available && status.analysing);
}

function updateContentionBanner(extBusy: boolean): void {
  const banner = document.getElementById('nano-warn');
  const reason = document.getElementById('nano-warn-reason');
  const locked = isSweepLocked('nano');
  const anyContention = locked || extBusy;
  if (banner === null) return;
  banner.style.display = anyContention ? 'block' : 'none';
  if (reason !== null) {
    const reasons: string[] = [];
    if (locked) reasons.push('another sweep is in progress (possibly in a different tab).');
    if (extBusy) reasons.push('the HoneyLLM extension is currently analysing a page.');
    reason.textContent = reasons.join(' ');
  }
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
  if (startBtn !== null && !startBtn.disabled) {
    startBtn.className = anyContention ? 'warn' : '';
  }
}

function downloadResults(): void {
  const replicates = getReplicates();
  const results = replicates > 1 && currentResults.length > 0
    ? currentResults.map((r) => ({ ...r.row, replicate: r.replicate }))
    : currentResults.map((r) => r.row);
  const today = new Date().toISOString().split('T')[0]!;
  const payload = {
    schema_version: replicates > 1 ? '3.1-replicates' : '3.1',
    phase: 3,
    track: replicates > 1 ? 'A-replicates' : 'A',
    methodology: 'manual-chrome-builtin-epp',
    replicates_per_cell: replicates,
    test_date: today,
    tester: 'honeyllm-test-console',
    results,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = replicates > 1 ? `nano-replicates-${today}.json` : `nano-affected-baseline-${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function persistSweepState(): void {
  state['nano.currentResults'] = currentResults.map((r) => ({ ...r, row: r.row }));
  saveState(state);
}

function restoreSweepState(): void {
  const raw = state['nano.currentResults'];
  if (!Array.isArray(raw)) return;
  currentResults = raw as SweepCellResult[];
  for (const r of currentResults) {
    renderCell(r.index, r.row.error_message !== null ? 'error' : 'done', r.row.inference_ms, r.row.output.length > 0 ? r.row.output : (r.row.error_message ?? ''));
  }
  if (currentResults.length > 0) {
    const total = PROBE_ORDER.length * INPUT_ORDER.length * getReplicates();
    setProgress(currentResults.length, total);
    const resumeBtn = document.getElementById('resume-btn');
    if (resumeBtn !== null && currentResults.length < total) {
      resumeBtn.style.display = '';
      resumeBtn.textContent = `Resume from ${currentResults.length + 1}`;
    }
    const dlBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
    if (dlBtn !== null) dlBtn.disabled = false;
  }
}

async function doSweep(resume: boolean): Promise<void> {
  const api = window.LanguageModel;
  if (api === undefined) {
    setAvailability('api-absent');
    showNanoError('window.LanguageModel is absent in this browser.');
    return;
  }
  if (!acquireSweepLock('nano')) {
    showNanoError('Another sweep is already running (possibly in a different tab). Close that tab and click Start again.');
    return;
  }
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement | null;
  if (startBtn !== null) startBtn.disabled = true;
  const progressBar = document.getElementById('progress-bar');
  if (progressBar !== null) progressBar.style.display = 'block';

  const replicates = getReplicates();
  if (!resume) {
    currentResults = [];
    persistSweepState();
  }
  sweepAborter = { abort: false };

  const totalCells = PROBE_ORDER.length * INPUT_ORDER.length;
  const plannedTotal = totalCells * replicates;
  const resumeFrom = resume ? currentResults.length : 0;
  if (resumeFrom >= plannedTotal) {
    releaseSweepLock('nano');
    if (startBtn !== null) startBtn.disabled = false;
    const resumeBtn = document.getElementById('resume-btn');
    if (resumeBtn !== null) resumeBtn.style.display = 'none';
    return;
  }
  const startFromReplicate = Math.floor(resumeFrom / totalCells) + 1;
  const startFromCellIndex = resumeFrom % totalCells;

  try {
    await runSweep(api, {
      replicates,
      startFromReplicate,
      startFromCellIndex,
      onCellStart: (cellIndex) => renderCell(cellIndex, 'running', null, ''),
      onProgress: (p) => {
        const r = p.lastCell;
        currentResults.push(r);
        renderCell(r.index, r.row.error_message !== null ? 'error' : 'done', r.row.inference_ms, r.row.output.length > 0 ? r.row.output : (r.row.error_message ?? ''));
        setProgress(currentResults.length, p.total);
        persistSweepState();
      },
      shouldAbort: () => sweepAborter.abort,
    });
    const dlBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
    if (dlBtn !== null) dlBtn.disabled = false;
    setStatus('s2.2', 'pass');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showNanoError(`Sweep aborted: ${msg}`);
    setStatus('s2.2', 'fail');
  } finally {
    releaseSweepLock('nano');
    void refreshEngineStrip();
  }
}

function resetSweep(): void {
  sweepAborter.abort = true;
  currentResults = [];
  persistSweepState();
  for (let i = 0; i < cellViews.length; i += 1) {
    renderCell(i, 'pending', null, '');
  }
  setProgress(0, PROBE_ORDER.length * INPUT_ORDER.length * getReplicates());
  const resumeBtn = document.getElementById('resume-btn');
  if (resumeBtn !== null) resumeBtn.style.display = 'none';
  const dlBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
  if (dlBtn !== null) dlBtn.disabled = true;
  const errCard = document.getElementById('error-card');
  if (errCard !== null) errCard.style.display = 'none';
  setStatus('s2.2', 'pending');
}

// ---------- S3 agent fixture tables ----------

function buildFixtureTable(tbodyId: string, prefix: string): void {
  const tbody = document.getElementById(tbodyId);
  if (tbody === null) return;
  tbody.replaceChildren();
  SECTION_ROWS[prefix] = [];

  for (const fx of PRIORITY_FIXTURES) {
    const slug = fx.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    const fp = `${prefix}.${slug}`;

    const fixtureCell = el('td');
    fixtureCell.appendChild(el('a', {
      text: fx.path,
      className: 'fixture-link',
      attrs: { href: `${FIXTURE_HOST}${fx.path}`, target: '_blank', rel: 'noopener' },
    }));
    fixtureCell.appendChild(el('div', { className: 'ref', text: `expect ${fx.expected}: ${fx.description}` }));
    const chip = el('span');
    paintChip(chip, pendingChip());
    fixtureCell.appendChild(chip);
    PREVIEW_REGISTRY.push({ path: fx.path, fixture: fx, fp, chip });
    const checkBtn = el('button', { className: 'secondary tiny', text: 'Check' });
    checkBtn.style.marginLeft = '6px';
    checkBtn.addEventListener('click', () => { void previewRow(fp); });
    fixtureCell.appendChild(checkBtn);

    const agentCell = el('td');
    const agentSelect = el('select', { dataset: { field: `${fp}.agent` } });
    for (const [value, label] of [
      ['', '—'],
      ['complied', 'COMPLIED'],
      ['refused', 'refused'],
      ['leaked', 'LEAKED prompt'],
      ['exfil', 'EXFIL URL'],
      ['partial', 'partial comply'],
      ['n_a', "didn't answer"],
    ] as ReadonlyArray<readonly [string, string]>) {
      const opt = el('option', { text: label });
      opt.value = value;
      agentSelect.appendChild(opt);
    }
    agentCell.appendChild(agentSelect);

    const responseBox = el('textarea', {
      className: 'response-box',
      attrs: { placeholder: 'Paste agent response; click Classify' },
      dataset: { field: `${fp}.response` },
    });
    agentCell.appendChild(responseBox);

    const classifierChips = el('div', { className: 'classifier-chips' });
    agentCell.appendChild(classifierChips);

    const btnGroup = el('div', { className: 'tiny-btn-group' });
    const classifyBtn = el('button', { className: 'secondary tiny', text: 'Classify' });
    classifyBtn.addEventListener('click', () => {
      const response = responseBox.value;
      const cls = classifyAgentResponse(response);
      classifierChips.replaceChildren();
      if (cls.complied) classifierChips.appendChild(el('span', { className: 'chip comp', text: 'COMPLIED' }));
      if (cls.leaked_prompt) classifierChips.appendChild(el('span', { className: 'chip leak', text: 'LEAKED' }));
      if (cls.included_url) classifierChips.appendChild(el('span', { className: 'chip exfil', text: 'EXFIL' }));
      if (!cls.complied && !cls.leaked_prompt && !cls.included_url) {
        classifierChips.appendChild(el('span', { className: 'chip clean', text: 'no-flags' }));
      }
      const derived: AgentOutcome = deriveAgentOutcome(response, cls);
      agentSelect.value = derived;
      state[`${fp}.agent`] = derived;
      state[`${fp}.classifier_output`] = JSON.stringify(cls);
      saveState(state);
      recomputeSectionStatus(prefix);
    });
    btnGroup.appendChild(classifyBtn);
    agentCell.appendChild(btnGroup);

    const verdictSelect = el('select', { dataset: { field: `${fp}.honeyllm` } });
    for (const [value, label] of [
      ['', '—'],
      ['CLEAN', 'CLEAN'],
      ['SUSPICIOUS', 'SUSPICIOUS'],
      ['COMPROMISED', 'COMPROMISED'],
      ['UNKNOWN', 'UNKNOWN'],
      ['not_analysed', 'not analysed'],
    ] as ReadonlyArray<readonly [string, string]>) {
      const opt = el('option', { text: label });
      opt.value = value;
      verdictSelect.appendChild(opt);
    }
    const verdictCell = el('td', { className: 'verdict-cell' });
    verdictCell.appendChild(verdictSelect);

    const notesInput = el('input', {
      attrs: { type: 'text', placeholder: 'notes' },
      dataset: { field: `${fp}.notes` },
    });
    const notesCell = el('td');
    notesCell.appendChild(notesInput);

    tbody.appendChild(el('tr', { children: [fixtureCell, agentCell, verdictCell, notesCell] }));
    SECTION_ROWS[prefix]!.push({ agentSelect, verdictSelect, fp });
  }
}

function recomputeSectionStatus(prefix: string): void {
  const rows = SECTION_ROWS[prefix];
  if (rows === undefined) return;
  let complete = 0;
  let partial = 0;
  for (const r of rows) {
    const agent = (state[`${r.fp}.agent`] as string | undefined) ?? r.agentSelect.value;
    const verdict = (state[`${r.fp}.honeyllm`] as string | undefined) ?? r.verdictSelect.value;
    if (agent !== '' && verdict !== '') complete += 1;
    else if (agent !== '' || verdict !== '') partial += 1;
  }
  if (complete === rows.length) setStatus(prefix, 'pass');
  else if (complete > 0 || partial > 0) setStatus(prefix, 'partial');
  else setStatus(prefix, 'pending');
}

async function previewRow(fp: string): Promise<void> {
  const row = PREVIEW_REGISTRY.find((r) => r.fp === fp);
  if (row === undefined) return;
  paintChip(row.chip, { kind: 'pending', text: 'checking…', title: 'Fetching fixture to run Spider scan.' });
  try {
    const res = await fetch(`${FIXTURE_HOST}${row.path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const scan = spiderScan(body);
    const result: ChipResult = classifyChip(row.fixture, true, body.length, scan, res.status);
    paintChip(row.chip, result);
    cacheChipForSiblings(row.path, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const result: ChipResult = classifyChip(row.fixture, false, 0, { matched: false }, null, msg);
    paintChip(row.chip, result);
    cacheChipForSiblings(row.path, result);
  }
}

function paintChip(chip: HTMLSpanElement, result: ChipResult): void {
  chip.className = `spider-chip ${result.kind}`;
  chip.textContent = result.text;
  chip.title = result.title;
}

function cacheChipForSiblings(path: string, result: ChipResult): void {
  for (const row of PREVIEW_REGISTRY) {
    if (row.path !== path) continue;
    paintChip(row.chip, result);
    state[`${row.fp}.chip`] = { kind: result.kind, text: result.text, title: result.title };
  }
  saveState(state);
}

async function checkAllFixtures(): Promise<void> {
  const seen = new Set<string>();
  const unique: PreviewRow[] = [];
  for (const row of PREVIEW_REGISTRY) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    unique.push(row);
  }
  for (const row of unique) {
    await previewRow(row.fp);
  }
}

// ---------- S4 browser cards ----------

function buildBrowserCards(): void {
  const host = document.getElementById('s4-browsers');
  if (host === null) return;
  host.replaceChildren();
  OTHER_BROWSERS.forEach((name, idx) => {
    const id = `s4.${idx + 1}`;
    const card = el('div', { className: 'card', dataset: { testId: id } });
    const header = el('h3');
    header.appendChild(document.createTextNode(`${id} ${name} `));
    header.appendChild(el('span', {
      className: 'status-pill status-pending',
      text: 'pending',
      dataset: { statusFor: id },
    }));
    card.appendChild(header);
    card.appendChild(el('div', {
      className: 'hint',
      text: `Load the HoneyLLM dist/ unpacked. SW console: typeof self.LanguageModel + availability(). Visit fixtures.host-things.online/clean/simple-article.`,
    }));

    const input3 = (labelText: string, field: string, placeholder?: string): HTMLDivElement => {
      const box = el('div');
      box.appendChild(el('label', { text: labelText }));
      const attrs: Record<string, string> = { type: 'text' };
      if (placeholder !== undefined) attrs['placeholder'] = placeholder;
      const inp = el('input', {
        attrs,
        dataset: { field: `${id}.${field}` },
      });
      box.appendChild(inp);
      return box;
    };

    const row1 = el('div', { className: 'row-3' });
    row1.appendChild(input3(`${name} version`, 'version'));
    row1.appendChild(input3('typeof LanguageModel', 'lm_typeof', 'object | undefined'));
    row1.appendChild(input3('availability()', 'lm_avail', 'available | unavailable | n/a'));
    card.appendChild(row1);

    const row2 = el('div', { className: 'row-3' });
    row2.appendChild(input3('WebGPU adapter', 'webgpu', 'gpu info or none'));

    const mlcBox = el('div');
    mlcBox.appendChild(el('label', { text: 'MLC Gemma smoke' }));
    const mlcSel = el('select', { dataset: { field: `${id}.mlc_smoke` } });
    for (const [v, l] of [['', '—'], ['yes', 'Yes'], ['no', 'No'], ['unclear', 'Unclear']] as ReadonlyArray<readonly [string, string]>) {
      const o = el('option', { text: l });
      o.value = v;
      mlcSel.appendChild(o);
    }
    mlcBox.appendChild(mlcSel);
    row2.appendChild(mlcBox);

    const nanoBox = el('div');
    nanoBox.appendChild(el('label', { text: 'Nano smoke' }));
    const nanoSel = el('select', { dataset: { field: `${id}.nano_smoke` } });
    for (const [v, l] of [['', '—'], ['yes', 'Yes'], ['no', 'No'], ['skip', 'Skipped (API absent)']] as ReadonlyArray<readonly [string, string]>) {
      const o = el('option', { text: l });
      o.value = v;
      nanoSel.appendChild(o);
    }
    nanoBox.appendChild(nanoSel);
    row2.appendChild(nanoBox);
    card.appendChild(row2);

    card.appendChild(el('label', { text: 'Optional notes' }));
    card.appendChild(el('textarea', { dataset: { field: `${id}.notes` } }));

    const skip = el('button', {
      className: 'skip tiny',
      text: 'SKIP',
      dataset: { action: 'status', id, status: 'skip' },
    });
    card.appendChild(el('div', { className: 'override-row', children: [skip] }));

    host.appendChild(card);
  });
}

function recomputeS4(id: string): void {
  const required = [`${id}.version`, `${id}.lm_typeof`, `${id}.lm_avail`];
  const filled = required.every((k) => {
    const v = state[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (!filled) { setStatus(id, 'pending'); return; }
  const mlc = state[`${id}.mlc_smoke`];
  const nano = state[`${id}.nano_smoke`];
  if (mlc === 'yes' || nano === 'yes') setStatus(id, 'pass');
  else if (mlc === 'no' && (nano === 'no' || nano === 'skip')) setStatus(id, 'fail');
  else setStatus(id, 'partial');
}

// ---------- Field wiring ----------

function restoreFields(): void {
  for (const elm of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-field]')) {
    const key = elm.dataset['field'];
    if (key === undefined) continue;
    const v = state[key];
    if (v === undefined) continue;
    if (elm instanceof HTMLInputElement && elm.type === 'checkbox') {
      elm.checked = v === true || v === 'true';
    } else {
      elm.value = typeof v === 'string' ? v : String(v ?? '');
    }
  }
  for (const pill of document.querySelectorAll<HTMLElement>('[data-status-for]')) {
    const id = pill.dataset['statusFor'];
    if (id === undefined) continue;
    const status = state[`${id}.status`];
    if (typeof status === 'string') paintStatus(id, status);
  }
  for (const row of PREVIEW_REGISTRY) {
    const cached = state[`${row.fp}.chip`];
    if (cached !== null && typeof cached === 'object' && 'kind' in cached && 'text' in cached) {
      const c = cached as { kind: ChipKind; text: string; title?: string };
      paintChip(row.chip, { kind: c.kind, text: c.text, title: c.title ?? '' });
    }
  }
}

function handleFieldChange(key: string, newValue: unknown): void {
  state[key] = newValue;
  saveState(state);
  if (key === 's2.1.sw_output') parseS21SwOutput();
  if (key === 's1.2.popup_confirmed') recomputeS12();
  for (const prefix of SECTION_PREFIXES) {
    if (key.startsWith(`${prefix}.`)) recomputeSectionStatus(prefix);
  }
  const s4Match = /^(s4\.\d+)\./.exec(key);
  if (s4Match !== null) recomputeS4(s4Match[1]!);
  updateCellTotal();
}

// ---------- Export / Clear ----------

function exportJson(): void {
  const payload = {
    schema_version: '2.0',
    harness: 'honeyllm-test-console',
    exported_at: new Date().toISOString(),
    fixture_host: FIXTURE_HOST,
    results: state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manual-test-results-${new Date().toISOString().split('T')[0]!}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function clearAll(): void {
  if (!confirm('Clear all recorded results? (Cannot be undone.)')) return;
  state = {};
  saveState(state);
  releaseSweepLock('nano');
  releaseSweepLock('summarizer');
  location.reload();
}

// ---------- Nav progress ----------

function updateNavProgress(): void {
  const pill = document.getElementById('nav-progress');
  if (pill === null) return;
  const tests = ['s1.1', 's1.2', 's2.1', 's2.2', 's3.claude', 's3.chatgpt', 's3.gemini'];
  const passed = tests.filter((t) => state[`${t}.status`] === 'pass').length;
  pill.textContent = `${passed}/${tests.length}`;
  pill.className = passed === tests.length ? 'nav-pill ok' : passed > 0 ? 'nav-pill warn' : 'nav-pill idle';
}

// ---------- Wire up ----------

function wireCopyableCode(): void {
  for (const codeEl of document.querySelectorAll<HTMLElement>('code.copyable')) {
    codeEl.addEventListener('click', async () => {
      const text = codeEl.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        const orig = codeEl.textContent;
        codeEl.textContent = '✓ copied';
        setTimeout(() => { codeEl.textContent = orig; }, 1200);
      } catch {
        /* selection fallback — user-select:all lets cmd+C complete the action */
      }
    });
  }
}

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  const flash = (): void => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };
  try {
    await navigator.clipboard.writeText(text);
    flash();
  } catch {
    alert('Clipboard unavailable. Select + copy manually:\n\n' + text);
  }
}

function bootstrap(): void {
  renderRoute(currentRoute('s1'));
  onRouteChange(renderRoute);

  buildNanoCellTable();
  buildFixtureTable('s3.claude-rows', 's3.claude');
  buildFixtureTable('s3.chatgpt-rows', 's3.chatgpt');
  buildFixtureTable('s3.gemini-rows', 's3.gemini');
  buildBrowserCards();

  restoreFields();
  restoreSweepState();
  updateCellTotal();
  updateNavProgress();

  document.getElementById('s1.1-recheck')?.addEventListener('click', () => { void checkFixtureHost(); });

  const snippetEl = document.getElementById('s2.1-snippet');
  if (snippetEl !== null) snippetEl.textContent = SW_SNIPPET;
  const copyBtn = document.getElementById('s2.1-copy-snippet') as HTMLButtonElement | null;
  if (copyBtn !== null) copyBtn.addEventListener('click', () => { void copyText(SW_SNIPPET, copyBtn); });

  document.getElementById('start-btn')?.addEventListener('click', () => { void doSweep(false); });
  document.getElementById('download-btn')?.addEventListener('click', downloadResults);
  document.getElementById('reset-btn')?.addEventListener('click', resetSweep);
  document.getElementById('resume-btn')?.addEventListener('click', () => { void doSweep(true); });

  document.getElementById('export-btn')?.addEventListener('click', exportJson);
  document.getElementById('clear-btn')?.addEventListener('click', clearAll);
  document.getElementById('check-all-btn')?.addEventListener('click', () => { void checkAllFixtures(); });

  document.addEventListener('input', (ev) => {
    const target = ev.target as HTMLElement & { dataset?: { field?: string }; type?: string; value?: string; checked?: boolean };
    const key = target.dataset?.field;
    if (key === undefined) return;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    handleFieldChange(key, value);
  });
  document.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement & { dataset?: { field?: string }; type?: string; value?: string; checked?: boolean };
    const key = target.dataset?.field;
    if (key === undefined) return;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    handleFieldChange(key, value);
  });
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t === null) return;
    const btn = t.closest<HTMLElement>('[data-action="status"]');
    if (btn !== null && btn.dataset['id'] !== undefined && btn.dataset['status'] !== undefined) {
      setStatus(btn.dataset['id'], btn.dataset['status']);
    }
  });

  wireCopyableCode();

  void checkFixtureHost();
  void checkWebgpuForS12();
  void checkSpiderForS12();
  detectS21Auto();
  parseS21SwOutput();
  recomputeS12();
  recomputeS21();
  for (const prefix of SECTION_PREFIXES) recomputeSectionStatus(prefix);
  for (let i = 1; i <= 5; i += 1) recomputeS4(`s4.${i}`);

  void detectNanoAvailability();
  void refreshEngineStrip();
  setInterval(() => { void refreshEngineStrip(); }, 8000);
}

bootstrap();
