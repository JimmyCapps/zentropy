/**
 * Phase 3 Track A — "Affected" Baseline Runner
 *
 * Drives a real Chrome instance with the HoneyLLM unpacked extension loaded
 * and routes each (model, probe, input) cell through one of two test-only
 * extension handlers:
 *
 *   Path 1 (6 MLC models)      — RUN_PROBE_DIRECT  → offscreen WebGPU
 *   Path 2 (chrome-builtin-*)  — RUN_PROBE_BUILTIN → window-context harness
 *
 * Output: docs/testing/inbrowser-results-affected.json (21-field rows per
 * cell). Phase 2's docs/testing/inbrowser-results.json is read-only here;
 * we compute runtime_delta_ms_vs_native_phase2 and behavioral_delta_flags
 * against it.
 *
 *   Usage:
 *     npx tsx scripts/run-affected-baseline.ts                      # full sweep
 *     npx tsx scripts/run-affected-baseline.ts --only <modelId>     # one model
 *     npx tsx scripts/run-affected-baseline.ts --only <id> --smoke  # one cell
 *     npx tsx scripts/run-affected-baseline.ts --dry-run            # stop after 1st cell
 *
 * Option C profile: launches persistent Chromium at ~/HoneyLLM-ChromeTestProfile
 * so Gemini Nano weights (~3–4 GiB) download once and persist across runs.
 * User's main Chrome profile is never touched. First Path 2 run requires the
 * EPP Chrome flags (optimization-guide-on-device-model, prompt-api-for-gemini-nano)
 * enabled on that profile — we pass the corresponding --enable-features flags
 * on the command line so a fresh profile still works, but the user may need
 * to accept the Chrome EPP terms on first launch.
 *
 * Resume: re-running is idempotent. Rows keyed by engine_model|probe|input;
 * cells with error_message !== null or output starting 'ERROR:' are retried.
 * Clean rows are preserved verbatim.
 *
 * Test-mode gate cleanup: three-way protection (sweep-end + SIGINT + try/finally)
 * guarantees chrome.storage.local[honeyllm:test-mode] is cleared on exit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import {
  PROBES,
  INPUTS,
  INPUT_NAMES,
  PROBE_NAMES,
  type ProbeName,
  type Category,
} from './fixtures/phase2-inputs.js';
import {
  buildRow,
  buildPhase2Index,
  type AffectedRow,
  type DirectProbeResultLike,
  type BuiltinProbeResultLike,
  type Phase2RowLike,
} from './run-affected-baseline-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const EXTENSION_PATH = REPO_ROOT;
const PROFILE_PATH = resolve(homedir(), 'HoneyLLM-ChromeTestProfile');
const PHASE2_JSON_PATH = resolve(REPO_ROOT, 'docs', 'testing', 'inbrowser-results.json');
const OUTPUT_PATH = resolve(REPO_ROOT, 'docs', 'testing', 'inbrowser-results-affected.json');

const MLC_MODELS = [
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
  'gemma-2-2b-it-q4f16_1-MLC',
] as const;

const BUILTIN_SENTINEL = 'chrome-builtin-gemma';
const BUILTIN_RESOLVED_MODEL_ID = 'chrome-builtin-gemini-nano';
const ALL_MODELS: readonly string[] = [...MLC_MODELS, BUILTIN_SENTINEL];

// Per-cell and per-create timeouts. Stage 0 baseline was ~3 s cold create, ~5 s
// first prompt. First MLC load can be 30–120 s depending on model size + disk
// cache state, so the cell timeout has to be generous on row 1 of each model.
const FIRST_CELL_TIMEOUT_MS = 180_000;
const STEADY_CELL_TIMEOUT_MS = 60_000;
const MODEL_READY_TIMEOUT_MS = 180_000;

interface Args {
  readonly only: string | null;
  readonly dryRun: boolean;
  readonly smoke: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let only: string | null = null;
  let dryRun = false;
  let smoke = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      only = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--smoke') {
      smoke = true;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return { only, dryRun, smoke };
}

function log(msg: string): void {
  const t = new Date().toISOString().split('T')[1]!.replace('Z', '');
  console.log(`[${t}] ${msg}`);
}

function loadPhase2Index(): Map<string, Phase2RowLike> {
  if (!existsSync(PHASE2_JSON_PATH)) {
    log(`WARNING: Phase 2 baseline missing at ${PHASE2_JSON_PATH} — all rows will show no-native-baseline`);
    return new Map();
  }
  try {
    const parsed = JSON.parse(readFileSync(PHASE2_JSON_PATH, 'utf-8'));
    const rows: Phase2RowLike[] = parsed.results ?? [];
    const idx = buildPhase2Index(rows);
    log(`Phase 2 baseline loaded: ${idx.size} rows indexed`);
    return idx;
  } catch (err) {
    log(`WARNING: Phase 2 baseline parse failed (${String(err)}) — all rows will show no-native-baseline`);
    return new Map();
  }
}

interface AffectedResultsFile {
  schema_version: '3.0';
  phase: 3;
  track: 'A';
  methodology: 'playwright-extension-two-path';
  test_date: string;
  tester: string;
  results: AffectedRow[];
}

function loadExistingResults(): AffectedRow[] {
  if (!existsSync(OUTPUT_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as AffectedResultsFile;
    const rows = parsed.results ?? [];
    // Retry ONLY cells where error_message is set. Phase 2's runner also
    // filtered `output.startsWith('ERROR:')`, but that was a heuristic for
    // `mlc_llm serve` HTTP errors — a transport we don't use here.
    // adversarial_compliance on injected inputs could legitimately produce
    // output starting with "ERROR:" (the LLM complies with arbitrary
    // injected text), and dropping that row would cause infinite re-retry.
    const clean = rows.filter((r) => r.error_message === null);
    log(`Resumed with ${clean.length} existing clean rows (dropped ${rows.length - clean.length} error rows for retry)`);
    return clean;
  } catch (err) {
    log(`WARNING: could not parse existing ${OUTPUT_PATH}: ${String(err)}`);
    return [];
  }
}

function cellKey(engineModel: string, probe: string, input: string): string {
  return `${engineModel}|${probe}|${input}`;
}

function writeResults(rows: readonly AffectedRow[]): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const payload: AffectedResultsFile = {
    schema_version: '3.0',
    phase: 3,
    track: 'A',
    methodology: 'playwright-extension-two-path',
    test_date: new Date().toISOString().split('T')[0]!,
    tester: 'run-affected-baseline',
    results: [...rows],
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
}

// --- Playwright + Chrome extension transport -------------------------------

/**
 * sw.evaluate() serializes callbacks via Function.prototype.toString. tsx
 * (esbuild) injects __name() helper calls around named function expressions
 * to preserve Function.name, but that helper only exists in the tsx-wrapped
 * Node module scope — the SW has no __name global, so the eval throws
 * ReferenceError. We prepend a no-op __name shim to every callback so the
 * tsx-emitted helpers are harmless in the SW. Identity-return matches the
 * helper's real behavior.
 *
 * We use `new Function(...)` to construct callbacks from strings at runtime:
 * tsx cannot transform the body of a runtime string literal, so the emitted
 * code is verbatim. Playwright serializes the resulting function via its
 * toString() which produces plain-JS source.
 */
