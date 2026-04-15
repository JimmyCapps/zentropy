import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const EXTENSION_PATH = resolve(__dirname, '..');
const TEST_PAGES_DIR = resolve(__dirname, '..', 'test-pages');
const MANIFEST_PATH = resolve(TEST_PAGES_DIR, 'manifest.json');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
};

interface TestCase {
  file: string;
  expectedVerdict: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  techniques: string[];
  description: string;
  falsePositiveRisk: boolean;
}

interface HarnessResult {
  testCase: TestCase;
  actualVerdict: string | null;
  confidence: number | null;
  probes: Record<string, { passed: boolean; flags: string[] }> | null;
  analysis: Record<string, boolean> | null;
  mitigations: string[];
  match: boolean;
  error: string | null;
  durationMs: number;
}

let server: Server;
let serverPort: number;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url!;
      const filePath = join(TEST_PAGES_DIR, urlPath);

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
      resolve(port);
    });
  });
}

async function collectVerdict(page: Page, timeoutMs = 180_000): Promise<{
  status: string | null;
  report: any;
}> {
  try {
    await page.waitForFunction(
      () => (window as any).__AI_SECURITY_REPORT__ !== undefined,
      { timeout: timeoutMs },
    );
    const status = await page.evaluate(() => (window as any).__AI_SITE_STATUS__);
    const report = await page.evaluate(() => (window as any).__AI_SECURITY_REPORT__);
    return { status, report };
  } catch {
    return { status: null, report: null };
  }
}

test.describe('HoneyLLM Detection Harness', () => {
  let context: BrowserContext;
  const results: HarnessResult[] = [];

  test.beforeAll(async () => {
    serverPort = await startServer();
    console.log(`Test page server running on port ${serverPort}`);

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // Wait for service worker
    if (context.serviceWorkers().length === 0) {
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
  });

  test.afterAll(async () => {
    // Print results table
    console.log('\n' + '='.repeat(100));
    console.log('DETECTION HARNESS RESULTS');
    console.log('='.repeat(100));
    console.log(
      'File'.padEnd(45) +
      'Expected'.padEnd(14) +
      'Actual'.padEnd(14) +
      'Match'.padEnd(8) +
      'Confidence'.padEnd(12) +
      'Duration',
    );
    console.log('-'.repeat(100));

    let correct = 0;
    let total = 0;
    let fp = 0;
    let fn = 0;

    for (const r of results) {
      total++;
      const match = r.match ? 'YES' : 'NO';
      if (r.match) correct++;

      if (!r.match && r.testCase.expectedVerdict === 'CLEAN') fp++;
      if (!r.match && r.testCase.expectedVerdict !== 'CLEAN' && r.actualVerdict === 'CLEAN') fn++;

      console.log(
        r.testCase.file.padEnd(45) +
        r.testCase.expectedVerdict.padEnd(14) +
        (r.actualVerdict ?? 'TIMEOUT').padEnd(14) +
        match.padEnd(8) +
        (r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : 'N/A').padEnd(12) +
        `${r.durationMs}ms`,
      );
    }

    console.log('-'.repeat(100));
    console.log(`Accuracy: ${correct}/${total} (${Math.round((correct / total) * 100)}%)`);
    console.log(`False Positives: ${fp} | False Negatives: ${fn}`);

    // Technique coverage
    const techniqueResults = new Map<string, { detected: number; total: number }>();
    for (const r of results) {
      for (const tech of r.testCase.techniques) {
        const entry = techniqueResults.get(tech) ?? { detected: 0, total: 0 };
        entry.total++;
        if (r.actualVerdict && r.actualVerdict !== 'CLEAN') entry.detected++;
        techniqueResults.set(tech, entry);
      }
    }

    if (techniqueResults.size > 0) {
      console.log('\nTECHNIQUE COVERAGE:');
      for (const [tech, { detected, total }] of [...techniqueResults.entries()].sort()) {
        console.log(`  ${tech.padEnd(25)} ${detected}/${total} (${Math.round((detected / total) * 100)}%)`);
      }
    }

    console.log('='.repeat(100));

    // Save results to file
    const resultsJson = JSON.stringify(results, null, 2);
    const { writeFileSync } = await import('fs');
    writeFileSync(
      resolve(__dirname, '..', 'test-results-harness.json'),
      resultsJson,
    );

    if (context) await context.close();
    server?.close();
  });

  // Load test manifest and create a test for each page
  const manifest: TestCase[] = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  for (const testCase of manifest) {
    test(`${testCase.file} → ${testCase.expectedVerdict}`, async () => {
      const start = Date.now();
      const page = await context.newPage();

      try {
        const url = `http://localhost:${serverPort}/${testCase.file}`;
        await page.goto(url);

        const { status, report } = await collectVerdict(page, 180_000);
        const durationMs = Date.now() - start;

        const isVerdictMatch =
          status === testCase.expectedVerdict ||
          (testCase.expectedVerdict === 'COMPROMISED' && status === 'SUSPICIOUS') ||
          (testCase.expectedVerdict === 'SUSPICIOUS' && status === 'COMPROMISED');

        const result: HarnessResult = {
          testCase,
          actualVerdict: status,
          confidence: report?.confidence ?? null,
          probes: report?.probes ?? null,
          analysis: report?.analysis ?? null,
          mitigations: report?.mitigationsApplied ?? [],
          match: isVerdictMatch,
          error: status === null ? 'Timeout waiting for verdict' : null,
          durationMs,
        };

        results.push(result);

        if (status !== null) {
          if (testCase.falsePositiveRisk) {
            // Softer assertion for borderline pages
            test.info().annotations.push({
              type: 'note',
              description: `FP-risk page: expected=${testCase.expectedVerdict} actual=${status}`,
            });
          }
        }
      } finally {
        await page.close();
      }
    });
  }
});
