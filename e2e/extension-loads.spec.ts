import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

test.describe('Extension Loading', () => {
  let context: BrowserContext;
  let server: Server;
  let serverPort: number;

  test.beforeAll(async () => {
    // Serve a tiny static page from localhost. <all_urls> expands to
    // http/https/file/ftp only — data: URIs and external domains like
    // example.com create flakiness (data: excluded from CS matcher; external
    // network races the analysis pipeline).
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Extension-loads smoke page</h1><p>Stable local host so the content script can run.</p></body></html>');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

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
    if (server) await new Promise<void>((r) => server.close(() => r()));
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

    await page.goto(`http://localhost:${serverPort}/`);

    // Wait for the verdict to populate window — more reliable than waiting
    // for console log output since analysis timing varies with WebGPU load.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __AI_SITE_STATUS__?: string; __AI_SECURITY_REPORT__?: unknown };
        return w.__AI_SITE_STATUS__ !== undefined || w.__AI_SECURITY_REPORT__ !== undefined;
      },
      { timeout: 120_000 },
    );

    const hasHoneyLLMLogs = consoleMessages.some((m) => m.includes('[HoneyLLM:'));
    expect(hasHoneyLLMLogs).toBe(true);

    await page.close();
  });

  test('window globals are accessible to page scripts', async () => {
    const page = await context.newPage();
    await page.goto(`http://localhost:${serverPort}/`);

    // Wait up to 120s for the analysis to populate the globals. MLC canary
    // on WebGPU can take 30-60s; Nano is faster but still needs ≥5s.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __AI_SITE_STATUS__?: string;
          __AI_SECURITY_REPORT__?: unknown;
          __HONEYLLM_GUARD_ACTIVE__?: unknown;
        };
        return (
          w.__AI_SITE_STATUS__ !== undefined ||
          w.__AI_SECURITY_REPORT__ !== undefined ||
          w.__HONEYLLM_GUARD_ACTIVE__ !== undefined
        );
      },
      { timeout: 120_000 },
    );

    const canAccessGlobals = await page.evaluate(() => {
      const w = window as unknown as { __AI_SITE_STATUS__?: string; __AI_SECURITY_REPORT__?: unknown };
      return '__AI_SITE_STATUS__' in w || '__AI_SECURITY_REPORT__' in w;
    });
    const guardInjected = await page.evaluate(() => {
      return '__HONEYLLM_GUARD_ACTIVE__' in window;
    });

    expect(canAccessGlobals || guardInjected).toBe(true);

    await page.close();
  });
});
