import type { LogEntry } from '@/shared/logger.js';
import { deriveTarget } from './page-routing.js';

const IDB_NAME = 'honeyllm-log-viewer';
const IDB_STORE = 'handles';
const IDB_KEY = 'rootDirectory';

interface SessionState {
  readonly sessionDir: FileSystemDirectoryHandle;
  readonly pagesDir: FileSystemDirectoryHandle;
  readonly fullHandle: FileSystemFileHandle;
  fullStream: FileSystemWritableFileStream;
  readonly streams: Map<string, FileSystemWritableFileStream>;
  readonly pageOrder: Map<string, number>;
  readonly indexHandle: FileSystemFileHandle;
  bytesWritten: number;
  startedAtMs: number;
  sessionId: string;
}

interface IndexFile {
  readonly schema: 'honeyllm-logs/index/v1';
  readonly sessionId: string;
  readonly startedAt: string;
  readonly pages: ReadonlyArray<{
    readonly index: number;
    readonly slug: string;
    readonly firstUrl: string;
    readonly firstSeenMs: number;
    lastSeenMs: number;
    lineCount: number;
  }>;
  readonly fullLines: number;
}

interface IndexFileMutable {
  schema: 'honeyllm-logs/index/v1';
  sessionId: string;
  startedAt: string;
  pages: Array<{
    index: number;
    slug: string;
    firstUrl: string;
    firstSeenMs: number;
    lastSeenMs: number;
    lineCount: number;
  }>;
  fullLines: number;
}

let session: SessionState | null = null;
let indexState: IndexFileMutable | null = null;
let indexFlushTimer: ReturnType<typeof setTimeout> | null = null;

// IndexedDB helpers (no library; we only need one row).
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearHandle(): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
): Promise<'granted' | 'prompt' | 'denied'> {
  type WithPerm = FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const h = handle as WithPerm;
  if (typeof h.queryPermission === 'function') {
    const status = await h.queryPermission({ mode: 'readwrite' });
    if (status === 'granted') return 'granted';
  }
  if (typeof h.requestPermission === 'function') {
    const status = await h.requestPermission({ mode: 'readwrite' });
    if (status === 'granted') return 'granted';
    return status;
  }
  return 'denied';
}

export interface PickResult {
  readonly handle: FileSystemDirectoryHandle;
  readonly directoryName: string;
}

export async function pickDirectory(): Promise<PickResult> {
  type WithPicker = Window & {
    showDirectoryPicker?: (opts?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  const picker = (window as WithPicker).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error('File System Access API not available in this browser');
  }
  const handle = await picker.call(window, { mode: 'readwrite', id: 'honeyllm-log-root' });
  await idbPutHandle(handle);
  return { handle, directoryName: handle.name };
}

export async function getSavedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await idbGetHandle();
  } catch {
    return null;
  }
}

export async function clearSavedHandle(): Promise<void> {
  await idbClearHandle();
}

function makeSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `session_${ts}_${rand}`;
}

async function writeIndex(): Promise<void> {
  if (session === null || indexState === null) return;
  const writable = await session.indexHandle.createWritable();
  try {
    await writable.write(JSON.stringify(indexState, null, 2));
  } finally {
    await writable.close();
  }
}

function scheduleIndexFlush(): void {
  if (indexFlushTimer !== null) return;
  indexFlushTimer = setTimeout(() => {
    indexFlushTimer = null;
    writeIndex().catch((err) => {
      console.error('[file-writer] index flush failed', err);
    });
  }, 5000);
}

// Issue #225 — open / re-open a writable at end-of-file so subsequent
// writes append. createWritable({keepExistingData}) defaults to position
// 0, which is correct for a freshly-created empty file but overwrites
// existing content after a flush+reopen cycle.
export async function reopenAtEnd(
  fh: FileSystemFileHandle,
): Promise<FileSystemWritableFileStream> {
  const file = await fh.getFile();
  const stream = await fh.createWritable({ keepExistingData: true });
  if (file.size > 0) await stream.seek(file.size);
  return stream;
}

export async function startSession(root: FileSystemDirectoryHandle): Promise<{
  sessionPath: string;
}> {
  if (session !== null) await stopSession();
  const sessionId = makeSessionId();
  const sessionDir = await root.getDirectoryHandle(sessionId, { create: true });
  const pagesDir = await sessionDir.getDirectoryHandle('pages', { create: true });
  const fullHandle = await sessionDir.getFileHandle('full.jsonl', { create: true });
  const fullStream = await reopenAtEnd(fullHandle);
  const indexHandle = await sessionDir.getFileHandle('index.json', { create: true });

  session = {
    sessionDir,
    pagesDir,
    fullHandle,
    fullStream,
    streams: new Map(),
    pageOrder: new Map(),
    indexHandle,
    bytesWritten: 0,
    startedAtMs: Date.now(),
    sessionId,
  };
  indexState = {
    schema: 'honeyllm-logs/index/v1',
    sessionId,
    startedAt: new Date().toISOString(),
    pages: [],
    fullLines: 0,
  };
  await writeIndex();
  return { sessionPath: `${root.name}/${sessionId}` };
}

