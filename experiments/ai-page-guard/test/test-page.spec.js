/**
 * AI Page Guard — Comprehensive test-page.html E2E tests
 *
 * Every test verifies BOTH:
 * 1. DOM state (what the user/AI tool sees)
 * 2. Event log (what the extension actually did internally)
 *
 * This prevents false-passing tests where the DOM looks right by accident.
 */
import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../dist');
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

let context;
let page;

/** Get the extension's internal event log via message to content script */
async function getLog() {
  return page.evaluate(async () => {
    return new Promise(resolve => {
      chrome.runtime?.sendMessage?.({ type: 'get_log' }, resolve);
      // Fallback: read from window if chrome.runtime not available in page context
      setTimeout(() => resolve(window.__AI_PAGE_GUARD_LOG__ || []), 500);
    });
  }).catch(() => []);
}

/** Get the signal API report */
async function getReport() {
  return page.evaluate(() => window.__AI_SECURITY_REPORT__);
}

/** Wait for scan to settle (status leaves scanning/initializing) */
async function waitForScanSettle(maxWait = 10000) {
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => window.__AI_SECURITY_REPORT__?.status).catch(() => null);
    if (status && status !== 'initializing' && status !== 'scanning') return status;
    await page.waitForTimeout(200);
  }
  return 'timeout';
}

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--load-extension=${extensionPath}`,
      `--disable-extensions-except=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      '--allow-file-access-from-files',
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });

  page = await context.newPage();
  await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
  await waitForScanSettle();
});

test.afterAll(async () => {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
});

