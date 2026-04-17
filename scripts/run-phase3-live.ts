/**
 * Phase 3 Track B — Live-Browser Regression Runner (automatable subset)
 *
 * Drives real Chrome with the HoneyLLM unpacked extension loaded (ON mode)
 * or absent (OFF mode) against a set of local + public fixtures. Captures
 * the *verdict-level* output written by src/policy/storage.ts to
 * chrome.storage.local under `honeyllm:verdict:<origin>` and measures the
 * end-to-end verdict latency.
 *
 * Track B measures detection regression, not probe-level behavior — the
 * verdict is the aggregate output of all three probes executed inside the
 * extension via the production PAGE_SNAPSHOT → VERDICT flow. No test-mode
 * handler is used; this exercises production code.
 *
 *   Usage:
 *     npx tsx scripts/run-phase3-live.ts --smoke            # 3-fixture gate (Stage B2)
 *     npx tsx scripts/run-phase3-live.ts                    # 9 local (Stage B3)
 *     npx tsx scripts/run-phase3-live.ts --public-urls      # 9 local + 3 public (Stage B4)
 *     npx tsx scripts/run-phase3-live.ts --dry-run          # stop after first fixture
 *     npx tsx scripts/run-phase3-live.ts --fixtures=<csv>   # explicit list
 *
 * Two-context strategy: ON and OFF are separate persistent profile dirs to
 * avoid profile-state bleed. The profile for ON caches the canary weights
 * across runs; OFF is a vanilla Chrome. Both profiles are disposable (never
 * the user's main profile).
 *
 * Resume: idempotent. Rows are keyed by (fixture_id, extension_mode);
 * existing clean rows are preserved verbatim, rows with error_message !==
 * null or error'd in prior runs are retried.
 */

import { createServer, type Server } from 'http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import {
  parseArgs,
  selectFixtures,
  resolveFixtureUrl,
  liveRowKey,
  buildLiveRow,
  verdictStorageKey,
  hasProbeError,
  normalizeFlags,
  normalizeBehavioralFlags,
  type Args,
  type FixtureSpec,
  type Phase3LiveRow,
  type Phase3LiveResultsFile,
  type VerdictStoragePayload,
  type ExtensionMode,
} from './run-phase3-live-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const EXTENSION_PATH = REPO_ROOT;
const TEST_PAGES_DIR = resolve(REPO_ROOT, 'test-pages');
const OUTPUT_PATH = resolve(REPO_ROOT, 'docs', 'testing', 'phase3-results.json');
const PROFILE_ON = resolve(homedir(), 'HoneyLLM-ChromeTestProfile');
const PROFILE_OFF = resolve(homedir(), 'HoneyLLM-ChromeTestProfile-off');

const CANARY_MODEL = 'gemma-2-2b-it-q4f16_1-MLC';

// --- Timeouts --------------------------------------------------------------
// With fresh-engine-per-cell mitigation (see closeOffscreenDoc), every cell
// incurs ~12s engine deserialisation + ~20s × 3 probes ≈ 90s worst case.
// First cell is no cheaper than the others now, so the distinction between
// FIRST and STEADY is gone. Absolute ceiling kept generous — Phi-3.5 Track A
// outlier was +15s over native so 90s has ~15s headroom on top of the worst
// observed p90.
const VERDICT_TIMEOUT_MS = 90_000;
// OFF mode: if we observe a verdict within this window, something is wrong
// (extension should not be active). Shorter than ON-mode timeouts — this
// is a negative assertion, not a measurement.
const OFF_VERIFY_WINDOW_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 45_000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const NAME_SHIM = 'const __name = (fn) => fn; ';

function log(msg: string): void {
  const t = new Date().toISOString().split('T')[1]!.replace('Z', '');
  console.log(`[${t}] ${msg}`);
}

