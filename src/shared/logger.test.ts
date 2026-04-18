import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, setLogLevel, resetLoggerForTests } from './logger.js';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLogLevel('debug');
    resetLoggerForTests();
  });

  it('creates a logger with context prefix that includes monotonic seq and timestamp', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('TestCtx');
    log.info('hello');
    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0]?.[0] as string;
    // Format: [HoneyLLM:TestCtx #1 t=<ms>ms] INFO: hello
    expect(call).toMatch(/^\[HoneyLLM:TestCtx #1 t=\d+(\.\d+)?ms\] INFO: hello$/);
  });

  it('increments seq monotonically across loggers and levels', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const a = createLogger('A');
    const b = createLogger('B');
    a.info('one');
    b.warn('two');
    a.info('three');

    const first = infoSpy.mock.calls[0]?.[0] as string;
    const second = warnSpy.mock.calls[0]?.[0] as string;
    const third = infoSpy.mock.calls[1]?.[0] as string;

    expect(first).toMatch(/#1 t=/);
    expect(second).toMatch(/#2 t=/);
    expect(third).toMatch(/#3 t=/);
  });

  it('respects log level filtering and does not consume seq for filtered records', () => {
    setLogLevel('warn');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('Test');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    const warnCall = warnSpy.mock.calls[0]?.[0] as string;
    const errorCall = errorSpy.mock.calls[0]?.[0] as string;
    expect(warnCall).toMatch(/#1 t=/);
    expect(errorCall).toMatch(/#2 t=/);
  });

  it('passes extra arguments through unchanged', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('Ctx');
    const err = new Error('boom');
    log.error('failed', err);
    expect(spy).toHaveBeenCalledOnce();
    const [prefix, passedErr] = spy.mock.calls[0] ?? [];
    expect(prefix).toMatch(/^\[HoneyLLM:Ctx #1 t=\d+(\.\d+)?ms\] ERROR: failed$/);
    expect(passedErr).toBe(err);
  });
});
