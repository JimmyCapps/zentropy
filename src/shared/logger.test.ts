import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, setLogLevel } from './logger.js';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLogLevel('debug');
  });

  it('creates a logger with context prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('TestCtx');
    log.info('hello');
    expect(spy).toHaveBeenCalledWith('[HoneyLLM:TestCtx] INFO: hello');
  });

  it('respects log level filtering', () => {
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
  });

  it('passes extra arguments through', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('Ctx');
    const err = new Error('boom');
    log.error('failed', err);
    expect(spy).toHaveBeenCalledWith('[HoneyLLM:Ctx] ERROR: failed', err);
  });
});
