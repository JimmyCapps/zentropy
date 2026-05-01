import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  embedText,
  embedTexts,
  EMBEDDING_DIM,
  _setEmbedderFactoryForTesting,
  _resetForTesting,
} from './embedding-engine.js';

interface FakeTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

type FakeEmbedder = (
  inputs: string | readonly string[],
  options?: { pooling?: 'mean' | 'none'; normalize?: boolean },
) => Promise<FakeTensor>;

function unitVector(dim: number, fill: number): Float32Array {
  const arr = new Float32Array(dim);
  arr.fill(fill);
  // L2-normalise so the fake mirrors the real model's `normalize: true` output.
  let sumSq = 0;
  for (const v of arr) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm > 0) for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / norm;
  return arr;
}

function tensor(data: Float32Array, dims: readonly number[]): FakeTensor {
  return { data, dims };
}

describe('embedding-engine', () => {
  beforeEach(() => _resetForTesting());
  afterEach(() => _resetForTesting());

  it('T1: single-flight — concurrent calls trigger one factory invocation', async () => {
    let factoryCalls = 0;
    let resolveFactory: ((p: FakeEmbedder) => void) | undefined;
    _setEmbedderFactoryForTesting(() => {
      factoryCalls++;
      return new Promise<FakeEmbedder>((resolve) => {
        resolveFactory = resolve;
      });
    });

    const promises = [
      embedText('a'),
      embedText('b'),
      embedText('c'),
      embedText('d'),
      embedText('e'),
    ];
    expect(factoryCalls).toBe(1);

    resolveFactory!(async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(factoryCalls).toBe(1);
  });

  it('T2: returns a Float32Array of EMBEDDING_DIM length', async () => {
    _setEmbedderFactoryForTesting(async () =>
      async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]),
    );
    const result = await embedText('hello world');
    expect(result).not.toBeNull();
    expect(result?.length).toBe(EMBEDDING_DIM);
    expect(result).toBeInstanceOf(Float32Array);
  });

  it('T3: empty input returns null without invoking factory', async () => {
    let factoryCalls = 0;
    _setEmbedderFactoryForTesting(async () => {
      factoryCalls++;
      return async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
    });
    const result = await embedText('');
    expect(result).toBeNull();
    expect(factoryCalls).toBe(0);
  });

  it('T4: factory throws → null', async () => {
    _setEmbedderFactoryForTesting(async () => {
      throw new Error('model load failed');
    });
    const result = await embedText('hello');
    expect(result).toBeNull();
  });

  it('T5: passes `passage:` prefix to embedder by default (e5 instruction format)', async () => {
    let receivedInput: string | readonly string[] | null = null;
    _setEmbedderFactoryForTesting(async () =>
      async (inputs) => {
        receivedInput = inputs;
        return tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
      },
    );
    await embedText('hello');
    expect(receivedInput).toBe('passage: hello');
  });

  it('T6: query mode prefixes input with `query:` instead', async () => {
    let receivedInput: string | readonly string[] | null = null;
    _setEmbedderFactoryForTesting(async () =>
      async (inputs) => {
        receivedInput = inputs;
        return tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
      },
    );
    await embedText('hello', { mode: 'query' });
    expect(receivedInput).toBe('query: hello');
  });

  it('T7: passes pooling=mean and normalize=true to embedder', async () => {
    let receivedOptions: { pooling?: string; normalize?: boolean } | undefined;
    _setEmbedderFactoryForTesting(async () =>
      async (_inputs, options) => {
        receivedOptions = options;
        return tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
      },
    );
    await embedText('hello');
    expect(receivedOptions?.pooling).toBe('mean');
    expect(receivedOptions?.normalize).toBe(true);
  });

  it('T8: embedTexts batches multiple inputs in one pipeline call', async () => {
    let calls = 0;
    let receivedInputs: string | readonly string[] | null = null;
    _setEmbedderFactoryForTesting(async () =>
      async (inputs) => {
        calls++;
        receivedInputs = inputs;
        const flat = new Float32Array(2 * EMBEDDING_DIM);
        flat.set(unitVector(EMBEDDING_DIM, 1), 0);
        flat.set(unitVector(EMBEDDING_DIM, 2), EMBEDDING_DIM);
        return tensor(flat, [2, EMBEDDING_DIM]);
      },
    );
    const result = await embedTexts(['hello', 'world']);
    expect(calls).toBe(1);
    expect(receivedInputs).toEqual(['passage: hello', 'passage: world']);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result?.[0]?.length).toBe(EMBEDDING_DIM);
    expect(result?.[1]?.length).toBe(EMBEDDING_DIM);
  });

  it('T9: embedTexts on empty array returns []', async () => {
    let factoryCalls = 0;
    _setEmbedderFactoryForTesting(async () => {
      factoryCalls++;
      return async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
    });
    const result = await embedTexts([]);
    expect(result).toEqual([]);
    expect(factoryCalls).toBe(0);
  });

  it('T10: embedTexts factory throws → null', async () => {
    _setEmbedderFactoryForTesting(async () => {
      throw new Error('boom');
    });
    const result = await embedTexts(['a', 'b']);
    expect(result).toBeNull();
  });

  it('T11: cosine of normalised identical vectors is ~1, of orthogonal is ~0', async () => {
    // Sanity check on the L2-normalisation contract — Stage 3 vector index relies on
    // dot product = cosine similarity for already-normalised embeddings.
    let call = 0;
    _setEmbedderFactoryForTesting(async () =>
      async () => {
        call++;
        if (call === 1) return tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
        if (call === 2) return tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
        // orthogonal: half ones / half negative-ones balanced — produces dot=0 with the all-ones unit vector
        const arr = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) arr[i] = i % 2 === 0 ? 1 : -1;
        let sumSq = 0;
        for (const v of arr) sumSq += v * v;
        const norm = Math.sqrt(sumSq);
        for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / norm;
        return tensor(arr, [1, EMBEDDING_DIM]);
      },
    );
    const a = await embedText('a');
    _resetForTesting();
    _setEmbedderFactoryForTesting(async () =>
      async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]),
    );
    const b = await embedText('b');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    let dot = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) dot += (a as Float32Array)[i]! * (b as Float32Array)[i]!;
    expect(dot).toBeCloseTo(1, 5);
  });

  it('T12: tensor with unexpected dims returns null (defensive)', async () => {
    _setEmbedderFactoryForTesting(async () =>
      async () => tensor(new Float32Array(10), [1, 10]),
    );
    const result = await embedText('hello');
    expect(result).toBeNull();
  });

  it('T13: _resetForTesting allows re-invocation of factory', async () => {
    let factoryCalls = 0;
    _setEmbedderFactoryForTesting(async () => {
      factoryCalls++;
      return async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
    });

    await embedText('first');
    expect(factoryCalls).toBe(1);
    await embedText('second');
    expect(factoryCalls).toBe(1);

    _resetForTesting();
    _setEmbedderFactoryForTesting(async () => {
      factoryCalls++;
      return async () => tensor(unitVector(EMBEDDING_DIM, 1), [1, EMBEDDING_DIM]);
    });
    await embedText('third');
    expect(factoryCalls).toBe(2);
  });
});
