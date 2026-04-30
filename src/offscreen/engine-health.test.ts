import { describe, it, expect, vi } from 'vitest';
import { runEngineHealthProbe } from './engine-health.js';

interface FakeEngine {
  id: string;
  generate: (system: string, user: string) => Promise<string>;
}

function makeEngine(id: string, response: string | (() => Promise<string>)): FakeEngine {
  return {
    id,
    generate: typeof response === 'function'
      ? vi.fn(response)
      : vi.fn(async () => response),
  };
}

describe('runEngineHealthProbe (issue #17)', () => {
  it('returns true when generate yields non-empty output', async () => {
    const engine = makeEngine('test-model', 'pong');
    const ok = await runEngineHealthProbe(engine);
    expect(ok).toBe(true);
  });

  it('returns false when generate yields empty string', async () => {
    const engine = makeEngine('broken-model', '');
    const ok = await runEngineHealthProbe(engine);
    expect(ok).toBe(false);
  });

  it('returns false when generate yields whitespace-only output', async () => {
    const engine = makeEngine('lazy-model', '   \n\t  ');
    const ok = await runEngineHealthProbe(engine);
    expect(ok).toBe(false);
  });

  it('returns false when generate throws', async () => {
    const engine = makeEngine('throwing-model', async () => {
      throw new Error('engine exploded');
    });
    const ok = await runEngineHealthProbe(engine);
    expect(ok).toBe(false);
  });

  it('calls generate exactly once with a minimal ping prompt', async () => {
    const engine = makeEngine('counted-model', 'pong');
    await runEngineHealthProbe(engine);
    expect(engine.generate).toHaveBeenCalledTimes(1);
    const [systemPrompt, userMessage] = (engine.generate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(typeof systemPrompt).toBe('string');
    expect(typeof userMessage).toBe('string');
    expect(userMessage.length).toBeGreaterThan(0);
  });
});