function parseArgsOrExit(argv: readonly string[]): Args {
  try {
    return parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// --- Static server ---------------------------------------------------------

function startServer(docroot: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url!;
      const filePath = join(docroot, urlPath);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolvePromise({ server, port });
    });
  });
}

// --- Results I/O -----------------------------------------------------------

function loadExistingResults(): Phase3LiveRow[] {
  if (!existsSync(OUTPUT_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as Phase3LiveResultsFile;
    const rows = parsed.results ?? [];
    // Drop error rows so they can be retried. A null error_message on an
    // OFF row is fine — OFF is supposed to produce verdict=null.
    const clean = rows.filter((r) => r.error_message === null);
    const dropped = rows.length - clean.length;
    if (dropped > 0) {
      log(`Resumed with ${clean.length} existing clean rows (dropped ${dropped} error rows for retry)`);
    } else {
      log(`Resumed with ${clean.length} existing clean rows`);
    }
    return [...clean];
  } catch (err) {
    log(`WARNING: could not parse existing ${OUTPUT_PATH}: ${String(err)}`);
    return [];
  }
}

function writeResults(rows: readonly Phase3LiveRow[]): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const payload: Phase3LiveResultsFile = {
    schema_version: '4.0',
    phase: 3,
    track: 'B',
    methodology: 'playwright-extension-verdict-capture + manual-production-llm',
    test_date: new Date().toISOString().split('T')[0]!,
    tester: 'run-phase3-live',
    canary_model: CANARY_MODEL,
    results: [...rows],
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
}

// --- Playwright + Chrome extension transport ------------------------------

interface LaunchedContext {
  readonly context: BrowserContext;
  readonly sw: Worker | null; // null in OFF mode
}

async function launchContext(mode: ExtensionMode): Promise<LaunchedContext> {
  const profilePath = mode === 'on' ? PROFILE_ON : PROFILE_OFF;
  mkdirSync(profilePath, { recursive: true });
  const baseArgs = ['--no-first-run', '--no-default-browser-check'];
  const args = mode === 'on'
    ? [
        ...baseArgs,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ]
    : [...baseArgs, '--disable-extensions'];
  log(`Launching Chromium [${mode}] profile=${profilePath}`);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    args,
  });
  if (mode === 'off') {
    return { context, sw: null };
  }
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    log('Waiting for service worker registration…');
    sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  sw.on('console', (msg) => {
    log(`[sw:${msg.type()}] ${msg.text()}`);
  });
  log(`Service worker attached: ${sw.url()}`);
  return { context, sw };
}

async function setCanaryModel(sw: Worker, modelId: string): Promise<void> {
  const fn = new Function(
    'id',
    NAME_SHIM +
      `return (async () => {
        await chrome.storage.local.set({ 'honeyllm:model': id });
        const verify = await chrome.storage.local.get('honeyllm:model');
        if (verify['honeyllm:model'] !== id) {
          throw new Error('storage.local write for honeyllm:model did not persist');
        }
      })();`,
  ) as (id: string) => Promise<void>;
  await sw.evaluate(fn, modelId);
  log(`Canary model set: ${modelId}`);
  // Separate call so the reason is logged and the close is reusable across
  // fixture boundaries (not just at model-rotation time).
  await closeOffscreenDoc(sw, 'canary-rotation');
}

async function readVerdict(
  sw: Worker,
  storageKey: string,
): Promise<VerdictStoragePayload | null> {
  const fn = new Function(
    'key',
    NAME_SHIM +
      `return (async () => {
        const result = await chrome.storage.local.get(key);
        return result[key] ?? null;
      })();`,
  ) as (key: string) => Promise<VerdictStoragePayload | null>;
  return sw.evaluate(fn, storageKey);
}

async function clearVerdictForOrigin(sw: Worker, storageKey: string): Promise<void> {
  const fn = new Function(
    'key',
    NAME_SHIM +
      `return (async () => {
        await chrome.storage.local.remove(key);
      })();`,
  ) as (key: string) => Promise<void>;
  await sw.evaluate(fn, storageKey);
}

