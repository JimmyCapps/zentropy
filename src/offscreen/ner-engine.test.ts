import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleRunNer,
  _setNerFactoryForTesting,
  _resetForTesting,
} from './ner-engine.js';

interface FakeHit {
  readonly entity_group: string;
  readonly score: number;
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

type FakePipeline = (text: string, options?: { aggregation_strategy?: string }) => Promise<FakeHit[]>;

function pipelineReturning(hits: readonly FakeHit[]): FakePipeline {
  return async () => [...hits];
}

describe('ner-engine', () => {
  beforeEach(() => _resetForTesting());
  afterEach(() => _resetForTesting());

  it('T1: single-flight — concurrent calls trigger one factory invocation', async () => {
    let factoryCalls = 0;
    let resolveFactory: ((p: FakePipeline) => void) | undefined;
    _setNerFactoryForTesting(() => {
      factoryCalls++;
      return new Promise<FakePipeline>((resolve) => {
        resolveFactory = resolve;
      });
    });

    const promises = [
      handleRunNer('a'),
      handleRunNer('b'),
      handleRunNer('c'),
      handleRunNer('d'),
      handleRunNer('e'),
    ];
    expect(factoryCalls).toBe(1);

    resolveFactory!(pipelineReturning([]));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(factoryCalls).toBe(1);
  });

  it('T2: cold-start exceeds deadline → returns []', async () => {
    _setNerFactoryForTesting(() => new Promise(() => { /* never resolves */ }));
    const result = await handleRunNer('hello world', 50);
    expect(result).toEqual([]);
  });

  it('T3: warm inference exceeds deadline → returns []', async () => {
    const slowPipeline: FakePipeline = () => new Promise(() => { /* never resolves */ });
    _setNerFactoryForTesting(async () => slowPipeline);
    const result = await handleRunNer('hello world', 50);
    expect(result).toEqual([]);
  });

  it('T4: tag mapping PER→person, ORG→organization, LOC→location, MISC→misc', async () => {
    _setNerFactoryForTesting(async () =>
      pipelineReturning([
        { entity_group: 'PER', score: 0.99, word: 'Alice', start: 0, end: 5 },
        { entity_group: 'ORG', score: 0.95, word: 'Acme Corp', start: 10, end: 19 },
        { entity_group: 'LOC', score: 0.97, word: 'Tokyo', start: 25, end: 30 },
        { entity_group: 'MISC', score: 0.90, word: 'Olympics', start: 35, end: 43 },
      ]),
    );

    const result = await handleRunNer('Alice ... Acme Corp ... Tokyo ... Olympics');
    expect(result).toEqual([
      { type: 'person', value: 'Alice', span: [0, 5], confidence: 0.99 },
      { type: 'organization', value: 'Acme Corp', span: [10, 19], confidence: 0.95 },
      { type: 'location', value: 'Tokyo', span: [25, 30], confidence: 0.97 },
      { type: 'misc', value: 'Olympics', span: [35, 43], confidence: 0.90 },
    ]);
  });

  it('T5: confidence floor — score < 0.85 is dropped', async () => {
    _setNerFactoryForTesting(async () =>
      pipelineReturning([
        { entity_group: 'PER', score: 0.84, word: 'Bob', start: 0, end: 3 },
        { entity_group: 'PER', score: 0.86, word: 'Carol', start: 5, end: 10 },
      ]),
    );

    const result = await handleRunNer('Bob and Carol');
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe('Carol');
  });

  it('T6: offset adjust — caller-supplied offset shifts spans', async () => {
    _setNerFactoryForTesting(async () =>
      pipelineReturning([
        { entity_group: 'PER', score: 0.99, word: 'Dana', start: 0, end: 4 },
      ]),
    );

    const result = await handleRunNer('Dana', 250, 100);
    expect(result).toEqual([
      { type: 'person', value: 'Dana', span: [100, 104], confidence: 0.99 },
    ]);
  });

  it('T7: factory throws → graceful empty result', async () => {
    _setNerFactoryForTesting(async () => {
      throw new Error('model load failed');
    });

    const result = await handleRunNer('hello');
    expect(result).toEqual([]);
  });

  it('T8: _resetForTesting allows re-invocation of factory', async () => {
    let factoryCalls = 0;
    _setNerFactoryForTesting(async () => {
      factoryCalls++;
      return pipelineReturning([]);
    });

    await handleRunNer('first');
    expect(factoryCalls).toBe(1);

    // second call hits the cached pipeline — factory should NOT be called
    await handleRunNer('second');
    expect(factoryCalls).toBe(1);

    _resetForTesting();
    _setNerFactoryForTesting(async () => {
      factoryCalls++;
      return pipelineReturning([]);
    });
    await handleRunNer('third');
    expect(factoryCalls).toBe(2);
  });

  it('drops hits without start/end offsets (tokenizer without offset_mapping)', async () => {
    _setNerFactoryForTesting(async () => async () => [
      { entity_group: 'PER', score: 0.99, word: 'Eve' } as FakeHit,
    ]);

    const result = await handleRunNer('Eve');
    expect(result).toEqual([]);
  });

  it('drops hits with unknown entity_group', async () => {
    _setNerFactoryForTesting(async () =>
      pipelineReturning([
        { entity_group: 'GADGET', score: 0.99, word: 'iPhone', start: 0, end: 6 },
      ]),
    );

    const result = await handleRunNer('iPhone');
    expect(result).toEqual([]);
  });

  it('strips B-/I- BIO prefixes when entity_group is missing (raw output)', async () => {
    // raw output uses `entity` instead of `entity_group`. Our handler should
    // accept either via runtime narrowing.
    _setNerFactoryForTesting(async () => async (): Promise<FakeHit[]> => [
      { entity: 'B-PER', score: 0.99, word: 'Frank', start: 0, end: 5, entity_group: undefined } as unknown as FakeHit,
    ]);

    const result = await handleRunNer('Frank');
    expect(result).toEqual([
      { type: 'person', value: 'Frank', span: [0, 5], confidence: 0.99 },
    ]);
  });

  it('returns [] for empty input without invoking factory', async () => {
    let factoryCalls = 0;
    _setNerFactoryForTesting(async () => {
      factoryCalls++;
      return pipelineReturning([]);
    });

    const result = await handleRunNer('');
    expect(result).toEqual([]);
    expect(factoryCalls).toBe(0);
  });
});
