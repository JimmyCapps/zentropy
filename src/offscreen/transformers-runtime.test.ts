import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadTransformers,
  _setTransformersImporterForTesting,
  _resetForTesting,
} from './transformers-runtime.js';

describe('transformers-runtime', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  it('returns the imported module and configures env exactly once', async () => {
    const fakeModule = {
      env: { backends: { onnx: { wasm: {} as { numThreads?: number } } } },
      pipeline: () => Promise.resolve(() => Promise.resolve([])),
    };
    let calls = 0;
    _setTransformersImporterForTesting(async () => {
      calls++;
      return fakeModule as unknown as typeof import('@huggingface/transformers');
    });

    const m1 = await loadTransformers();
    const m2 = await loadTransformers();

    expect(m1).toBe(fakeModule);
    expect(m2).toBe(fakeModule);
    expect(calls).toBe(1);
    expect(fakeModule.env.backends.onnx.wasm.numThreads).toBe(1);
  });

  it('single-flight: concurrent calls share one importer invocation', async () => {
    const fakeModule = {
      env: { backends: { onnx: { wasm: {} as { numThreads?: number } } } },
    };
    let calls = 0;
    let resolveImporter: ((mod: unknown) => void) | undefined;
    _setTransformersImporterForTesting(() => {
      calls++;
      return new Promise<typeof import('@huggingface/transformers')>((resolve) => {
        resolveImporter = resolve as (mod: unknown) => void;
      });
    });

    const p1 = loadTransformers();
    const p2 = loadTransformers();
    const p3 = loadTransformers();
    expect(calls).toBe(1);

    resolveImporter!(fakeModule);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(fakeModule);
    expect(r2).toBe(fakeModule);
    expect(r3).toBe(fakeModule);
    expect(calls).toBe(1);
  });

  it('importer rejection clears the in-flight promise so retries can re-fire', async () => {
    let attempt = 0;
    _setTransformersImporterForTesting(async () => {
      attempt++;
      if (attempt === 1) throw new Error('import failed once');
      return {
        env: { backends: { onnx: { wasm: {} } } },
      } as unknown as typeof import('@huggingface/transformers');
    });

    await expect(loadTransformers()).rejects.toThrow('import failed once');
    const second = await loadTransformers();
    expect(second).toBeDefined();
    expect(attempt).toBe(2);
  });
});