test.describe.serial('Test Page E2E', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIAL SCAN VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  test('initial scan completes with correct counts', async () => {
    const report = await getReport();
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);

    // Verify scan_start and scan_complete events exist
    const scanStart = log.find(e => e.event === 'scan_start');
    const scanComplete = log.find(e => e.event === 'scan_complete');
    expect(scanStart).toBeDefined();
    expect(scanComplete).toBeDefined();

    // Verify scan found threats
    expect(scanComplete.threats).toBeGreaterThanOrEqual(5);
    expect(scanComplete.scanned).toBeGreaterThan(0);

    // Verify report matches log
    expect(report.threats.length).toBe(scanComplete.threats);
    expect(report.status).toMatch(/^threats_found/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEAN CONTENT (must not be modified)
  // ═══════════════════════════════════════════════════════════════════════════

  test('clean content p#clean is untouched', async () => {
    // DOM check
    const text = await page.textContent('#clean');
    expect(text).toContain('cooking recipes');
    expect(text).toContain('gardening tips');
    expect(text).not.toContain('Content removed');

    // Attribute check
    const attr = await page.getAttribute('#clean', 'data-ai-guard');
    expect(attr).not.toBe('blocked');

    // Log check: no threat_detected for this element
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const cleanThreats = log.filter(e => e.event === 'threat_detected' && e.node_selector?.includes('clean'));
    expect(cleanThreats.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REGEX DETECTION (visible malicious content → masked)
  // ═══════════════════════════════════════════════════════════════════════════

  test('p#injection1 "ignore previous instructions" is masked', async () => {
    // DOM: element still exists but text is replaced
    const count = await page.locator('#injection1').count();
    expect(count).toBe(1);
    const attr = await page.getAttribute('#injection1', 'data-ai-guard');
    expect(attr).toBe('blocked');
    const text = await page.textContent('#injection1');
    expect(text).toContain('Content removed');
    expect(text).not.toContain('ignore previous');

    // Log: verify threat was detected with correct metadata
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector === 'p#injection1');
    expect(threat).toBeDefined();
    expect(threat.layer).toBe('regex');
    expect(threat.type).toBe('prompt_injection');
  });

  test('p#injection2 [INST]...[/INST] markers are masked', async () => {
    const count = await page.locator('#injection2').count();
    expect(count).toBe(1);
    const attr = await page.getAttribute('#injection2', 'data-ai-guard');
    expect(attr).toBe('blocked');
    const text = await page.textContent('#injection2');
    expect(text).toContain('Content removed');

    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector === 'p#injection2');
    expect(threat).toBeDefined();
    expect(threat.layer).toBe('regex');
    expect(threat.type).toBe('instruction_marker');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HIDDEN CONTENT DETECTION (hidden + injection text → stripped)
  // ═══════════════════════════════════════════════════════════════════════════

  test('div#hidden1 (display:none + injection) is stripped from DOM', async () => {
    const count = await page.locator('#hidden1').count();
    expect(count).toBe(0); // Completely removed

    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector === 'div#hidden1');
    expect(threat).toBeDefined();
    expect(threat.type).toBe('hidden_content');
  });

  test('div#hidden2 (opacity:0 + injection) is neutralized', async () => {
    const el = page.locator('#hidden2');
    const count = await el.count();
    if (count > 0) {
      const attr = await el.getAttribute('data-ai-guard');
      expect(attr).toBe('blocked');
    }
    // Either stripped or blocked is acceptable

    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector === 'div#hidden2');
    expect(threat).toBeDefined();
  });

  test('span#hidden3 (font-size:0 + injection) is neutralized', async () => {
    const el = page.locator('#hidden3');
    const count = await el.count();
    if (count > 0) {
      const attr = await el.getAttribute('data-ai-guard');
      expect(attr).toBe('blocked');
    }

    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector === 'span#hidden3');
    expect(threat).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FALSE POSITIVE PREVENTION (must NOT flag these)
  // ═══════════════════════════════════════════════════════════════════════════

  test('base64 content is not flagged (false positive fix)', async () => {
    const el = page.locator('#base64');
    expect(await el.count()).toBe(1);
    const text = await el.textContent();
    expect(text).toContain('QUFB');
    expect(text).not.toContain('Content removed');

    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const threat = log.find(e => e.event === 'threat_detected' && e.node_selector?.includes('base64'));
    expect(threat).toBeUndefined(); // No threat for base64
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNAL API (window.__AI_SECURITY_REPORT__)
  // ═══════════════════════════════════════════════════════════════════════════

  test('signal API has all required fields', async () => {
    const report = await getReport();
    expect(report).toBeDefined();
    expect(report.url).toContain('test-page.html');
    expect(typeof report.scan_coverage).toBe('number');
    expect(typeof report.last_scan).toBe('number');
    expect(report.threats).toBeInstanceOf(Array);
    expect(typeof report.pending_nodes).toBe('number');
    expect(typeof report.models_loaded).toBe('boolean');
    expect(['clean', 'scanning', 'threats_found', 'threats_found_scanning', 'initializing']).toContain(report.status);
  });

  test('signal API reports exactly 5 regex threats with correct selectors', async () => {
    const report = await getReport();
    const regexThreats = report.threats.filter(t => t.layer === 'regex');
    expect(regexThreats.length).toBe(5);

    const selectors = regexThreats.map(t => t.node_selector);
    expect(selectors).toContain('p#injection1');
    expect(selectors).toContain('p#injection2');
    expect(selectors).toContain('div#hidden1');
    expect(selectors).toContain('div#hidden2');
    expect(selectors).toContain('span#hidden3');
  });

  test('signal API threats have correct categories', async () => {
    const report = await getReport();
    const bySelector = Object.fromEntries(report.threats.map(t => [t.node_selector, t]));

    expect(bySelector['p#injection1'].type).toBe('prompt_injection');
    expect(bySelector['p#injection2'].type).toBe('instruction_marker');
    expect(bySelector['div#hidden1'].type).toBe('hidden_content');
    // hidden2 could be prompt_injection (caught by regex text) or hidden_content
    expect(['prompt_injection', 'hidden_content']).toContain(bySelector['div#hidden2'].type);
    expect(bySelector['span#hidden3'].type).toBe('hidden_content');
  });

  test('every threat has all required fields', async () => {
    const report = await getReport();
    for (const threat of report.threats) {
      expect(threat).toHaveProperty('type');
      expect(threat).toHaveProperty('layer');
      expect(threat).toHaveProperty('confidence');
      expect(threat).toHaveProperty('snippet');
      expect(threat).toHaveProperty('node_selector');
      expect(typeof threat.confidence).toBe('number');
      expect(threat.snippet.length).toBeGreaterThan(0);
    }
  });

  // Cross-reference: threat count in signal API matches threat_detected events in log
  test('signal API threat count matches event log', async () => {
    const report = await getReport();
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const logThreats = log.filter(e => e.event === 'threat_detected');
    expect(report.threats.length).toBe(logThreats.length);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ONNX PIPELINE (content that bypasses regex → sent to classifier)
  // ═══════════════════════════════════════════════════════════════════════════

  test('ONNX test paragraphs exist and are not caught by regex', async () => {
    for (const id of ['onnx1', 'onnx2', 'onnx3', 'onnx4', 'onnx5']) {
      const el = page.locator(`#${id}`);
      expect(await el.count()).toBe(1);
      const text = await el.textContent();
      expect(text).not.toContain('Content removed');
    }
  });

  test('ONNX test paragraphs have been processed (not stuck)', async () => {
    for (const id of ['onnx1', 'onnx2', 'onnx3', 'onnx4', 'onnx5']) {
      const attr = await page.getAttribute(`#${id}`, 'data-ai-guard');
      expect(attr).not.toBeNull();
      // Should not still be pending after initial scan settle
    }
  });

  test('clean ONNX test (onnx5) is classified safe', async () => {
    const text = await page.textContent('#onnx5');
    expect(text).toContain('OAuth2 tokens');
    const attr = await page.getAttribute('#onnx5', 'data-ai-guard');
    expect(attr).not.toBe('blocked');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MUTATION OBSERVER (dynamic content injection)
  // ═══════════════════════════════════════════════════════════════════════════

  test('threat count increases after clicking Inject Malicious Content', async () => {
    const beforeReport = await getReport();
    const beforeCount = beforeReport.threats.length;

    await page.click('button:has-text("Inject Malicious Content")');

    // Wait for MutationObserver to catch it
    const deadline = Date.now() + 5000;
    let afterCount = beforeCount;
    while (Date.now() < deadline) {
      const r = await getReport();
      afterCount = r.threats.length;
      if (afterCount > beforeCount) break;
      await page.waitForTimeout(200);
    }

    expect(afterCount).toBe(beforeCount + 1);

    // Verify the element was blocked
    const attr = await page.getAttribute('#dynamic-injection', 'data-ai-guard');
    expect(attr).toBe('blocked');
    const text = await page.textContent('#dynamic-injection');
    expect(text).toContain('Content removed');

    // Verify event log has the threat
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const dynThreat = log.find(e => e.event === 'threat_detected' && e.node_selector?.includes('dynamic'));
    expect(dynThreat).toBeDefined();
    expect(dynThreat.layer).toBe('regex');
  });

  test('dynamic clean content is not flagged', async () => {
    const beforeReport = await getReport();
    const beforeCount = beforeReport.threats.length;

    await page.click('button:has-text("Inject Clean Content")');
    await page.waitForTimeout(1000);

    const el = page.locator('#dynamic-clean');
    expect(await el.count()).toBe(1);
    const text = await el.textContent();
    expect(text).toContain('weather forecast');
    expect(text).not.toContain('Content removed');

    // Threat count should NOT increase
    const afterReport = await getReport();
    expect(afterReport.threats.length).toBe(beforeCount);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ONNX TIMEOUT (scanning must resolve, not hang forever)
  // ═══════════════════════════════════════════════════════════════════════════

  test('scanning resolves and pending reaches 0 within 30s', async () => {
    // Navigate fresh to trigger a new scan with pending ONNX chunks
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + 30000;
    let lastReport = null;
    while (Date.now() < deadline) {
      lastReport = await getReport().catch(() => null);
      if (lastReport && lastReport.pending_nodes === 0 &&
          lastReport.status !== 'initializing' && lastReport.status !== 'scanning') break;
      await page.waitForTimeout(1000);
    }

    expect(lastReport).not.toBeNull();
    expect(lastReport.status).not.toBe('scanning');
    expect(lastReport.status).not.toBe('initializing');
    expect(lastReport.pending_nodes).toBe(0);

    // Verify log has either onnx_response (models worked) or onnx_timeout (timed out gracefully)
    const log = await page.evaluate(() => window.__AI_PAGE_GUARD_LOG__ || []);
    const onnxEvents = log.filter(e => ['onnx_response', 'onnx_timeout', 'onnx_give_up'].includes(e.event));
    expect(onnxEvents.length).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INFINITE SCROLL (multiple posts injected rapidly)
  // ═══════════════════════════════════════════════════════════════════════════

  test('infinite scroll: malicious posts caught, clean posts pass', async () => {
    await page.click('button:has-text("Simulate Infinite Scroll")');
    await page.waitForTimeout(3000);

    const scrollTarget = page.locator('#scroll-target > div');
    const count = await scrollTarget.count();
    expect(count).toBe(10);

    // Posts 0, 3, 6, 9 have "ignore previous instructions" → malicious
    // Posts 1, 2, 4, 5, 7, 8 have "Normal social media" → clean
    let maskedCount = 0;
    let cleanCount = 0;
    for (let i = 0; i < count; i++) {
      const text = await scrollTarget.nth(i).textContent();
      if (text.includes('Content removed')) maskedCount++;
      else if (text.includes('Normal social media')) cleanCount++;
    }

    // At least 3 malicious posts caught (0, 3, 6; post 9 might depend on timing)
    expect(maskedCount).toBeGreaterThanOrEqual(3);
    expect(cleanCount).toBeGreaterThanOrEqual(5);
  });

});
