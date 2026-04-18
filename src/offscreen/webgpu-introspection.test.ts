import { describe, it, expect, vi } from 'vitest';
import { probeWebGPUAdapter } from './webgpu-introspection.js';

function mockGpu(config: {
  core?: 'null' | 'throw' | 'ok';
  compat?: 'null' | 'throw' | 'ok';
  legacy?: 'null' | 'throw' | 'ok';
  coreInfo?: { vendor?: string; architecture?: string };
  compatInfo?: { vendor?: string; architecture?: string };
}) {
  const requestAdapter = vi.fn(async (options?: { featureLevel?: 'core' | 'compatibility' }) => {
    const level = options?.featureLevel;
    if (level === 'core') {
      if (config.core === 'throw') throw new Error('core throws');
      if (config.core === 'null' || config.core === undefined) return null;
      return { info: config.coreInfo };
    }
    if (level === 'compatibility') {
      if (config.compat === 'throw') throw new Error('compat throws');
      if (config.compat === 'null' || config.compat === undefined) return null;
      return { info: config.compatInfo };
    }
    // Legacy (no featureLevel)
    if (config.legacy === 'throw') throw new Error('legacy throws');
    if (config.legacy === 'null' || config.legacy === undefined) return null;
    return { info: undefined };
  });
  return { requestAdapter };
}

describe('probeWebGPUAdapter (issue #49)', () => {
  it('returns "none" when gpu is undefined', async () => {
    const result = await probeWebGPUAdapter(undefined);
    expect(result.mode).toBe('none');
    expect(result.info).toBeNull();
  });

  it('returns "none" when gpu is null', async () => {
    const result = await probeWebGPUAdapter(null);
    expect(result.mode).toBe('none');
  });

  it('returns "core" when requestAdapter({featureLevel: core}) succeeds', async () => {
    const gpu = mockGpu({
      core: 'ok',
      coreInfo: { vendor: 'Apple', architecture: 'apple-m' },
    });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('core');
    expect(result.info).toEqual({ vendor: 'Apple', architecture: 'apple-m' });
  });

  it('falls through to "compatibility" when core returns null', async () => {
    const gpu = mockGpu({
      core: 'null',
      compat: 'ok',
      compatInfo: { vendor: 'Intel', architecture: 'gen9' },
    });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('compatibility');
    expect(result.info).toEqual({ vendor: 'Intel', architecture: 'gen9' });
  });

  it('falls through to "compatibility" when core throws', async () => {
    const gpu = mockGpu({
      core: 'throw',
      compat: 'ok',
      compatInfo: { vendor: 'AMD' },
    });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('compatibility');
    expect(result.info?.vendor).toBe('AMD');
    expect(result.info?.architecture).toBeNull();
  });

  it('falls through to "core" (legacy no-featureLevel) when both core+compat return null', async () => {
    const gpu = mockGpu({ core: 'null', compat: 'null', legacy: 'ok' });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('core');
  });

  it('returns "unknown" when every probe path fails / returns null', async () => {
    const gpu = mockGpu({ core: 'null', compat: 'null', legacy: 'null' });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('unknown');
    expect(result.info).toBeNull();
  });

  it('returns "unknown" when every probe path throws', async () => {
    const gpu = mockGpu({ core: 'throw', compat: 'throw', legacy: 'throw' });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('unknown');
  });

  it('handles missing adapter.info gracefully', async () => {
    const gpu = mockGpu({ core: 'ok' }); // no coreInfo
    const result = await probeWebGPUAdapter(gpu);
    expect(result.mode).toBe('core');
    expect(result.info).toBeNull();
  });

  it('extracts partial adapter.info when some fields are missing', async () => {
    const gpu = mockGpu({
      core: 'ok',
      coreInfo: { vendor: 'Apple' }, // no architecture
    });
    const result = await probeWebGPUAdapter(gpu);
    expect(result.info).toEqual({ vendor: 'Apple', architecture: null });
  });
});
