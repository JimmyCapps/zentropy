# HoneyLLM

**Client-side prompt injection detection for the browser.**

HoneyLLM is a Chrome extension that detects prompt injection attacks and malicious page instructions targeting Large Language Models. It runs three LLM-based security probes entirely on-device using WebGPU, keeping your browsing data private while protecting against adversarial content.

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

- **LLM Inference** — [MLC-LLM](https://mlc.ai/) via WebGPU (Phi-3-mini-4k-instruct, TinyLlama fallback)
- **Extension** — Chrome Manifest V3 with offscreen document API
- **Build** — Vite + custom multi-format build script
- **Language** — TypeScript (strict mode)
- **Testing** — Vitest (unit) + Playwright (E2E)

## License

[MIT](LICENSE)