const NAME_SHIM = 'const __name = (fn) => fn; ';

async function launchExtensionContext(): Promise<BrowserContext> {
  mkdirSync(PROFILE_PATH, { recursive: true });
  log(`Launching Chromium with profile at ${PROFILE_PATH}`);
  return chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--enable-features=PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

async function attachServiceWorker(context: BrowserContext): Promise<Worker> {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    log('Waiting for service worker registration…');
    sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  log(`Service worker attached: ${sw.url()}`);

  // Stream SW console output so diagnostics from the evaluate payload are
  // visible. Without this, console.log inside the SW evaluate is silent.
  sw.on('console', (msg) => {
    log(`[sw:${msg.type()}] ${msg.text()}`);
  });

  // Diagnostic ping: verify the SW context is responsive and the extension
  // bundle's chrome.runtime is addressable. If this fails we'd rather know
  // before sending probes.
  const pingFn = new Function(
    NAME_SHIM +
      `return (async () => {
        const contexts = await chrome.runtime.getContexts({}).catch(() => []);
        return {
          extensionId: chrome.runtime.id,
          manifestName: chrome.runtime.getManifest().name,
          contextTypes: contexts.map((c) => c.contextType),
        };
      })();`,
  ) as () => Promise<{ extensionId: string; manifestName: string; contextTypes: string[] }>;
  const info = await sw.evaluate(pingFn);
  log(`SW context: id=${info.extensionId} name="${info.manifestName}" contexts=[${info.contextTypes.join(',')}]`);

  return sw;
}

async function setTestMode(sw: Worker, enabled: boolean): Promise<void> {
  const fn = new Function(
    'value',
    NAME_SHIM +
      `return (async () => {
        // storage.local is used (not sync) because Stage 5 confirmed that
        // storage.sync writes from the SW are not immediately visible to
        // offscreen / tab contexts on the same device — sync is eventually
        // consistent. local is cross-context immediate.
        if (value) {
          await chrome.storage.local.set({ 'honeyllm:test-mode': true });
        } else {
          await chrome.storage.local.remove('honeyllm:test-mode');
        }
        const check = await chrome.storage.local.get('honeyllm:test-mode');
        const actual = check['honeyllm:test-mode'];
        console.log('[setTestMode] desired=' + value + ' actual=' + JSON.stringify(actual));
        if (value && actual !== true) {
          throw new Error('setTestMode(true) did not persist; got ' + JSON.stringify(actual));
        }
        if (!value && actual !== undefined) {
          throw new Error('setTestMode(false) did not clear; got ' + JSON.stringify(actual));
        }
      })();`,
  ) as (v: boolean) => Promise<void>;
  await sw.evaluate(fn, enabled);
  log(`test-mode=${enabled}`);
}

/**
 * Set the active MLC model and reload the offscreen document so initEngine()
 * re-runs with the new model id. Waits for an ENGINE_STATUS{status:'ready'}
 * message via a one-shot listener installed inside the SW before triggering
 * the reload — otherwise the next probe races the engine load.
 */
async function setActiveModel(sw: Worker, modelId: string): Promise<void> {
  log(`Rotating offscreen engine → ${modelId}`);
  // Ordering: close any existing offscreen doc FIRST (so stale ENGINE_STATUS
  // events drain while we're not listening), THEN install the listener and
  // create the fresh doc. The listener only sees ready events from the NEW
  // doc. Storage flip happens before create so the fresh initEngine() reads
  // the new model id.
  const setActiveModelFn = new Function(
    'arg',
    NAME_SHIM +
      `const { modelId, timeoutMs } = arg;
      return (async () => {
        const before = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT']
        }).catch(() => []);
        console.log('[setActiveModel] pre-close offscreen contexts: ' + before.length);
        try { await chrome.offscreen.closeDocument(); console.log('[setActiveModel] closeDocument OK'); }
        catch (e) { console.log('[setActiveModel] closeDocument none: ' + (e && e.message)); }
        await new Promise((r) => setTimeout(r, 500));
        // storage.local (not sync) for cross-context immediacy — see setTestMode.
        await chrome.storage.local.set({ 'honeyllm:model': modelId });
        const verify = await chrome.storage.local.get('honeyllm:model');
        console.log('[setActiveModel] storage set honeyllm:model=' + modelId +
          ' (read-back: ' + JSON.stringify(verify['honeyllm:model']) + ')');
        if (verify['honeyllm:model'] !== modelId) {
          throw new Error('storage.local write did not persist: wrote ' + modelId +
            ', read ' + JSON.stringify(verify['honeyllm:model']));
        }
        const readyPromise = new Promise((resolve, reject) => {
          let timer = null;
          let settled = false;
          function listener(msg) {
            if (settled) return;
            if (msg && typeof msg === 'object' &&
                msg.type === 'ENGINE_STATUS' &&
                msg.status === 'ready') {
              settled = true;
              if (timer !== null) clearTimeout(timer);
              chrome.runtime.onMessage.removeListener(listener);
              resolve();
            }
          }
          chrome.runtime.onMessage.addListener(listener);
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            chrome.runtime.onMessage.removeListener(listener);
            reject(new Error('engine-ready timeout after ' + timeoutMs + 'ms'));
          }, timeoutMs);
        });
        // Pass model id + test-mode on the offscreen URL — reliable sync
        // read, no cross-context storage consistency lag.
        const url = 'dist/offscreen/offscreen.html?model=' +
          encodeURIComponent(modelId) + '&testMode=true';
        await chrome.offscreen.createDocument({
          url: url,
          reasons: ['WORKERS'],
          justification: 'Phase 3 Track A Stage 5 — affected baseline runner',
        });
        console.log('[setActiveModel] createDocument issued, awaiting ready…');
        await readyPromise;
        const after = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT']
        }).catch(() => []);
        console.log('[setActiveModel] post-ready offscreen contexts: ' + after.length);
      })();`,
  ) as (arg: { modelId: string; timeoutMs: number }) => Promise<void>;
  const t0 = Date.now();
  await sw.evaluate(setActiveModelFn, { modelId, timeoutMs: MODEL_READY_TIMEOUT_MS });
  log(`Engine ready: ${modelId} (${Date.now() - t0}ms)`);
}

const HARNESS_LOAD_TIMEOUT_MS = 30_000;

async function openHarnessTab(sw: Worker): Promise<number> {
  log('Opening builtin harness tab…');
  const openHarnessFn = new Function(
    'timeoutMs',
    NAME_SHIM +
      `return (async () => {
        // Pass test-mode on the URL — reliable sync read, bypasses storage lag.
        const tab = await chrome.tabs.create({
          url: chrome.runtime.getURL('dist/tests/phase3/builtin-harness.html') + '?testMode=true',
          active: false,
        });
        const id = tab.id;
        if (id === undefined) throw new Error('chrome.tabs.create returned tab without id');
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + timeoutMs;
          function check() {
            if (Date.now() > deadline) {
              reject(new Error("harness tab status !== 'complete' after " + timeoutMs + 'ms'));
              return;
            }
            chrome.tabs.get(id).then((t) => {
              if (t.status === 'complete') resolve();
              else setTimeout(check, 100);
            }).catch((err) => reject(err));
          }
          check();
        });
        return id;
      })();`,
  ) as (timeoutMs: number) => Promise<number>;
  const tabId = await sw.evaluate(openHarnessFn, HARNESS_LOAD_TIMEOUT_MS);
  log(`Harness tab opened: id=${tabId}`);
  return tabId;
}

async function closeHarnessTab(sw: Worker, tabId: number): Promise<void> {
  const closeHarnessFn = new Function(
    'id',
    NAME_SHIM +
      `return (async () => {
        try { await chrome.tabs.remove(id); } catch (e) { /* tab already gone */ }
      })();`,
  ) as (id: number) => Promise<void>;
  await sw.evaluate(closeHarnessFn, tabId);
}

async function sendDirectProbe(
  sw: Worker,
  message: {
    type: 'RUN_PROBE_DIRECT';
    requestId: string;
    probeName: ProbeName;
    systemPrompt: string;
    userMessage: string;
  },
  timeoutMs: number,
): Promise<DirectProbeResultLike> {
  const sendDirectFn = new Function(
    'arg',
    NAME_SHIM +
      `const { msg, timeout } = arg;
      return (async () => {
        const resp = await Promise.race([
          chrome.runtime.sendMessage(msg),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('RUN_PROBE_DIRECT timeout after ' + timeout + 'ms')),
            timeout
          )),
        ]);
        if (resp === undefined || resp === null) {
          throw new Error('RUN_PROBE_DIRECT no response (offscreen listener missing or sendResponse never called)');
        }
        return resp;
      })();`,
  ) as (arg: { msg: unknown; timeout: number }) => Promise<DirectProbeResultLike>;
  return sw.evaluate(sendDirectFn, { msg: message, timeout: timeoutMs });
}

async function sendBuiltinProbe(
  sw: Worker,
  tabId: number,
  message: {
    type: 'RUN_PROBE_BUILTIN';
    requestId: string;
    probeName: ProbeName;
    systemPrompt: string;
    userMessage: string;
  },
  timeoutMs: number,
): Promise<BuiltinProbeResultLike> {
  const sendBuiltinFn = new Function(
    'arg',
    NAME_SHIM +
      `const { tabId, msg, timeout } = arg;
      return (async () => {
        const resp = await Promise.race([
          chrome.tabs.sendMessage(tabId, msg),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('RUN_PROBE_BUILTIN timeout after ' + timeout + 'ms')),
            timeout
          )),
        ]);
        if (resp === undefined || resp === null) {
          throw new Error('RUN_PROBE_BUILTIN no response (harness listener missing or sendResponse never called)');
        }
        return resp;
      })();`,
  ) as (arg: { tabId: number; msg: unknown; timeout: number }) => Promise<BuiltinProbeResultLike>;
  return sw.evaluate(sendBuiltinFn, { tabId, msg: message, timeout: timeoutMs });
}

// --- Fallback rows for transport failures ----------------------------------

function directFallback(
  modelId: string,
  probeName: ProbeName,
  errorMessage: string,
): DirectProbeResultLike {
  return {
    type: 'PROBE_DIRECT_RESULT',
    requestId: 'transport-failure',
    probeName,
    engineRuntime: 'mlc-webllm-webgpu',
    engineModel: modelId,
    rawOutput: '',
    inferenceMs: 0,
    firstLoadMs: null,
    webgpuBackendDetected: null,
    skipped: false,
    skippedReason: null,
    errorMessage: `transport-failure: ${errorMessage}`,
  };
}

function builtinFallback(probeName: ProbeName, errorMessage: string): BuiltinProbeResultLike {
  return {
    type: 'PROBE_BUILTIN_RESULT',
    requestId: 'transport-failure',
    probeName,
    engineRuntime: 'chrome-builtin-prompt-api',
    engineModel: 'chrome-builtin-gemini-nano',
    rawOutput: '',
    inferenceMs: 0,
    firstCreateMs: null,
    availability: null,
    skipped: false,
    skippedReason: null,
    errorMessage: `transport-failure: ${errorMessage}`,
  };
}

// --- Main sweep ------------------------------------------------------------

interface SweepCtx {
  readonly sw: Worker;
  // Mutable on purpose: lazily populated the first time the sweep reaches the
  // builtin path so MLC-only runs never open the harness tab.
  harnessTabId: number | null;
  readonly phase2Index: Map<string, Phase2RowLike>;
  readonly hasResult: Set<string>;
  results: AffectedRow[];
  cellsRun: number;
  readonly args: Args;
}

async function runOneCell(
  ctx: SweepCtx,
  modelId: string,
  probeName: ProbeName,
  inputName: string,
): Promise<boolean /* continue sweep */> {
  const probe = PROBES[probeName];
  const input = INPUTS[inputName];
  if (input === undefined) throw new Error(`Unknown input fixture: ${inputName}`);
  const engineModel = modelId === BUILTIN_SENTINEL ? BUILTIN_RESOLVED_MODEL_ID : modelId;
  const key = cellKey(engineModel, probeName, inputName);
  if (ctx.hasResult.has(key)) {
    log(`SKIP ${modelId} ${probeName} ${inputName}`);
    return true;
  }

  const fixture = { probe: probeName, input: inputName, category: input.category as Category };
  const native = ctx.phase2Index.get(key) ?? null;
  const requestId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const timeoutMs = ctx.cellsRun === 0 ? FIRST_CELL_TIMEOUT_MS : STEADY_CELL_TIMEOUT_MS;

  let row: AffectedRow;
  if (modelId === BUILTIN_SENTINEL) {
    if (ctx.harnessTabId === null) throw new Error('harnessTabId missing for builtin path');
    let result: BuiltinProbeResultLike;
    try {
      result = await sendBuiltinProbe(
        ctx.sw,
        ctx.harnessTabId,
        {
          type: 'RUN_PROBE_BUILTIN',
          requestId,
          probeName,
          systemPrompt: probe.sys,
          userMessage: probe.prefix + input.text,
        },
        timeoutMs,
      );
    } catch (err) {
      result = builtinFallback(probeName, err instanceof Error ? err.message : String(err));
    }
    row = buildRow({ kind: 'builtin', result, fixture, nativePhase2Row: native });
  } else {
    let result: DirectProbeResultLike;
    try {
      result = await sendDirectProbe(
        ctx.sw,
        {
          type: 'RUN_PROBE_DIRECT',
          requestId,
          probeName,
          systemPrompt: probe.sys,
          userMessage: probe.prefix + input.text,
        },
        timeoutMs,
      );
    } catch (err) {
      result = directFallback(modelId, probeName, err instanceof Error ? err.message : String(err));
    }
    row = buildRow({ kind: 'direct', result, fixture, nativePhase2Row: native });
  }

  ctx.results.push(row);
  ctx.hasResult.add(key);
  ctx.cellsRun++;
  writeResults(ctx.results);

  const flags: string[] = [];
  if (row.complied) flags.push('COMPLIED');
  if (row.leaked_prompt) flags.push('LEAKED');
  if (row.included_url) flags.push('EXFIL');
  if (row.skipped_reason !== null) flags.push(`SKIP:${row.skipped_reason}`);
  if (row.error_message !== null) flags.push('ERROR');
  if (row.behavioral_delta_flags.length > 0) flags.push(`Δ:${row.behavioral_delta_flags.join(',')}`);

  const preview = row.output.replace(/\n/g, ' ').slice(0, 60);
  log(
    `CELL ${probeName.slice(0, 8).padEnd(8)} x ${inputName.padEnd(25)} ${flags.join(' ')} ${preview} (${row.inference_ms}ms)`,
  );

  if (ctx.args.dryRun || ctx.args.smoke) {
    log(`--${ctx.args.smoke ? 'smoke' : 'dry-run'}: stopping after first cell`);
    return false;
  }
  return true;
}

async function runOneModel(ctx: SweepCtx, modelId: string): Promise<boolean> {
  log(`\n=== MODEL: ${modelId} ===`);
  for (const probeName of PROBE_NAMES) {
    for (const inputName of INPUT_NAMES) {
      const cont = await runOneCell(ctx, modelId, probeName, inputName);
      if (!cont) return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  log(`run-affected-baseline start  only=${args.only ?? '(all)'}  dry-run=${args.dryRun}  smoke=${args.smoke}`);

  const phase2Index = loadPhase2Index();
  const existing = loadExistingResults();
  const hasResult = new Set(existing.map((r) => cellKey(r.engine_model, r.probe, r.input)));

  let models: readonly string[] = ALL_MODELS;
  if (args.only !== null) {
    if (!ALL_MODELS.includes(args.only)) {
      console.error(`--only ${args.only} is not a valid model id; valid: ${ALL_MODELS.join(', ')}`);
      process.exit(1);
    }
    models = [args.only];
  }

  const context = await launchExtensionContext();
  let sw: Worker;
  let harnessTabId: number | null = null;
  let swReady = false;

  const shutdown = async (): Promise<void> => {
    try {
      if (swReady) await setTestMode(sw!, false);
    } catch (err) {
      log(`shutdown: setTestMode(false) failed: ${String(err)}`);
    }
    try {
      if (harnessTabId !== null && swReady) await closeHarnessTab(sw!, harnessTabId);
    } catch (err) {
      log(`shutdown: closeHarnessTab failed: ${String(err)}`);
    }
    try {
      await context.close();
    } catch (err) {
      log(`shutdown: context.close failed: ${String(err)}`);
    }
  };

  const sigintHandler = async (): Promise<void> => {
    log('SIGINT received — cleaning up…');
    await shutdown();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  try {
    sw = await attachServiceWorker(context);
    swReady = true;
    await setTestMode(sw, true);

    const ctx: SweepCtx = {
      sw,
      harnessTabId: null,
      phase2Index,
      hasResult,
      results: existing.slice(),
      cellsRun: 0,
      args,
    };

    for (const modelId of models) {
      if (modelId === BUILTIN_SENTINEL) {
        if (ctx.harnessTabId === null) {
          ctx.harnessTabId = await openHarnessTab(sw);
          harnessTabId = ctx.harnessTabId; // keep outer ref for shutdown
        }
      } else {
        await setActiveModel(sw, modelId);
      }
      const cont = await runOneModel(ctx, modelId);
      if (!cont) break;
    }

    log(`Sweep complete. Total rows: ${ctx.results.length} (cells run this session: ${ctx.cellsRun})`);
  } finally {
    process.off('SIGINT', sigintHandler);
    await shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
