import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

test.describe('Extension Loading', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test('service worker registers and content script runs', async () => {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    expect(serviceWorker).toBeDefined();
    expect(serviceWorker.url()).toContain('service-worker/index.js');
  });

  test('content script sends snapshot and receives verdict', async () => {
    const page = await context.newPage();

    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[HoneyLLM')) {
        consoleMessages.push(msg.text());
      }
    });

    await page.goto('https://example.com');
    await page.waitForTimeout(5000);

    const hasHoneyLLMLogs = consoleMessages.some((m) => m.includes('[HoneyLLM:'));
    expect(hasHoneyLLMLogs).toBe(true);

    await page.close();
  });

  test('window globals are accessible to page scripts', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(5000);

    const canAccessGlobals = await page.evaluate(() => {
      return '__AI_SITE_STATUS__' in window || '__AI_SECURITY_REPORT__' in window;
    });

    const guardInjected = await page.evaluate(() => {
      return '__HONEYLLM_GUARD_ACTIVE__' in window;
    });

    expect(canAccessGlobals || guardInjected).toBe(true);

    await page.close();
  });
});
