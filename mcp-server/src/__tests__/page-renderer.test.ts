import { describe, it, expect } from 'vitest';
import {
  createPlaywrightRenderer,
  type PlaywrightLauncher,
  type PlaywrightBrowser,
  type PlaywrightPage,
  type PlaywrightResponse,
} from '../extract/page-renderer.js';

interface FakeRecorder {
  readonly events: string[];
  readonly gotoCalls: Array<{ url: string; opts?: unknown }>;
  closed: { browser: boolean; page: boolean };
}

const makeFakeLauncher = (
  cfg: {
    pageHtml?: string;
    finalUrl?: string;
    status?: number;
    gotoThrows?: Error;
    contentThrows?: Error;
    launchThrows?: Error;
    nullResponse?: boolean;
  } = {},
): { launcher: PlaywrightLauncher; recorder: FakeRecorder } => {
  const recorder: FakeRecorder = {
    events: [],
    gotoCalls: [],
    closed: { browser: false, page: false },
  };

  const fakePage: PlaywrightPage = {
    async goto(url, opts) {
      recorder.events.push('goto');
      recorder.gotoCalls.push({ url, opts });
      if (cfg.gotoThrows !== undefined) throw cfg.gotoThrows;
      if (cfg.nullResponse === true) return null;
      const fakeResponse: PlaywrightResponse = {
        status: () => cfg.status ?? 200,
      };
      return fakeResponse;
    },
    async content() {
      recorder.events.push('content');
      if (cfg.contentThrows !== undefined) throw cfg.contentThrows;
      return cfg.pageHtml ?? '<html><body><p>rendered</p></body></html>';
    },
    url() {
      return cfg.finalUrl ?? 'https://example.com/landed';
    },
    async close() {
      recorder.events.push('page.close');
      recorder.closed.page = true;
    },
  };

  const fakeBrowser: PlaywrightBrowser = {
    async newPage() {
      recorder.events.push('newPage');
      return fakePage;
    },
    async close() {
      recorder.events.push('browser.close');
      recorder.closed.browser = true;
    },
  };

  const launcher: PlaywrightLauncher = {
    async launch() {
      recorder.events.push('launch');
      if (cfg.launchThrows !== undefined) throw cfg.launchThrows;
      return fakeBrowser;
    },
  };

  return { launcher, recorder };
};

describe('createPlaywrightRenderer', () => {
  it('renders post-settle DOM text from the launcher-supplied page', async () => {
    const { launcher } = makeFakeLauncher({
      pageHtml:
        '<html><body><p>Hello, dynamic world.</p><script>secret()</script></body></html>',
    });
    const renderer = createPlaywrightRenderer({ launcher });
    const out = await renderer.render('https://example.com/spa');
    expect(out.text).toContain('Hello, dynamic world.');
    expect(out.text).not.toContain('secret()');
  });

  it('reports the page final URL from page.url() (after redirects)', async () => {
    const { launcher } = makeFakeLauncher({
      finalUrl: 'https://example.com/after-redirect',
    });
    const renderer = createPlaywrightRenderer({ launcher });
    const out = await renderer.render('https://example.com/start');
    expect(out.url).toBe('https://example.com/after-redirect');
  });

  it('reports the response status (e.g. 200, 404) from goto-response', async () => {
    const { launcher: ok } = makeFakeLauncher({ status: 200 });
    const { launcher: bad } = makeFakeLauncher({ status: 404 });
    const a = await createPlaywrightRenderer({ launcher: ok }).render('https://example.com/');
    const b = await createPlaywrightRenderer({ launcher: bad }).render('https://example.com/');
    expect(a.status).toBe(200);
    expect(b.status).toBe(404);
  });

  it('treats a null goto-response as status 0 (resource skipped/aborted)', async () => {
    const { launcher } = makeFakeLauncher({ nullResponse: true });
    const renderer = createPlaywrightRenderer({ launcher });
    const out = await renderer.render('https://example.com/');
    expect(out.status).toBe(0);
  });

  it('passes goto a waitUntil setting (load or networkidle) and a timeout', async () => {
    const { launcher, recorder } = makeFakeLauncher();
    const renderer = createPlaywrightRenderer({ launcher });
    await renderer.render('https://example.com/');
    expect(recorder.gotoCalls).toHaveLength(1);
    const opts = recorder.gotoCalls[0]!.opts as { waitUntil?: string; timeout?: number };
    expect(['load', 'networkidle', 'domcontentloaded', 'commit']).toContain(opts.waitUntil ?? '');
    expect(typeof opts.timeout).toBe('number');
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it('respects a config-supplied timeoutMs override', async () => {
    const { launcher, recorder } = makeFakeLauncher();
    const renderer = createPlaywrightRenderer({ launcher, timeoutMs: 5000 });
    await renderer.render('https://example.com/');
    const opts = recorder.gotoCalls[0]!.opts as { timeout?: number };
    expect(opts.timeout).toBe(5000);
  });

  it('always closes both page and browser after a successful render', async () => {
    const { launcher, recorder } = makeFakeLauncher();
    const renderer = createPlaywrightRenderer({ launcher });
    await renderer.render('https://example.com/');
    expect(recorder.closed.page).toBe(true);
    expect(recorder.closed.browser).toBe(true);
  });

  it('still closes the browser when goto throws', async () => {
    const { launcher, recorder } = makeFakeLauncher({
      gotoThrows: new Error('navigation timeout'),
    });
    const renderer = createPlaywrightRenderer({ launcher });
    await expect(renderer.render('https://example.com/')).rejects.toThrow('navigation timeout');
    expect(recorder.closed.browser).toBe(true);
  });

  it('still closes the browser when content() throws', async () => {
    const { launcher, recorder } = makeFakeLauncher({
      contentThrows: new Error('frame detached'),
    });
    const renderer = createPlaywrightRenderer({ launcher });
    await expect(renderer.render('https://example.com/')).rejects.toThrow('frame detached');
    expect(recorder.closed.browser).toBe(true);
  });

  it('surfaces launch failure as a rejected promise (no leaked browser)', async () => {
    const { launcher, recorder } = makeFakeLauncher({
      launchThrows: new Error('chromium binary not found'),
    });
    const renderer = createPlaywrightRenderer({ launcher });
    await expect(renderer.render('https://example.com/')).rejects.toThrow(
      'chromium binary not found',
    );
    expect(recorder.closed.browser).toBe(false);
  });

  it('runs in headless mode by default', async () => {
    let launchOpts: unknown;
    const launcher: PlaywrightLauncher = {
      async launch(opts) {
        launchOpts = opts;
        const page: PlaywrightPage = {
          async goto() {
            return { status: () => 200 };
          },
          async content() {
            return '<p>x</p>';
          },
          url() {
            return 'https://example.com/';
          },
          async close() {},
        };
        return {
          async newPage() {
            return page;
          },
          async close() {},
        };
      },
    };
    const renderer = createPlaywrightRenderer({ launcher });
    await renderer.render('https://example.com/');
    expect(launchOpts).toMatchObject({ headless: true });
  });
});
