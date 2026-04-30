/**
 * Engine health probe (issue #17).
 *
 * Phase 4B.3 added single-flight init + a ready gate so concurrent probe
 * callers no longer race on cold-start. But "init resolved" is not the
 * same as "model inference returns output" — we've previously seen MLC
 * return an adapter that yields empty strings on its first real call
 * (see docs/testing/phase4/mlc-root-cause.md §Open items).
 *
 * Running a one-token dummy inference at init time catches that
 * degenerate case immediately and lets the engine-level fallback chain
 * (MODEL_PRIMARY → MODEL_FALLBACK) route around a broken primary
 * instead of blowing up the first user-triggered probe.
 *
 * Split out of `engine.ts` so it can be unit-tested without pulling in
 * the @mlc-ai/web-llm dependency tree.
 */

interface HealthProbeEngine {
  generate(systemPrompt: string, userMessage: string): Promise<string>;
}

const HEALTH_PROBE_SYSTEM_PROMPT = '';
const HEALTH_PROBE_USER_PROMPT = 'ping';

/**
 * Returns true when the engine produces non-empty output for a trivial
 * "ping" prompt. Catches both thrown errors and silent-empty returns.
 */
export async function runEngineHealthProbe(engine: HealthProbeEngine): Promise<boolean> {
  try {
    const reply = await engine.generate(HEALTH_PROBE_SYSTEM_PROMPT, HEALTH_PROBE_USER_PROMPT);
    return reply.trim().length > 0;
  } catch {
    return false;
  }
}
