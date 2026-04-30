import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runBuild } from '../../build.js';

describe('runBuild (mcp-server compiled distribution)', () => {
  let outdir = '';
  let outfile = '';
  let bundleText = '';

  beforeAll(async () => {
    outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'honeyllm-mcp-build-'));
    const result = await runBuild({ outdir });
    outfile = result.outfile;
    bundleText = fs.readFileSync(outfile, 'utf8');
  }, 60_000);

  afterAll(() => {
    if (outdir.length > 0) fs.rmSync(outdir, { recursive: true, force: true });
  });

  it('emits a single index.js into the requested outdir', () => {
    expect(outfile).toBe(path.join(outdir, 'index.js'));
    expect(fs.existsSync(outfile)).toBe(true);
    expect(fs.statSync(outfile).size).toBeGreaterThan(1024);
  });

  it('preserves the executable shebang on the first line so node dist/index.js works', () => {
    expect(bundleText.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('keeps playwright as a runtime dynamic import (not bundled) so optionalDependencies semantics survive', () => {
    expect(bundleText).toMatch(/import\(\s*["']playwright["']\s*\)/);
    expect(bundleText).not.toMatch(/var\s+chromium\s*=\s*[^;]*\bbrowser_type/);
  });

  it('inlines the four MCP tool registrations (browse, read_page, analyze_html, analyze_url) so a single artefact ships', () => {
    expect(bundleText).toMatch(/name:\s*"browse"/);
    expect(bundleText).toMatch(/name:\s*"read_page"/);
    expect(bundleText).toMatch(/name:\s*"analyze_html"/);
    expect(bundleText).toMatch(/name:\s*"analyze_url"/);
  });

  it('inlines the @modelcontextprotocol/sdk Server + StdioServerTransport classes (no node_modules required at runtime beyond playwright)', () => {
    expect(bundleText).toMatch(/StdioServerTransport/);
    expect(bundleText).toMatch(/CallToolRequestSchema|"tools\/call"/);
  });

  it('inlines HoneyLLM hawk + spider hunters from the parent repo so the MCP runtime is self-contained', () => {
    expect(bundleText).toMatch(/hawkHunter|hawk_hunter/i);
    expect(bundleText).toMatch(/spiderHunter|spider_hunter/i);
  });

  it('emits a parseable ESM module (no top-level CommonJS module.exports)', () => {
    expect(bundleText).not.toMatch(/^module\.exports\s*=/m);
  });
});
