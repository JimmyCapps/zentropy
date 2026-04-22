# HoneyLLM Harnesses

Internal browser-based tools for HoneyLLM testing. Not deployed publicly.

## One-time prep (Chrome profile for Nano tests)

1. Make sure your Chrome profile is enrolled in the Gemini Nano EPP. If `window.LanguageModel` is undefined in your main Chrome, you're not enrolled.
2. Enable both flags:
   - `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
   - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Restart Chrome, then visit `chrome://components` and wait for the "Optimization Guide On Device Model" component to update (~1–2 GB download).
4. Verify: `await LanguageModel.availability()` in any DevTools console should return `'available'`.

## Running the harnesses

```bash
# Open the unified Test Console (S1 → S4 in one app)
npm run harness

# Or deep-link to a specific page
npm run harness:nano      # → #/s2-nano
```

`harness:serve` binds to `127.0.0.1:8765` only (loopback). The HoneyLLM content script early-returns on that host, so the extension stays out of the way while the harness talks to `window.LanguageModel` directly.

Each section has its own hash URL:

| Route | Purpose |
|---|---|
| `#/s1` | Prereqs — fixture host + Chrome baseline |
| `#/s2-baseline` | Chrome S2.1 browser compat row (issue #8) |
| `#/s2-nano` | Nano replicate sweep (issue #14) — 9×3×N runs, resumable |
| `#/s3-claude` | Claude-in-Chrome B5 matrix (issue #2) |
| `#/s3-chatgpt` | ChatGPT Agent Mode B5 matrix |
| `#/s3-gemini` | Gemini Agent B5 matrix |
| `#/s4` | Non-Chrome browser compat (informational) |

Standalone pages (focused tools, shared nav/CSS with the console):

- `nano-harness.html` — the original Stage 4C sweep, no persistence.
- `summarizer-harness.html` — #47 Summarizer API vs Prompt API comparison.
- `issue-graph.html` — agent-maintained issue/PR overlay (`npm run graph` to refresh + open).

## Nano sweep merge flow

After downloading `nano-affected-baseline-YYYY-MM-DD.json` from the console:

```bash
# Dry run — verify the merge plan before touching the canonical file
npx tsx scripts/merge-nano-harness.ts ~/Downloads/nano-affected-baseline-YYYY-MM-DD.json --dry-run

# Apply
npx tsx scripts/merge-nano-harness.ts ~/Downloads/nano-affected-baseline-YYYY-MM-DD.json
```

`git diff docs/testing/inbrowser-results-affected.json` should show 27 Nano rows added (or 135 for a 5-replicate sweep). Commit when happy.

## Output shape

The downloaded JSON has `schema_version: "3.1"` (or `"3.1-replicates"` when replicates > 1) and `methodology: "manual-chrome-builtin-epp"`. Each row matches the `AffectedRow` shape used by `scripts/run-affected-baseline.ts` — same fields, same types, compatible with Stage 7c's `annotate-fp-review-affected.ts` flow.

Fields specific to this path:
- `engine_runtime: "chrome-builtin-prompt-api"`
- `engine_model: "chrome-builtin-gemini-nano"`
- `builtin_api_availability: "available"` (or `"unavailable"` / `"downloading"` on failure)
- `webgpu_backend_detected: null` (Nano is not WebGPU)
- `runtime_delta_ms_vs_native_phase2: null`
- `first_load_ms` set only on the first successful cell of the sweep; null thereafter

## Troubleshooting

- **"API absent" in the Availability card.** Chrome profile not EPP-enrolled, or flags not enabled. See prep above.
- **`availability: 'downloading'` or `'downloadable'`.** Component is still being fetched. Visit `chrome://components`, click "Check for update" on "Optimization Guide On Device Model", wait, reload.
- **`prompt()` throws mid-sweep.** Error recorded on that row, sweep continues. With persistence, reloading shows a Resume button picking up from the next cell.
- **Loading via `file://` doesn't work.** Chrome blocks ES module imports and sibling `fetch()` from `file://`. Use `npm run harness` per above.
- **Amber Start button on the Nano page.** Means contention was detected — either another sweep is running in a different tab, or the HoneyLLM extension is currently analysing another page. You can still start; rows captured under contention will be flagged in the export for filtering downstream.
