import { describe, it, expect } from 'vitest';
import { reopenAtEnd } from './file-writer.js';

interface MockWritable {
  seekCalls: number[];
  closed: boolean;
  closedFlush: boolean;
  seek(pos: number): Promise<void>;
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}

interface MockFile {
  size: number;
}

interface MockFileHandle {
  file: MockFile;
  createWritableCalls: number;
  getFileCalls: number;
  getFile(): Promise<MockFile>;
  createWritable(opts: { keepExistingData: boolean }): Promise<MockWritable>;
  lastWritable: MockWritable | null;
}

function makeMockHandle(initialSize: number): MockFileHandle {
  const handle: MockFileHandle = {
    file: { size: initialSize },
    createWritableCalls: 0,
    getFileCalls: 0,
    lastWritable: null,
    async getFile() {
      this.getFileCalls += 1;
      return this.file;
    },
    async createWritable(_opts) {
      this.createWritableCalls += 1;
      const w: MockWritable = {
        seekCalls: [],
        closed: false,
        closedFlush: false,
        async seek(pos) {
          w.seekCalls.push(pos);
        },
        async write(_data) {
          // no-op
        },
        async close() {
          w.closed = true;
        },
      };
      this.lastWritable = w;
      return w;
    },
  };
  return handle;
}

describe('reopenAtEnd', () => {
  it('does not seek when the file is empty (position 0 is already end)', async () => {
    const handle = makeMockHandle(0);
    const stream = (await reopenAtEnd(
      handle as unknown as FileSystemFileHandle,
    )) as unknown as MockWritable;
    expect(handle.getFileCalls).toBe(1);
    expect(handle.createWritableCalls).toBe(1);
    expect(stream.seekCalls).toEqual([]);
  });

  it('seeks to file size when there is existing data so writes append', async () => {
    const handle = makeMockHandle(4321);
    const stream = (await reopenAtEnd(
      handle as unknown as FileSystemFileHandle,
    )) as unknown as MockWritable;
    expect(stream.seekCalls).toEqual([4321]);
  });

  it('returns a fresh writable on each call', async () => {
    const handle = makeMockHandle(100);
    const a = await reopenAtEnd(handle as unknown as FileSystemFileHandle);
    const b = await reopenAtEnd(handle as unknown as FileSystemFileHandle);
    expect(a).not.toBe(b);
    expect(handle.createWritableCalls).toBe(2);
  });
});