/**
 * Force a fresh offscreen document (and therefore a fresh MLC engine) for the
 * next page navigation.
 *
 * Why: Track B exposed a production-path regression where the shared MLC engine
 * enters a state that causes all subsequent `mlc.chat.completions.create()`
 * calls to throw. `src/offscreen/probe-runner.ts:37-46` catches those throws
 * and stamps a `probe_error` flag + score=0, which `src/policy/engine.ts`
 * evaluates to CLEAN+confidence=1.0 — a silent false negative on injected
 * content. Track A's `RUN_PROBE_DIRECT` path reused warm engines across 27
 * cells per model without issue, so the state bug is scoped to the production
 * `runProbes` iterator, not Gemma itself.
 *
 * Mitigation until the extension-side fix lands (Phase 8 backlog): close the
 * offscreen doc before every ON-mode navigation. SW will recreate it via
 * `ensureOffscreenDocument()` when the content script fires `PAGE_SNAPSHOT`;
 * the new offscreen re-runs `initEngine()` and loads Gemma fresh.
 *
 * Cost: ~12 s per cell for Gemma weight materialisation (weights are cached
 * in the persistent profile, so it's deserialisation, not re-download).
 *
 * The `new Function()` with a named parameter matches the pattern used by
 * sendDirectProbe/setTestMode/setActiveModel in run-affected-baseline.ts —
 * the NAME_SHIM is required because Playwright serializes callbacks via
 * Function.toString() and tsx injects __name() helpers that would throw
 * ReferenceError in the SW context.
 */
async function closeOffscreenDoc(sw: Worker, reason: string): Promise<void> {
  const fn = new Function(
    'reasonText',
    NAME_SHIM +
      `return (async () => {
        try {
          await chrome.offscreen.closeDocument();
          console.log('[closeOffscreenDoc] closed (' + reasonText + ')');
          return true;
        } catch (_) {
          return false;
        }
      })();`,
  ) as (r: string) => Promise<boolean>;
  const closed = await sw.evaluate(fn, reason);
  if (closed) {
    log(`Offscreen closed (${reason}) — next navigation triggers a fresh engine load`);
  }
}

/**
 * Poll chrome.storage.local for the verdict key. Returns the payload on
 * first observation, or null on timeout.
 */
