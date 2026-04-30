import { htmlToText } from './html-to-text.js';

export interface RenderedPage {
  readonly url: string;
  readonly status: number;
  readonly text: string;
}

export interface PageRenderer {
  render(url: string): Promise<RenderedPage>;
}

export interface PlaywrightResponse {
  status(): number;
}

export interface PlaywrightGotoOptions {
  readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  readonly timeout?: number;
}

export interface PlaywrightPage {
  goto(url: string, opts?: PlaywrightGotoOptions): Promise<PlaywrightResponse | null>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightLaunchOptions {
  readonly headless?: boolean;
}

export interface PlaywrightLauncher {
  launch(opts?: PlaywrightLaunchOptions): Promise<PlaywrightBrowser>;
}

export interface PlaywrightRendererConfig {
  readonly launcher: PlaywrightLauncher;
  readonly timeoutMs?: number;
  readonly waitUntil?: PlaywrightGotoOptions['waitUntil'];
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_UNTIL: PlaywrightGotoOptions['waitUntil'] = 'networkidle';

export function createPlaywrightRenderer(cfg: PlaywrightRendererConfig): PageRenderer {
  const timeout = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const waitUntil = cfg.waitUntil ?? DEFAULT_WAIT_UNTIL;
  return {
    async render(url) {
      const browser = await cfg.launcher.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const response = await page.goto(url, { waitUntil, timeout });
        const html = await page.content();
        const finalUrl = page.url();
        const status = response === null ? 0 : response.status();
        await page.close();
        return {
          url: finalUrl,
          status,
          text: htmlToText(html),
        };
      } finally {
        await browser.close();
      }
    },
  };
}
