#!/usr/bin/env tsx
/**
 * Backward-compat shim — delegates to scripts/build-harnesses.ts, which
 * builds all harness entry points (index + nano-harness). Kept so any
 * stale doc/memory references to `build-nano-harness.ts` continue to work.
 *
 * Usage:
 *   npx tsx scripts/build-nano-harness.ts
 */
await import('./build-harnesses.js');
