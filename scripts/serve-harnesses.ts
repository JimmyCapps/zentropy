import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, join, normalize, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = 8765;
const ROOT = resolve(import.meta.dirname, '..', 'harnesses');

interface ServeArgs {
  readonly open: string | null;
}

function parseArgs(argv: readonly string[]): ServeArgs {
  const openFlagIndex = argv.indexOf('--open');
  const openTarget = openFlagIndex !== -1 && openFlagIndex + 1 < argv.length
    ? argv[openFlagIndex + 1]!
    : null;
  return { open: openTarget };
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function resolveSafePath(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = normalize(join(ROOT, clean === '/' ? '/index.html' : clean));
  const rel = relative(ROOT, candidate);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  return candidate;
}

function openInBrowser(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== HOST || parsed.port !== String(PORT) || parsed.protocol !== 'http:') {
    process.stderr.write(`refusing to open non-local URL: ${url}\n`);
    return;
  }
  const [cmd, args]: readonly [string, readonly string[]] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  execFile(cmd, args, (err) => {
    if (err !== null) process.stderr.write(`could not open browser: ${err.message}\n`);
  });
}

const server = createServer(async (req, res) => {
  const safePath = resolveSafePath(req.url ?? '/');
  if (safePath === null) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 forbidden');
    return;
  }
  try {
    const info = await stat(safePath);
    const finalPath = info.isDirectory() ? join(safePath, 'index.html') : safePath;
    const body = await readFile(finalPath);
    const mime = MIME[extname(finalPath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': mime,
      'cache-control': 'no-store',
      'x-harness-server': 'loopback-only',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
  }
});

const { open: openTarget } = parseArgs(process.argv.slice(2));

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  process.stdout.write(`harness server → ${base}/ (serving ${ROOT}, loopback only)\n`);
  if (openTarget !== null) {
    const url = `${base}/${openTarget.replace(/^\/+/, '')}`;
    process.stdout.write(`opening ${url}\n`);
    openInBrowser(url);
  }
  process.stdout.write('press Ctrl+C to stop\n');
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
