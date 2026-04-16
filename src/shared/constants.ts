export const MODEL_PRIMARY = 'Phi-3-mini-4k-instruct-q4f16_1-MLC';
export const MODEL_FALLBACK = 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC';

export const MAX_CHUNK_TOKENS = 3500;
export const APPROX_CHARS_PER_TOKEN = 4;
export const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

export const MAX_VISIBLE_TEXT_CHARS = 50_000;
export const MAX_HIDDEN_TEXT_CHARS = 10_000;
export const SCRIPT_PREVIEW_LENGTH = 200;

export const KEEPALIVE_ALARM_NAME = 'honeyllm-keepalive';
export const KEEPALIVE_ALARM_PERIOD_SECONDS = 24;
export const CONTENT_PING_INTERVAL_MS = 20_000;

export const OFFSCREEN_URL = 'dist/offscreen/offscreen.html';
export const OFFSCREEN_REASON = 'WORKERS' as chrome.offscreen.Reason;

export const SCORE_SUMMARIZATION_ANOMALY = 20;
export const SCORE_INSTRUCTION_DETECTION = 40;
export const SCORE_ADVERSARIAL_DIVERGENCE = 30;
export const SCORE_ROLE_DRIFT = 15;
export const SCORE_EXFILTRATION_INTENT = 25;
export const SCORE_HIDDEN_CONTENT_INSTRUCTIONS = 20;

export const THRESHOLD_SUSPICIOUS = 30;
export const THRESHOLD_COMPROMISED = 65;

export const STORAGE_KEY_PREFIX = 'honeyllm:verdict:';
export const STORAGE_KEY_ENGINE = 'honeyllm:engine';
export const STORAGE_KEY_MODEL = 'honeyllm:model';

// Test-only gate. When `chrome.storage.sync[STORAGE_KEY_TEST_MODE]` is
// strictly `true`, Phase 3 Track A handlers (`RUN_PROBES_DIRECT` in offscreen,
// `RUN_PROBES_BUILTIN` in the builtin-harness page) will accept requests.
// Absent or any non-true value => handlers are inert. Never persisted by
// production code; the Playwright runner toggles it for the duration of a
// sweep and unsets it afterwards.
export const STORAGE_KEY_TEST_MODE = 'honeyllm:test-mode';