async function getOrCreateBucketStream(filename: string): Promise<FileSystemWritableFileStream> {
  if (session === null) throw new Error('No active session');
  const cached = session.streams.get(filename);
  if (cached !== undefined) return cached;
  const isPageFile = !filename.startsWith('_');
  const dir = isPageFile ? session.pagesDir : session.sessionDir;
  const fh = await dir.getFileHandle(filename, { create: true });
  // reopenAtEnd seeks to current file size so writes after a flush+reopen
  // cycle (issue #225) append rather than overwrite from position 0.
  const stream = await reopenAtEnd(fh);
  session.streams.set(filename, stream);
  return stream;
}

export async function writeEntry(entry: LogEntry): Promise<void> {
  if (session === null || indexState === null) return;
  const target = deriveTarget(entry);

  let bucketFilename = target.filename;
  if (target.kind === 'page') {
    let order = session.pageOrder.get(target.key);
    if (order === undefined) {
      order = session.pageOrder.size + 1;
      session.pageOrder.set(target.key, order);
      bucketFilename = `${String(order).padStart(3, '0')}_${target.filename}`;
      indexState.pages.push({
        index: order,
        slug: target.key,
        firstUrl: entry.pageUrl ?? '',
        firstSeenMs: entry.timestampMs,
        lastSeenMs: entry.timestampMs,
        lineCount: 0,
      });
    } else {
      bucketFilename = `${String(order).padStart(3, '0')}_${target.filename}`;
    }
    const page = indexState.pages.find((p) => p.index === order);
    if (page !== undefined) {
      page.lastSeenMs = entry.timestampMs;
      page.lineCount += 1;
    }
  }

  const line = JSON.stringify(entry) + '\n';
  const bytes = new TextEncoder().encode(line);

  // Always write to full.jsonl in chronological order.
  await session.fullStream.write(bytes);
  session.bytesWritten += bytes.byteLength;
  indexState.fullLines += 1;

  // Then to the per-page or per-source bucket.
  const bucket = await getOrCreateBucketStream(bucketFilename);
  await bucket.write(bytes);
  session.bytesWritten += bytes.byteLength;

  scheduleIndexFlush();
}

// Issue #225 — periodic flush. Closes every cached writable so Chrome
// renames the .crswap swap files to their .jsonl targets, making logs
// tail-readable with bounded latency. Subsequent writes lazily reopen
// streams via getOrCreateBucketStream / reopenAtEnd.
//
// The viewer drives the cadence: it serialises flush() through the same
// pendingWrites tail-promise as writeEntry(), so flushes never race
// in-flight writes.
export async function flush(): Promise<void> {
  if (session === null) return;
  try {
    await session.fullStream.close();
  } catch (err) {
    console.error('[file-writer] full close during flush', err);
  }
  session.fullStream = await reopenAtEnd(session.fullHandle);

  const oldStreams = Array.from(session.streams.values());
  session.streams.clear();
  for (const stream of oldStreams) {
    try {
      await stream.close();
    } catch (err) {
      console.error('[file-writer] bucket close during flush', err);
    }
  }

  try {
    await writeIndex();
  } catch (err) {
    console.error('[file-writer] index flush during flush', err);
  }
}

export async function stopSession(): Promise<void> {
  if (session === null) return;
  if (indexFlushTimer !== null) {
    clearTimeout(indexFlushTimer);
    indexFlushTimer = null;
  }
  try {
    await writeIndex();
  } catch (err) {
    console.error('[file-writer] final index flush failed', err);
  }
  try {
    await session.fullStream.close();
  } catch (err) {
    console.error('[file-writer] full stream close failed', err);
  }
  for (const [name, stream] of session.streams) {
    try {
      await stream.close();
    } catch (err) {
      console.error(`[file-writer] bucket close failed for ${name}`, err);
    }
  }
  session = null;
  indexState = null;
}

export interface WriterStats {
  readonly active: boolean;
  readonly sessionId: string | null;
  readonly bytesWritten: number;
  readonly pageCount: number;
}

export function stats(): WriterStats {
  if (session === null) {
    return { active: false, sessionId: null, bytesWritten: 0, pageCount: 0 };
  }
  return {
    active: true,
    sessionId: session.sessionId,
    bytesWritten: session.bytesWritten,
    pageCount: session.pageOrder.size,
  };
}

export { ensurePermission };
