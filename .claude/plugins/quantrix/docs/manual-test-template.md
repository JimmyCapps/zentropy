# Manual test companion-file template

Path: `docs/testing/manual-tests/<N.M>.md` (path configurable via `plugin.json` → `config.manualTestsDir`).

`/sprint` authors this file when manual AC exists. `/te` reads it.

## Template

```markdown
# Manual test plan — Sprint <N.M>

**Originating issue:** #<orig>
**Manual AC** (from issue body):
- [manual] · <action> · expect <outcome> · verify via <surface-map key>
- [manual] · <action> · expect <outcome> · verify via <surface-map key>

**Test environment:**
- Browser: <Chrome stable | EPP-enrolled Chrome | Firefox | ...>
- Build: <npm run build target>
- Extension ID: <if applicable>
- Other prerequisites: <hardware, network, account, ...>

---

## Parent step 1 — <name, e.g. "Setup">

<one-paragraph context for this group of sub-steps; what the user is achieving in this group>

### Sub-step 1.1 — <action verb-object>

**Action:** <single concrete action>
**Expected:** <observable outcome>
**Verify via:** <surface-map key | direct observation>
**Verification command:** <if interpolated from surface map; e.g. await chrome.storage.local.get('honeyllm:cache-telemetry')>

### Sub-step 1.2 — <action verb-object>

...

### Sub-step 1.N — <action verb-object>

...

---

## Parent step 2 — <name>

...

---

## Final verification

<what the artifact captures: PASS condition, any cross-step invariants>
```

## Rules

### Boundary structure

- **One parent step rendered at a time** by `/te`. The user never sees parent step 2 until step 1 is fully complete.
- **≤10 sub-steps per parent.** Upper cap, not target. If a logical group has 4 sub-steps, leave it at 4 — don't pad. If it needs >10, split the parent.
- Sub-steps grouped by **logical boundary**, not by count. "Setup", "Scan 1", "Scan 2", "Scan 3", "Verification" — each is a parent.

### Step content (mandatory fields)

Every sub-step has all four:
- **Action** — single concrete imperative ("Open the popup", "Click 'Re-scan'", "Run `await ...`")
- **Expected** — observable outcome the user can verify
- **Verify via** — surface-map key OR `direct observation` if no map entry applies
- **Verification command** — interpolated from surface map when applicable

`/te` refuses to render a sub-step missing any field — returns FAIL with `underspecified manual test step at <N.M> step <X.Y>; amend companion file`.

### Unambiguous language

- No abbreviations or jargon without inline definition.
- No "as you know" / "obviously" / "just" — assume the user is following blind.
- No multi-action sub-steps. "Open popup AND click re-scan" → split into two sub-steps.

### Why explicit and verbose

User running step 39 of 60 should not have to debug their own confusion. The cost of a redundant clarification is low; the cost of a misinterpreted step (false-pass or false-fail) is high (wasted manual-test time, polluted artifact, /ts spin-up).

## Example

See `examples/honeyllm-1.5-manual-test.example.md` (created when sprint 1.5 lands; placeholder until then).
