# Sprint 5 — Wolf canary + Nano refinements + #119 (Days 13-15)

**Theme:** Implement Wolf canary's refusal-as-detection pipeline, wire into tier-router, ship #60 + #119. **Tag:** none. **Recommended model:** `claude-sonnet-4-6`, effort medium.

Master plan: [`../v0.1-completion.md` Sprint 5](../v0.1-completion.md#sprint-5-days-1315-wolf-canary--nano-refinements--119). Tracking: epic #248.

---

## Pre-flight checklist

- [ ] Model: `claude-sonnet-4-6` (medium effort). Wolf needs solid reasoning on refusal patterns but not Opus.
- [ ] Plugins: baseline + `chrome-devtools-mcp` for Llama-3.2-1B WebGPU debugging if needed.
- [ ] Repo state: Wolf scaffold from Sprint 4 on main; DM-A/E/F/G all merged.

```bash
cd "$(git rev-parse --show-toplevel)" && claude --model claude-sonnet-4-6 --effort medium --remote-control --chrome --dangerously-skip-permissions
```

---

## Item 5.1 — #3 Wolf stage 2: refusal-as-detection pipeline

**Kickoff prompt:**
```
Execute Sprint 5 item 5.1 (#3 Wolf stage 2) per docs/plans/v0.1-completion.md Sprint 5 §5.1. Pre-req: Wolf scaffold on main from Sprint 4 §4.5. Build src/analysis/wolf-refusal-analyzer.ts: when Wolf returns text containing "I can't / I won't / I'm sorry / I cannot / This appears to be / I don't think I should" (refusal markers) IN RESPONSE TO a chunk that does NOT have explicit suspicious markers (per the existing instruction-detection probe), treat as a Wolf detection signal. TDD: 12 cases — refusal-on-clean (signal), refusal-on-injection (signal), compliance-on-clean (no signal), compliance-on-injection (no signal — Wolf doesn't catch this case; that's other hunters' job), edge cases (refusal language inside a code block, multi-language refusals, partial refusals). Branch feat/issue-3-wolf-stage-2.
```

**Validation:**
- `npm test` includes 12 wolf-refusal-analyzer tests; all pass
- `gh pr view <N> --json state -q '.state'` → `MERGED`
- #3 stays open (stages 3-4 still pending)

---

## Item 5.2 — #3 Wolf stage 3: tier-router integration + scoring

**Kickoff prompt:**
```
Execute Sprint 5 item 5.2 (#3 Wolf stage 3) per docs/plans/v0.1-completion.md Sprint 5 §5.2. Pre-req: §5.1 merged. Wire Wolf into tier-router as third-canary path. SCORE_WOLF_REFUSAL = 30 added to src/shared/constants.ts. Wolf signal stacks with Spider/Hawk/embeddings/DetermiLLM. **HARD GATE: Phase 2 byte-locked baseline byte-identical when Wolf is NOT the selected canary** (default canary stays Gemma; Wolf only fires when explicitly selected via the canary chooser). TDD: 8 cases — Wolf-selected dispatches Wolf, Gemma-selected does not, scoring delta in tier-router when Wolf flags, no scoring delta when Wolf is silent, regression on the existing 162-row baseline under Gemma. Branch feat/issue-3-wolf-stage-3.
```

**Validation:**
- `npm test` passes including baseline regression tests
- `git diff main~1 -- docs/testing/inbrowser-results.json` shows zero diff
- #3 stays open (stage 4 in Sprint 6)

---

## Item 5.3 — #60 Nano in-chunk abort signal

**Kickoff prompt:**
```
Execute Sprint 5 item 5.3 (#60 Nano in-chunk abort) per docs/plans/v0.1-completion.md Sprint 5 §5.3. Thread AbortSignal into LanguageModel.session.prompt({signal}) in src/offscreen/canaries/nano-canary.ts. Allows in-chunk abort when the chunk-cap from #210 is exceeded mid-flight. TDD: 6 cases — signal-not-set (passes through), signal-aborted-before (rejects fast), signal-aborted-during (cancels), multiple-aborts-idempotent, abort-error-classification (don't surface as analysisError; surface as 'aborted' status), survival of fast cancellations on the next-chunk path. Branch feat/issue-60-nano-abort-signal.
```

**Validation:**
- `gh issue view 60 --json state -q '.state'` → `CLOSED`
- 6 new tests pass

---

## Item 5.4 — #119 xlm-roberta language-detection fallback (full impl)

**What:** Replace the graceful-fallback stub at `src/hunters/hawk/language-router.ts:33` with full xlm-roberta language detection via transformers.js. Sprint 2's #124 maintainer smoke confirmed Browse MCP Stage 5 ships, so the consumer exists.

**Kickoff prompt:**
```
Execute Sprint 5 item 5.4 (#119 xlm-roberta full impl) per docs/plans/v0.1-completion.md Sprint 5 §5.4. Pre-req: #124 Browse MCP smoke complete (Sprint 2). Replace the graceful-fallback stub at src/hunters/hawk/language-router.ts:33 with full xlm-roberta language detection via transformers.js. Reuse the bundling pattern from #156 (NER engine) and #129 (embeddings) — copy prebuilt browser bundle + chrome.runtime.getURL; do NOT bundle via Vite (per project memory rule transformersjs_bundling). Anchors: src/offscreen/ner-engine.ts (singleton + factory DI seam pattern), src/offscreen/embedding-engine.ts. TDD: 10 cases — en/es/zh-CN/de/fr detection accuracy, multilingual page handling, empty-string defensive, model-load-failure graceful fallback to existing stub behaviour. Branch feat/issue-119-xlm-roberta-full.
```

**Validation:**
- `gh issue view 119 --json state -q '.state'` → `CLOSED`
- `npm test` includes 10 new language-router tests
- `npm run build`; `dist/` size delta < 50 MB (xlm-roberta is ~280 MB unquantised; q8 should land near 70 MB; verify acceptable)

---

## Sprint 5 close-out

1. Epic #248: Sprint 5 ✅ DONE.
2. Spillover: if Wolf integration surfaced bugs in Spider/Hawk hunter wiring, document on those issues.
3. Open Sprint 6: [`sprint-6-tag-v0.3.md`](sprint-6-tag-v0.3.md).
