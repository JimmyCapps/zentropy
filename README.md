# HoneyLLM

**Client-side prompt injection detection for the browser.**

HoneyLLM is a Chrome extension that detects prompt injection attacks and malicious page instructions targeting Large Language Models. It runs three LLM-based security probes entirely on-device using WebGPU or Chrome's built-in Gemini Nano, keeping your browsing data private while protecting against adversarial content.

## Status

**Primary canary (MLC WebGPU path):** Gemma-2-2b-it-q4f16_1-MLC — shipped at commit `484973e` per Phase 3 Track A §7 SHIP decision. Fast-path fallback: Qwen2.5-0.5B.

**Phase 3 Track B (live-browser regression testing):** automatable sweep shipped at `6894bb9`. Manual production-LLM leg (B5) blocked behind fixture-host + two bug fixes, both resolved in Phase 4 — see below. Re-run verified clean at `3b2feea` (Phase 4 Stage 4B.3).

**Phase 4 (production-path hardening + Nano evaluation + dual-path canary):**
- **4A** (`5721fbf`) — probe-error propagation; replaces the `probe_error`-as-flag sentinel with structured `errorMessage` / `analysisError` fields and an UNKNOWN verdict status. Fixes a silent false-negative where MLC engine failures produced CLEAN+confidence=1.0.
- **4B** (`1c6ce78` + `3b2feea` + docs `d45974c`) — chunk serialization + `MAX_CHUNKS_PER_PAGE` cap + single-flight `initEngine` + RUN_PROBES engine-ready gate. Resolves an init race that was masking as an MLC state bug.
- **4C** (`57c2c01` + `a52e976` + `1e4e2b4`) — Gemini Nano affected-baseline (27 real rows via a manual EPP-Chrome harness), manual FP curation, and Nano-vs-Gemma comparison addendum. Nano-as-canary validated for EPP-enrolled users.
- **4D** — dual-path canary architecture (user-managed selection, toolbar icon state, canary-themed assets). In progress.
- **4E–4G** — Chromium-family compatibility audit, Track B resumption (B5 + B7 report), image-injection multimodal probe. Scheduled.

See `/Users/node3/.claude/plans/honeyllm-phase-4.md` for the full Phase 4 plan.

## How It Works

When you visit a page, HoneyLLM silently analyzes its content through a multi-stage pipeline:

```
Page Load
  → Content script extracts visible text, hidden DOM, script fingerprints, metadata
  → Service worker chunks content (14K chars per chunk)
  → Offscreen document runs 3 LLM probes per chunk via WebGPU
  → Behavioral analyzer detects role drift, exfiltration intent, instruction compliance
  → Policy engine scores results → CLEAN | SUSPICIOUS | COMPROMISED
  → Mitigations activate: DOM sanitization, network guard, redirect blocker
  → Verdict exposed via window globals and meta tags for LLM-aware apps
```

## Features

### Three-Probe Detection System

| Probe | What It Tests | Max Score |
|-------|--------------|-----------|
| **Summarization** | Can the LLM ignore embedded instructions and stick to summarization? Detects AI self-reference, URLs, action instructions, role adoption, exfiltration patterns | 20 |
| **Instruction Detection** | Does the page contain hidden instructions targeting AI systems? Detects role reassignment, jailbreak attempts, encoded commands, data exfiltration directives | 40 |
| **Adversarial Compliance** | Will the LLM follow malicious instructions when explicitly invited? Measures divergence signals with weighted scoring across 9 categories | 30 |

### Behavioral Analysis

- **Role Drift** — detects LLM adopting attacker-provided personas ("DAN mode", "unrestricted mode")
- **Exfiltration Intent** — detects webhook URLs, fetch/XHR calls, credential theft, encoded data exfiltration
- **Instruction Following** — compares probe outputs using Jaccard similarity to detect behavioral divergence
- **Hidden Content Awareness** — flags pages where injection probes found hidden instructions

### Active Mitigations

- **DOM Sanitizer** — removes hidden elements containing injection keywords
- **Network Guard** — intercepts and blocks fetch/XHR requests to known exfiltration domains (webhook.site, ngrok, pipedream, requestbin, etc.)
- **Redirect Blocker** — prevents malicious page navigation on compromised verdicts

### Signaling

