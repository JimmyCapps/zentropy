import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import type { ThinkingAdapter } from './types.js';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/__fixtures__';

export interface ThinkingAdapterSpec {
  readonly adapter: ThinkingAdapter;
  readonly hostnameMatches: readonly string[];
  readonly hostnameMisses: readonly string[];
  readonly fixtureFile: string;
  /** A short substring expected to appear in the captured thinking text. */
  readonly expectedThinkingFragment: string;
}

function loadFixture(name: string): Document {
  const html = readFileSync(`${FIXTURE_DIR}/${name}`, 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

export function describeThinkingAdapter(spec: ThinkingAdapterSpec): void {
  describe(`thinking adapter: ${spec.adapter.portalId}`, () => {
    let doc: Document;
    beforeEach(() => {
      doc = loadFixture(spec.fixtureFile);
    });

    it('matchesHost returns true for known hostnames', () => {
      for (const h of spec.hostnameMatches) {
        expect(spec.adapter.matchesHost(h)).toBe(true);
      }
    });

    it('matchesHost returns false for foreign hostnames', () => {
      for (const h of spec.hostnameMisses) {
        expect(spec.adapter.matchesHost(h)).toBe(false);
      }
    });

    it('findThinkingBlocks locates at least one thinking block in the fixture', () => {
      const blocks = spec.adapter.findThinkingBlocks(doc);
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(b).toBeInstanceOf(HTMLElement);
    });

    it('captured thinking text contains the expected fragment', () => {
      const blocks = spec.adapter.findThinkingBlocks(doc);
      expect(blocks.length).toBeGreaterThan(0);
      const text = blocks
        .map((b) => b.textContent ?? '')
        .join(' ');
      expect(text).toContain(spec.expectedThinkingFragment);
    });

    it('findThinkingBlocks returns [] when no thinking elements exist', () => {
      const empty = new DOMParser().parseFromString(
        '<!doctype html><html><body><main><div>Just a regular page</div></main></body></html>',
        'text/html',
      );
      expect(spec.adapter.findThinkingBlocks(empty)).toEqual([]);
    });

    it('attachThinkingObserver emits a CapturedThinking on the seeded fixture (debounce + flush)', async () => {
      const captures: Array<{ portalId: string; text: string; messageId: string }> = [];
      const dispose = spec.adapter.attachThinkingObserver(doc, (cap) => {
        captures.push({ portalId: cap.portalId, text: cap.text, messageId: cap.messageId });
      });

      // Allow the debounce timer to fire. STREAM_END_DEBOUNCE_MS is 600ms;
      // we wait a touch longer to absorb any queued microtasks.
      await new Promise((resolve) => setTimeout(resolve, 750));
      dispose();

      expect(captures.length).toBeGreaterThan(0);
      const first = captures[0]!;
      expect(first.portalId).toBe(spec.adapter.portalId);
      expect(first.text).toContain(spec.expectedThinkingFragment);
      expect(first.messageId.startsWith(`${spec.adapter.portalId}-thinking:`)).toBe(true);
    });

    it('attachThinkingObserver returns a disposer that detaches cleanly', () => {
      const dispose = spec.adapter.attachThinkingObserver(doc, () => undefined);
      expect(() => dispose()).not.toThrow();
    });
  });
}
