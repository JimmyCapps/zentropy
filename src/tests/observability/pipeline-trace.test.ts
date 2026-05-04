import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LogEntry } from '@/shared/logger.js';
import { setLogLevel, resetLoggerForTests, setLogSink } from '@/shared/logger.js';
import { runHunters } from '@/hunters/hunt-runner.js';
import { spiderHunter } from '@/hunters/spider/index.js';
import { hawkHunter } from '@/hunters/hawk/index.js';

describe('pipeline-trace observability', () => {
  let capturedEntries: LogEntry[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    resetLoggerForTests();
    setLogLevel('debug');
    capturedEntries = [];

    // Capture all log entries via the sink
    setLogSink((entry: LogEntry) => {
      capturedEntries.push(entry);
    });
  });

  it('emits hunter_run:spider event when Spider hunter executes', async () => {
    const text = 'Click here to verify your account NOW!';

    await runHunters([spiderHunter], text);

    // Extract hunter_run messages
    const hunterMessages = capturedEntries
      .map((entry) => entry.message)
      .filter((msg) => msg.includes('hunter_run'));

    expect(hunterMessages.length).toBeGreaterThan(0);
    expect(hunterMessages.some((msg) => msg.includes('hunter_run:spider'))).toBe(true);
  });

  it('emits hunter_run:hawk event when Hawk hunter executes', async () => {
    const text = 'Click here to verify your credentials. This is a phishing attempt.';

    capturedEntries = [];
    await runHunters([hawkHunter], text);

    const hunterMessages = capturedEntries
      .map((entry) => entry.message)
      .filter((msg) => msg.includes('hunter_run'));

    expect(hunterMessages.length).toBeGreaterThan(0);
    expect(hunterMessages.some((msg) => msg.includes('hunter_run:hawk'))).toBe(true);
  });

  it('emits hunter_run events for multiple hunters in sequence', async () => {
    const text = 'Verify your credentials now. Click the link to proceed.';

    capturedEntries = [];
    await runHunters([spiderHunter, hawkHunter], text);

    const hunterMessages = capturedEntries
      .map((entry) => entry.message)
      .filter((msg) => msg.includes('hunter_run'));

    expect(hunterMessages.length).toBeGreaterThanOrEqual(2);
    expect(hunterMessages.some((msg) => msg.includes('hunter_run:spider'))).toBe(true);
    expect(hunterMessages.some((msg) => msg.includes('hunter_run:hawk'))).toBe(true);
  });

  it('includes hunter metrics in observability logs', async () => {
    const text = 'Urgent: verify your password at https://phishing.fake';

    capturedEntries = [];
    await runHunters([spiderHunter, hawkHunter], text);

    const hunterLogs = capturedEntries.filter((entry) => entry.message.includes('hunter_run'));

    // Verify logs include metrics
    hunterLogs.forEach((log) => {
      expect(log.message).toMatch(/score=[\d.]+/);
      expect(log.message).toMatch(/confidence=[\d.]+/);
    });
  });
});
