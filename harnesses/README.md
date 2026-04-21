# Phase 4 Stage 4C — Manual Nano Harness

Runs the 9-input × 3-probe affected-baseline sweep against Chrome's Gemini Nano (`window.LanguageModel`). Because Nano is EPP-gated and Chrome-only (not available in Chromium), the Playwright automation approach from Track A couldn't reach it — this harness fills the gap by running in your real Chrome profile.

## One-time prep (your Chrome profile)

1. Make sure your Chrome profile is enrolled in the Gemini Nano EPP. If `window.LanguageModel` is undefined in your main Chrome, you're not enrolled.
2. In that Chrome profile, enable both flags:
   - `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
   - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Restart Chrome, then go to `chrome://components` and wait for the "Optimization Guide On Device Model" component to update (~1–2 GB download, needs network).
4. Verify: open DevTools in any tab and run `await LanguageModel.availability()`. Should return `'available'`. If it returns `'downloading'` or `'downloadable'`, wait for the component to finish.

## Each run

From the repo root:

```bash
# Build the harness (only needed after edits to nano-harness.ts)
npx tsx scripts/build-nano-harness.ts

# Serve the harnesses over loopback http and open the nano page
npm run harness:nano
```

`harness:serve` binds to `127.0.0.1:8765` only. The extension's content script
early-returns on that host, so it stays out of the way while the harness
talks to `window.LanguageModel` directly.

In **real Chrome** (the EPP-enrolled profile):

1. The nano page opens automatically at `http://127.0.0.1:8765/nano-harness.html`.
2. The Availability card should read `available` in green.
3. Click **Start sweep (27 cells)**. Runs ~1–2 minutes.
4. When the progress bar hits 100%, click **Download results.json**.
5. Note the downloaded file path (default `~/Downloads/nano-affected-baseline-YYYY-MM-DD.json`).

Stop the server (`Ctrl+C`). Back in the Claude Code terminal:

```bash
# Dry run — verify the merge plan before touching the canonical file
npx tsx scripts/merge-nano-harness.ts ~/Downloads/nano-affected-baseline-YYYY-MM-DD.json --dry-run

# Apply
npx tsx scripts/merge-nano-harness.ts ~/Downloads/nano-affected-baseline-YYYY-MM-DD.json
```

`git diff docs/testing/inbrowser-results-affected.json` should now show 27 Nano rows added. Commit when happy.

## What gets produced

The downloaded JSON has `schema_version: "3.1"` and `methodology: "manual-chrome-builtin-epp"`. Each row matches the `AffectedRow` shape used by `scripts/run-affected-baseline.ts` — same fields, same types, compatible with Stage 7c's `annotate-fp-review-affected.ts` manual-FP curation flow used for 4C.2.

Fields specific to this path:
- `engine_runtime: "chrome-builtin-prompt-api"`
- `engine_model: "chrome-builtin-gemini-nano"`
- `builtin_api_availability: "available"` (or `"unavailable"` / `"downloading"` on failure)
- `webgpu_backend_detected: null` (Nano is not WebGPU)
- `runtime_delta_ms_vs_native_phase2: null` (no native Phase 2 Nano baseline exists — Phase 2's Nano runner was the placeholder in `scripts/run-gemini-nano-baseline.ts`)
- `first_load_ms` set only on the first successful cell of the sweep; null thereafter

## Troubleshooting

- **"API absent" in the Availability card.** Your Chrome profile is not EPP-enrolled, or the flags are not enabled. Follow the one-time prep above.
- **`availability: 'downloading'` or `'downloadable'`.** The model component is still being fetched in the background. Visit `chrome://components`, click "Check for update" on "Optimization Guide On Device Model", wait, then reload the harness tab.
- **`prompt()` throws mid-sweep.** The harness records the error on that row (`error_message` set), continues to the next cell. Review the downloaded JSON — errored rows can be hand-fixed or re-run by refreshing the harness page and clicking Start again (all 27 cells restart; partial resume isn't supported).
- **Loading via `file://` doesn't work.** Chrome blocks ES module imports and sibling `fetch()` from `file://`. Use `npm run harness:nano` per the instructions above.
