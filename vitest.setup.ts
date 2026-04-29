// Issue #127 (N11) — fake-indexeddb installs `indexedDB` and `IDBKeyRange`
// onto globalThis so the page-scan cache module can be unit-tested under
// vitest's `node` environment, where these APIs are not natively present.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

// Reset the in-memory IndexedDB between every test. Without this, cache
// records from a prior test would leak into the next, which makes
// integration tests (e.g. orchestrator.integration.test.ts) flaky:
// the second analyzeSnapshot call against the same URL would hit the
// cache and skip the chunk-loop the test was asserting against.
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
});