async function waitForVerdict(
  sw: Worker,
  storageKey: string,
  timeoutMs: number,
): Promise<{ payload: VerdictStoragePayload; elapsedMs: number } | null> {
  const start = Date.now();
  const pollInterval = 250;
  while (Date.now() - start < timeoutMs) {
    const payload = await readVerdict(sw, storageKey);
    if (payload !== null && payload.status !== undefined) {
      return { payload, elapsedMs: Date.now() - start };
    }
    await sleep(pollInterval);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- One fixture × one mode ------------------------------------------------

interface FixtureRunResult {
  readonly payload: VerdictStoragePayload | null;
  readonly latencyMs: number | null;
  readonly errorMessage: string | null;
  readonly skippedReason: string | null;
}

async function runFixtureOn(
  sw: Worker,
  context: BrowserContext,
  fixtureUrl: string,
  isFirst: boolean,
): Promise<FixtureRunResult> {
  const storageKey = verdictStorageKey(fixtureUrl);
  // Clear any prior verdict for this origin so we capture the fresh one
  // from this navigation, not a stale one from a previous run.
  try {
    await clearVerdictForOrigin(sw, storageKey);
  } catch (err) {
    return {
      payload: null,
      latencyMs: null,
      errorMessage: `clear-prior-verdict failed: ${errMsg(err)}`,
      skippedReason: null,
    };
  }

  // Force fresh engine per cell — see closeOffscreenDoc() docblock for the
  // false-negative bug this mitigates. Skip on first cell of the run because
  // setCanaryModel already closed the doc at sweep start; re-closing would
  // make the "isFirst" timing budget misleading.
  if (!isFirst) {
    try {
      await closeOffscreenDoc(sw, 'fresh-engine-per-cell');
    } catch (err) {
      return {
        payload: null,
        latencyMs: null,
        errorMessage: `closeOffscreenDoc failed: ${errMsg(err)}`,
        skippedReason: null,
      };
    }
  }

  const page = await context.newPage();
  try {
    const navStart = Date.now();
    try {
      await page.goto(fixtureUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (err) {
      return {
        payload: null,
        latencyMs: null,
        errorMessage: `navigation failed: ${errMsg(err)}`,
        skippedReason: null,
      };
    }
    const observed = await waitForVerdict(sw, storageKey, VERDICT_TIMEOUT_MS);
    if (observed === null) {
      return {
        payload: null,
        latencyMs: null,
        errorMessage: `verdict-timeout after ${VERDICT_TIMEOUT_MS}ms for ${storageKey}`,
        skippedReason: null,
      };
    }
    const latencyMs = Date.now() - navStart;
    // Detect the runProbes-catches-error sentinel: policy evaluates probe_error
    // rows as score=0 → false-negative CLEAN verdict. Preserve payload for
    // audit but mark the row errored so resume will retry it.
    const allFlags = [
      ...normalizeFlags(observed.payload.flags),
      ...normalizeBehavioralFlags(observed.payload.behavioralFlags),
    ];
    if (hasProbeError(allFlags)) {
      return {
        payload: observed.payload,
        latencyMs,
        errorMessage: 'production probe path returned probe_error sentinel — engine degraded; verdict is false-negative by construction (score=0→CLEAN+1.0)',
        skippedReason: null,
      };
    }
    return {
      payload: observed.payload,
      latencyMs,
      errorMessage: null,
      skippedReason: null,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runFixtureOff(
  context: BrowserContext,
  fixtureUrl: string,
): Promise<FixtureRunResult> {
  const page = await context.newPage();
  try {
    try {
      await page.goto(fixtureUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (err) {
      return {
        payload: null,
        latencyMs: null,
        errorMessage: `navigation failed (off): ${errMsg(err)}`,
        skippedReason: null,
      };
    }
    // Sanity window — if __AI_SECURITY_REPORT__ appears in OFF mode, the
    // extension somehow leaked into this profile. That would be a test
    // invariant violation and we flag it loudly.
    await sleep(OFF_VERIFY_WINDOW_MS);
    const leaked = await page
      .evaluate(() => (window as unknown as { __AI_SECURITY_REPORT__?: unknown }).__AI_SECURITY_REPORT__ !== undefined)
      .catch(() => false);
    if (leaked) {
      return {
        payload: null,
        latencyMs: null,
        errorMessage:
          'extension artifact __AI_SECURITY_REPORT__ observed in OFF context — profile leak',
        skippedReason: null,
      };
    }
    return { payload: null, latencyMs: null, errorMessage: null, skippedReason: null };
  } finally {
    await page.close().catch(() => {});
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Sweep -----------------------------------------------------------------

interface SweepCtx {
  readonly args: Args;
  readonly fixtures: readonly FixtureSpec[];
  readonly localPort: number;
  readonly hasRow: Set<string>;
  readonly results: Phase3LiveRow[];
  cellsRun: number;
}

async function runOneMode(
  ctx: SweepCtx,
  mode: ExtensionMode,
): Promise<void> {
  const launched = await launchContext(mode);
  const { context, sw } = launched;
  try {
    if (mode === 'on' && sw !== null) {
      await setCanaryModel(sw, CANARY_MODEL);
    }
    let firstCell = true;
    for (const fixture of ctx.fixtures) {
      const key = liveRowKey(fixture.fixture_id, mode);
      if (ctx.hasRow.has(key)) {
        log(`SKIP ${fixture.fixture_id} [${mode}] (existing clean row)`);
        continue;
      }
      const fixtureUrl = resolveFixtureUrl(fixture, ctx.localPort);
      log(`FIX ${fixture.fixture_id} [${mode}] → ${fixtureUrl}`);
      const run =
        mode === 'on' && sw !== null
          ? await runFixtureOn(sw, context, fixtureUrl, firstCell)
          : await runFixtureOff(context, fixtureUrl);
      firstCell = false;
      const row = buildLiveRow({
        fixture,
        fixture_url: fixtureUrl,
        extension_mode: mode,
        canary_model: CANARY_MODEL,
        verdict_payload: run.payload,
        verdict_latency_ms: run.latencyMs,
        error_message: run.errorMessage,
        skipped_reason: run.skippedReason,
      });
      ctx.results.push(row);
      ctx.hasRow.add(key);
      ctx.cellsRun++;
      writeResults(ctx.results);
      logRow(row);
      if (ctx.args.dryRun || ctx.args.smoke) {
        if (ctx.args.dryRun) {
          log('--dry-run: stopping after first fixture in mode');
          return;
        }
        // --smoke continues through all smoke fixtures in each mode.
      }
    }
  } finally {
    await context.close().catch((err) => log(`context.close failed: ${errMsg(err)}`));
  }
}

function logRow(row: Phase3LiveRow): void {
  const v = row.verdict ?? 'none';
  const expect = row.expected_verdict;
  const match = row.verdict === expect ? 'MATCH' : row.extension_mode === 'off' ? '—' : 'MISS';
  const lat = row.verdict_latency_ms !== null ? `${row.verdict_latency_ms}ms` : '—';
  const err = row.error_message !== null ? ` ERROR:${row.error_message.slice(0, 60)}` : '';
  log(
    `ROW ${row.fixture_id.padEnd(40)} [${row.extension_mode}] verdict=${v.padEnd(12)} expect=${expect.padEnd(12)} ${match.padEnd(6)} ${lat}${err}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgsOrExit(process.argv.slice(2));
  const fixtures = selectFixtures(args);
  log(
    `run-phase3-live start  fixtures=${fixtures.length}  smoke=${args.smoke}  dry-run=${args.dryRun}  public=${args.includePublic}  canary=${CANARY_MODEL}`,
  );
  if (fixtures.length === 0) {
    log('No fixtures selected — nothing to do.');
    return;
  }

  // Dry-run short-circuits before we spin up Chrome: Stage B1 exit criterion
  // is "emits 0 rows without error", and burning 30s on Chrome launch for a
  // validation pass is wasteful.
  if (args.dryRun) {
    log(`--dry-run: ${fixtures.length} fixtures would be run × 2 modes = ${fixtures.length * 2} rows. Exiting without launching Chrome.`);
    return;
  }

  const { server, port } = await startServer(TEST_PAGES_DIR);
  log(`Static server on http://localhost:${port} (docroot=${TEST_PAGES_DIR})`);

  const existing = loadExistingResults();
  const hasRow = new Set(existing.map((r) => liveRowKey(r.fixture_id, r.extension_mode)));

  const ctx: SweepCtx = {
    args,
    fixtures,
    localPort: port,
    hasRow,
    results: existing.slice(),
    cellsRun: 0,
  };

  const sigintHandler = (): void => {
    log('SIGINT received — shutting server down…');
    try { server.close(); } catch {}
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  try {
    // ON mode first: captures verdicts against every fixture.
    await runOneMode(ctx, 'on');
    // OFF mode second: negative baseline. No canary load, so faster.
    await runOneMode(ctx, 'off');
    log(`Sweep complete. Rows this session: ${ctx.cellsRun}; total: ${ctx.results.length}`);
  } finally {
    process.off('SIGINT', sigintHandler);
    try { server.close(); } catch (err) { log(`server.close failed: ${errMsg(err)}`); }
  }
}

const isEntrypoint = process.argv[1] !== undefined && resolve(process.argv[1]) === __filename;
if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
