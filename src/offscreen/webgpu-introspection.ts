/**
 * Pre-flight WebGPU adapter introspection (issue #49).
 *
 * `@mlc-ai/web-llm` assumes Core WebGPU. Chrome's WebGPU Compatibility
 * Mode (shipped Chrome 139+, chromestatus feature 6436406437871616) is
 * a strict subset that runs on older graphics APIs (OpenGL ES, D3D11) —
 * ~31% of Chrome-on-Windows users and ~23% of Android users only get a
 * compatibility-mode adapter. On those devices our MLC canaries fail
 * with no clear signal to the user.
 *
 * This module queries the adapter at engine-init time and exposes the
 * result as a structured `AdapterMode` that downstream diagnostics can
 * stamp on verdicts and the Phase 4E reach audit can tabulate.
 *
 * Kept in its own module so the probe logic can be unit-tested with a
 * mocked `navigator.gpu` without pulling the full engine module.
 */

export type AdapterMode =
  | 'core'           // Core WebGPU — MLC canaries should work
  | 'compatibility'  // Compat-mode only — MLC will fail; Nano may still work
  | 'none'           // No WebGPU at all — MLC unavailable
  | 'unknown';       // navigator.gpu exists but adapter query threw

export interface AdapterIntrospection {
  readonly mode: AdapterMode;
  /**
   * When `mode === 'core' | 'compatibility'`, the first few well-known
   * fields from `GPUAdapter.info` (vendor, architecture). Null on
   * `'none'` / `'unknown'`. Best-effort — `info` is a newer WebGPU
   * addition and may be absent on older Chrome.
   */
  readonly info: {
    readonly vendor: string | null;
    readonly architecture: string | null;
  } | null;
}

/**
 * Minimal structural types for navigator.gpu so this module doesn't
 * depend on the full WebGPU types being present in the test env.
 */
interface GPUAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
}
interface GPUAdapterLike {
  readonly info?: GPUAdapterInfoLike;
}
interface GPULike {
  requestAdapter(options?: { featureLevel?: 'core' | 'compatibility' }): Promise<GPUAdapterLike | null>;
}

export async function probeWebGPUAdapter(gpu: GPULike | undefined | null): Promise<AdapterIntrospection> {
  if (gpu === undefined || gpu === null) {
    return { mode: 'none', info: null };
  }
  // Try Core first — if it succeeds we know the device can run unrestricted
  // MLC. If it returns null, fall through to Compat which accepts a
  // wider device range (older GPUs, OpenGL ES backends).
  try {
    const core = await gpu.requestAdapter({ featureLevel: 'core' });
    if (core !== null) {
      return { mode: 'core', info: extractInfo(core) };
    }
  } catch {
    // Some Chrome builds throw instead of returning null for unsupported
    // featureLevel. Fall through to compat probe.
  }
  try {
    const compat = await gpu.requestAdapter({ featureLevel: 'compatibility' });
    if (compat !== null) {
      return { mode: 'compatibility', info: extractInfo(compat) };
    }
  } catch {
    // Same defensive handling — treat any error as "no compat adapter".
  }
  // Last-chance probe: `requestAdapter()` without featureLevel hint.
  // Some older Chrome builds don't accept featureLevel at all and the
  // calls above no-op. This path catches those and still produces a
  // 'core' signal for devices that happen to support it via the legacy
  // call shape.
  try {
    const legacy = await gpu.requestAdapter();
    if (legacy !== null) {
      return { mode: 'core', info: extractInfo(legacy) };
    }
  } catch {
    // Give up — treat as no WebGPU.
  }
  return { mode: 'unknown', info: null };
}

function extractInfo(adapter: GPUAdapterLike): AdapterIntrospection['info'] {
  if (adapter.info === undefined) return null;
  return {
    vendor: typeof adapter.info.vendor === 'string' ? adapter.info.vendor : null,
    architecture: typeof adapter.info.architecture === 'string' ? adapter.info.architecture : null,
  };
}
