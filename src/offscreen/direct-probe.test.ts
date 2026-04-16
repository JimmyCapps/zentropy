import { describe, it, expect, vi } from 'vitest';
import { runDirectProbe, resetDirectProbeStateForTests } from './direct-probe.js';
import type { RunProbeDirectMessage } from '@/types/messages.js';

function baseRequest(overrides: Partial<RunProbeDirectMessage> = {}): RunProbeDirectMessage {
  return {
    type: 'RUN_PROBE_DIRECT',
    requestId: 'req-1',
    probeName: 'summarization',
    systemPrompt: 'You are a factual text summarizer.',
    userMessage: 'Summarize the following content:\n\nSourdough bread has been a staple…',
    ...overrides,
  };
}

describe('runDirectProbe (Phase 3 Track A Path 1 handler)', () => {
  it('returns a skipped result when the test-mode gate is off', async () => {
    resetDirectProbeStateForTests();
    const result = await runDirectProbe(baseRequest(), {
      isTestModeEnabled: async () => false,
      getGpuAdapterArchitecture: async () => 'metal',
      callEngine: async () => {
        throw new Error('should not be called when gate is off');
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    });

    expect(result.type).toBe('PROBE_DIRECT_RESULT');
    expect(result.requestId).toBe('req-1');
    expect(result.probeName).toBe('summarization');
    expect(result.engineRuntime).toBe('mlc-webllm-webgpu');
    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toBe('test-mode-disabled');
    expect(result.errorMessage).toBeNull();
    expect(result.rawOutput).toBe('');
    expect(result.inferenceMs).toBe(0);
    expect(result.firstLoadMs).toBeNull();
    expect(result.webgpuBackendDetected).toBeNull();
  });

  it('populates errorMessage when the engine throws', async () => {
    resetDirectProbeStateForTests();
    const result = await runDirectProbe(baseRequest(), {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => 'metal',
      callEngine: async () => {
        throw new Error('WebGPU adapter lost');
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    });

    expect(result.skipped).toBe(false);
    expect(result.skippedReason).toBeNull();
    expect(result.errorMessage).toBe('WebGPU adapter lost');
    expect(result.rawOutput).toBe('');
    expect(result.engineModel).toBe('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
  });

  it('returns raw output + timing on the happy path', async () => {
    resetDirectProbeStateForTests();
    let t = 1000;
    const result = await runDirectProbe(baseRequest(), {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => 'metal',
      callEngine: async () => {
        t += 250;
        return 'Sourdough bread has been a staple for thousands of years.';
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => t,
    });

    expect(result.skipped).toBe(false);
    expect(result.errorMessage).toBeNull();
    expect(result.rawOutput).toBe('Sourdough bread has been a staple for thousands of years.');
    expect(result.inferenceMs).toBe(250);
    expect(result.firstLoadMs).toBe(250);
    expect(result.webgpuBackendDetected).toBe('metal');
    expect(result.engineModel).toBe('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
    expect(result.engineRuntime).toBe('mlc-webllm-webgpu');
  });

  it('populates firstLoadMs only on the first successful call per lifecycle', async () => {
    resetDirectProbeStateForTests();
    let t = 0;
    const deps = {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => 'apple-m2',
      callEngine: async () => {
        t += 100;
        return 'ok';
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => t,
    };

    const first = await runDirectProbe(baseRequest({ requestId: 'r1' }), deps);
    const second = await runDirectProbe(baseRequest({ requestId: 'r2' }), deps);
    const third = await runDirectProbe(baseRequest({ requestId: 'r3' }), deps);

    expect(first.firstLoadMs).toBe(100);
    expect(second.firstLoadMs).toBeNull();
    expect(third.firstLoadMs).toBeNull();
  });

  it('does not set firstLoadMs when the first call errors', async () => {
    resetDirectProbeStateForTests();
    let t = 0;
    let calls = 0;
    const deps = {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => 'metal',
      callEngine: async () => {
        calls++;
        t += 50;
        if (calls === 1) throw new Error('first call failed');
        return 'ok on retry';
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => t,
    };

    const firstAttempt = await runDirectProbe(baseRequest({ requestId: 'r1' }), deps);
    expect(firstAttempt.errorMessage).toBe('first call failed');
    expect(firstAttempt.firstLoadMs).toBeNull();

    const secondAttempt = await runDirectProbe(baseRequest({ requestId: 'r2' }), deps);
    expect(secondAttempt.errorMessage).toBeNull();
    expect(secondAttempt.firstLoadMs).toBe(50);
  });

  it('resolves webgpuBackendDetected to null when adapter info is unavailable', async () => {
    resetDirectProbeStateForTests();
    const result = await runDirectProbe(baseRequest(), {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => null,
      callEngine: async () => 'ok',
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    });

    expect(result.webgpuBackendDetected).toBeNull();
    expect(result.rawOutput).toBe('ok');
  });

  it('caches getGpuAdapterArchitecture after the first resolved call', async () => {
    resetDirectProbeStateForTests();
    const arch = vi.fn(async () => 'metal');
    const deps = {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: arch,
      callEngine: async () => 'ok',
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    };

    await runDirectProbe(baseRequest({ requestId: 'r1' }), deps);
    await runDirectProbe(baseRequest({ requestId: 'r2' }), deps);
    await runDirectProbe(baseRequest({ requestId: 'r3' }), deps);

    expect(arch).toHaveBeenCalledTimes(1);
  });

  it('retries getGpuAdapterArchitecture on next call when the previous call threw', async () => {
    resetDirectProbeStateForTests();
    let attempt = 0;
    const arch = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('adapter transiently unavailable');
      return 'metal';
    });
    const deps = {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: arch,
      callEngine: async () => 'ok',
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    };

    const first = await runDirectProbe(baseRequest({ requestId: 'r1' }), deps);
    const second = await runDirectProbe(baseRequest({ requestId: 'r2' }), deps);

    expect(first.webgpuBackendDetected).toBeNull();
    // Second call retries the fetcher and caches the success.
    expect(arch).toHaveBeenCalledTimes(2);
    expect(second.webgpuBackendDetected).toBe('metal');

    // Third call reuses the cached success; fetcher not invoked again.
    const third = await runDirectProbe(baseRequest({ requestId: 'r3' }), deps);
    expect(arch).toHaveBeenCalledTimes(2);
    expect(third.webgpuBackendDetected).toBe('metal');
  });

  it('echoes probeName and requestId verbatim', async () => {
    resetDirectProbeStateForTests();
    const result = await runDirectProbe(
      baseRequest({ requestId: 'custom-id-42', probeName: 'adversarial_compliance' }),
      {
        isTestModeEnabled: async () => true,
        getGpuAdapterArchitecture: async () => 'metal',
        callEngine: async () => 'ok',
        getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        now: () => 0,
      },
    );

    expect(result.requestId).toBe('custom-id-42');
    expect(result.probeName).toBe('adversarial_compliance');
  });

  it('returns a generic error message when the engine throws a non-Error value', async () => {
    resetDirectProbeStateForTests();
    const result = await runDirectProbe(baseRequest(), {
      isTestModeEnabled: async () => true,
      getGpuAdapterArchitecture: async () => 'metal',
      callEngine: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string error';
      },
      getLoadedModelId: () => 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      now: () => 0,
    });

    expect(result.skipped).toBe(false);
    expect(result.errorMessage).toBe('string error');
  });
});
