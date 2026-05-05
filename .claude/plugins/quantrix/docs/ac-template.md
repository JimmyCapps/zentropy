# Issue-body AC template

Every sprint-driving issue MUST have these sections. `/sprint` pre-flight gate STOPs if missing.

## Template

```markdown
<issue body — what + why>

## Code AC (verified by /qa from diff)

- [ ] <concrete test gate>
- [ ] <regression coverage>

## Manual AC (verified by /te + /qa via artifact)

- [manual] · <action> · expect <outcome> · verify via <surface-map key>
- [manual] · <action> · expect <outcome> · verify via <surface-map key>
```

## Rules

### Multi-angle (mandatory)

≥2 ACs total across both sections. A buggy fix that satisfies one AC tends to fail another. Single-AC issues cannot be sprint-executed.

### Code AC

- **Concrete:** specific file, command, or measurable outcome.
- **Verifiable from diff:** `/qa` first pass checks each by inspecting the PR diff.
- Examples:
  - `src/hunters/embeddings/bricklink-regression.test.ts asserts cosine(<phrase>) < 0.85, passes in CI`
  - `Phase 2 byte-locked baseline (162 rows in inbrowser-results.json) byte-identical`
  - `npm run typecheck && npm test pass with no new failures`

### Manual AC

- Only required when manual testing applies (e.g. extension UI, browser smoke, OS-level integration).
- Format: `[manual] · <action> · expect <outcome> · verify via <surface-map key>`
- The verify clause MUST cite a key from the project's surfaces map. `/te` interpolates the verification command from that key.
- Examples:
  - `[manual] · Reload extension, hard-reload bricklink.com/v2/main.page · expect popup verdict CLEAN with no mitigations · verify via storage:honeyllm:last-verdict`
  - `[manual] · Open service worker console, run await chrome.storage.local.get('honeyllm:cache-telemetry') · expect count > 0 · verify via storage:honeyllm:cache-telemetry`

### Bounded (≤3 ACs per section recommended; never >5 total)

If you have >5 ACs, the work is too broad — split into multiple issues. The cap forces scope discipline.

### Companion test file

Issues with manual AC require a companion file at `docs/testing/manual-tests/<N.M>.md` (authored by `/sprint` during execution). The companion file contains the boundary-grouped step-by-step walkthrough that `/te` reads. Schema in `manual-test-template.md`.

## Why this discipline

- **AC before sprint** — agile alignment. Requirements (and how to measure success) exist before work starts. Prevents the agent from grading its own homework.
- **Code/Manual split** — different verification modalities. `/qa` reads diffs; `/te` walks user through actions. Mixing them in one section makes verification ambiguous.
- **Surface-map verify clause** — converts vague "verify cache populated" into runnable commands. Reduces user-interpretation false-positives.
- **Multi-angle** — structural defense against false positives. No single tool catches "AC was wrong by design"; multiple ACs from different angles do.
