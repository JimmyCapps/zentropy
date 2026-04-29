// Issue #126 (N7a) — portal-observer timing constants. Per-portal
// adapters can tune at the call site if experimentation reveals
// divergence; defaults here are universal across ChatGPT / Claude /
// Gemini based on the chat-portal track's hybrid stream-end design
// (see plan §D5).

/**
 * How long the debouncer waits after the last DOM mutation on the
 * response container before firing CapturedResponse. 600 ms is empirically
 * past most ChatGPT mid-stream backpressure gaps, and short enough to
 * land before user attention shifts to the popup.
 */
export const STREAM_END_DEBOUNCE_MS = 600;

/**
 * Hard ceiling on debounce wait. If a single response keeps mutating
 * for this long without a completion-marker DOM signal (Gemini occasionally
 * does, on long generations), force-fire and continue observing for
 * subsequent mutations. Prevents pathological never-fires.
 */
export const MAX_DEBOUNCE_LATENCY_MS = 5000;

/**
 * If no captures land within this window after attaching the observer,
 * log a one-shot console.warn so a developer can see selector regression
 * before the user notices. Confined to console — no UI, no telemetry
 * spam.
 */
export const SELECTOR_REGRESSION_WARN_AFTER_MS = 30_000;