Exposes verdict to page scripts and LLM-aware applications via:
- `window.__AI_SITE_STATUS__` — current security status
- `window.__AI_SECURITY_REPORT__` — full analysis report
- `<meta name="ai-security-status">` — DOM-level signal

## Scoring

| Signal | Points |
|--------|--------|
| Summarization anomaly | +20 |
| Instruction detection | +40 |
| Adversarial divergence | +30 |
| Role drift | +15 |
| Exfiltration intent | +25 |
| Hidden content instructions | +20 |
| **Max possible** | **150** |

| Verdict | Score Range | Mitigations |
|---------|------------|-------------|
| CLEAN | 0–29 | None |
| SUSPICIOUS | 30–64 | DOM sanitization |
| COMPROMISED | 65+ | DOM sanitization + network guard + redirect blocker |

## Installation

### From Source

```bash
git clone https://github.com/JimmyCapps/zentropy.git
cd zentropy
npm install
npm run build
```

Then load the extension in Chrome:

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` directory

### Requirements

- Chrome 113+ (WebGPU support required)
- GPU with WebGPU capability
- ~2 GB free memory for model inference

## Development

```bash
# Watch mode — rebuilds on file changes
npm run dev

# Type checking
npm run typecheck

# Unit tests (Vitest)
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (Playwright)
npm run test:e2e

# Production build
npm run build
```

### Build System

The project uses a custom multi-entry build script (`build.ts`) that produces format-specific bundles:

- **IIFE** — content scripts and popup (isolated execution contexts)
- **ES modules** — service worker and offscreen document

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical reference.

```
src/
├── content/           # Content script (runs in every page)
│   ├── ingestion/     # Page data extraction (visible, hidden, scripts, metadata)
│   ├── mitigation/    # Active defenses (DOM sanitizer, network guard, redirect blocker)
│   ├── signaling/     # Verdict exposure (window globals, meta tags)
│   ├── index.ts       # Content script entry point
│   └── main-world-inject.ts  # Main world fetch/XHR interception
├── service-worker/    # Background orchestration
│   ├── index.ts       # Lifecycle events and message routing
│   ├── orchestrator.ts # Analysis pipeline (chunking, merging, verdict)
│   ├── keepalive.ts   # Service worker persistence
│   └── offscreen-manager.ts  # Offscreen document lifecycle
├── offscreen/         # LLM inference context
│   ├── engine.ts      # MLC-LLM WebGPU engine (Phi-3-mini / TinyLlama fallback)
│   ├── probe-runner.ts # Sequential probe execution
│   └── index.ts       # Message handler
├── probes/            # LLM-based detection probes
│   ├── base-probe.ts  # Probe interface
│   ├── summarization.ts
│   ├── instruction-detection.ts
│   └── adversarial-compliance.ts
├── analysis/          # Post-probe behavioral analysis
│   ├── behavioral-analyzer.ts  # Orchestrator
│   ├── role-drift.ts
│   ├── exfiltration.ts
│   └── instruction-following.ts
├── policy/            # Scoring and verdict generation
│   ├── engine.ts      # Score → verdict mapping
│   ├── rules.ts       # Weighted scoring rules
│   └── storage.ts     # Verdict persistence by origin
├── popup/             # Extension popup UI
├── types/             # TypeScript type definitions
│   ├── verdict.ts     # SecurityVerdict, ProbeResult
│   ├── snapshot.ts    # PageSnapshot, PageMetadata
│   └── messages.ts    # Inter-component message types
└── shared/            # Constants and utilities
```

## Tech Stack

- **LLM Inference (default)** — [MLC-LLM](https://mlc.ai/) via WebGPU (Gemma-2-2b-it primary, Qwen2.5-0.5B fast-path fallback, TinyLlama/Phi-3-mini legacy fallbacks). All on-device, private, cross-browser-compatible.
- **LLM Inference (Nano path, Phase 4)** — Chrome's built-in `window.LanguageModel` API (Gemini Nano). EPP-gated; available only in Google Chrome profiles enrolled in the Early Preview Program.
- **Extension** — Chrome Manifest V3 with offscreen document API.
- **Build** — Vite + custom multi-format build script (`build.ts`); esbuild for the standalone Nano harness.
- **Language** — TypeScript (strict mode).
- **Testing** — Vitest (unit, 230+ tests) + Playwright (E2E) + standalone HTML harnesses for EPP-gated paths.

## License

[MIT](LICENSE)
