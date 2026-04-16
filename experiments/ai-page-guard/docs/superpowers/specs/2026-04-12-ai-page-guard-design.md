# AI Page Guard — Design Spec

## Overview

Chrome Extension (Manifest V3) that acts as a client-side AI security layer protecting AI tools (Claude, Playwright, MCP) from consuming poisoned web content. Scans pages for prompt injection, hidden instructions, and malicious DOM content using a three-layer cascade: regex heuristics, Meta Prompt Guard 22M, and ProtectAI DeBERTa v3 (borderline only). Actively strips/masks threats from DOM and exposes a queryable signal for AI tools.

## Architecture

Offscreen Document approach — models loaded once, shared across all tabs.

```
Content Script (per tab)          Background Service Worker       Offscreen Document (singleton)
├─ MutationObserver               ├─ Message router               ├─ ONNX Runtime Web (WASM)
├─ Regex layer (sync, <5ms)       ├─ Badge manager                ├─ Prompt Guard 22M (~70-80MB)
├─ DOM strip/mask/neuter          ├─ Offscreen keepalive          └─ DeBERTa v3 (~83MB, lazy)
├─ Node tracking (data-ai-guard)  └─ Per-tab state (in memory)
└─ Signal API (window.__AI_SECURITY_REPORT__)
```

### Data Flow

1. Content script observes DOM mutations (childList, subtree, characterData, attributes)
2. Regex layer runs sync on new/changed nodes — strips immediately on match
3. Remaining text nodes (>20 chars) batched, debounced 500ms, sent to background
4. Background ensures offscreen exists, forwards batch
5. Offscreen runs Prompt Guard 22M → if borderline (0.3-0.85) → DeBERTa v3
6. Verdicts routed back to content script
7. Content script strips/masks nodes, updates signal API and badge

## Detection Pipeline

### Layer 1: Regex/Heuristic (Content Script)

Sync, runs on every MutationObserver callback.

Patterns:
- Prompt injection keywords: `ignore previous instructions`, `you are now`, `system prompt`, `disregard above`
- Hidden instruction markers: `<!-- inject:`, `[INST]`, `<|system|>`, `[/INST]`
- Base64 payloads: Base64 blobs >200 chars in text/attributes
- Invisible DOM: `display:none`, `opacity:0`, `font-size:0`, `position:absolute; left:-9999px` with text content
- Suspicious meta tags: `<meta>` with instruction-like content

Action: immediate strip. Tag node `data-ai-guard="blocked"`.

### Layer 2: Prompt Guard 22M (Offscreen)

- Input: text chunks, max 512 tokens, overlapping windows (480 stride, 32 overlap) for longer content
- Output: binary INJECTION/BENIGN with confidence 0.0-1.0
- Thresholds: >0.85 UNSAFE (strip), <0.30 SAFE (pass), 0.30-0.85 BORDERLINE (escalate)

### Layer 3: DeBERTa v3 (Offscreen, cascade only)

- Only runs on borderline content from Layer 2
- Loaded lazily on first borderline result
- Output: binary INJECTION/SAFE with confidence
- Final: >0.70 strip, <0.70 pass (flag as "uncertain"), models disagree at low confidence → advisory flag only

## Content Script

### MutationObserver Config

```js
{ childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] }
```

### Node Tracking

- `data-ai-guard="safe"` — passed all layers
- `data-ai-guard="blocked"` — stripped or masked
- `data-ai-guard="pending"` — queued for ONNX

### Mitigation Actions

- **Strip**: hidden prompt injection, invisible instructions → node removed
- **Mask**: visible malicious text → replaced with `[Content removed by AI Page Guard]`
- **Neuter**: suspicious inline scripts → content emptied, event handlers removed

### Signal API

Injected into page MAIN world:

```js
window.__AI_SECURITY_REPORT__ = {
  status: "clean" | "threats_found" | "scanning",
  url: location.href,
  scan_coverage: 0.0-1.0,
  threats: [{
    type: "prompt_injection",
    layer: "regex" | "prompt_guard" | "deberta",
    confidence: 0.92,
    action: "stripped" | "masked" | "neutered",
    snippet: "ignore previous instruct...",
    node_selector: "div.comment > p:nth-child(3)"
  }],
  pending_nodes: 0,
  last_scan: Date.now(),
  models_loaded: true
};
```

## Offscreen Document

### Lifecycle

- Created on first classification request (lazy)
- Reason: WORKERS (WASM execution)
- Kept alive via 25s heartbeat from background while tabs exist
- Recreated on crash

### Model Loading (lazy)

1. First classify request → load ONNX Runtime Web + Prompt Guard 22M + warmup
2. First borderline result → load DeBERTa v3 + warmup

### Message Protocol

Request: `{ type: "classify", tabId, chunks: [{ id, text, nodeSelector }] }`
Response: `{ type: "classify_result", tabId, results: [{ id, verdict, layer, confidence, action }] }`

### Error Handling

- Model load failure → badge yellow, status "degraded", regex still active
- Inference timeout (>5s) → skip, mark "timeout"
- Offscreen crash → background recreates, re-queues

## Background Service Worker

### Message Router

Routes classify requests from content scripts to offscreen, verdicts back to tabs.

### Badge

- Green "0" → clean
- Red + count → threats found
- Yellow "!" → degraded
- Grey "..." → scanning

### Per-Tab State (in memory)

```js
tabState[tabId] = { url, status, threats: [], pendingChunks, scanCoverage, lastScan }
```

### Offscreen Keepalive

25s interval heartbeat while tabs exist.

## PoC Scope (v0.1)

Included:
- Content script with MutationObserver + regex layer
- Offscreen document with Prompt Guard 22M + DeBERTa v3 cascade
- DOM stripping/masking
- Signal API (window.__AI_SECURITY_REPORT__)
- Badge status
- Minimal popup (status display only)

Cut for PoC:
- Network interception (declarativeNetRequest)
- Scan history / IndexedDB
- Configurable blocklists (hardcoded)
- Popup settings UI
- Content export/reporting

## Tech Stack

- Chrome Extension Manifest V3
- ONNX Runtime Web (WASM backend) via Transformers.js v3+
- Meta Prompt Guard 2 22M (INT8 ONNX from HuggingFace)
- ProtectAI DeBERTa v3 base injection (INT8 ONNX from HuggingFace)
- No build tool for PoC (plain JS modules) — bundler in v2 if needed

## Model Sources

- Prompt Guard: `gravitee-io/Llama-Prompt-Guard-2-22M-onnx` or `shisa-ai/promptguard2-onnx`
- DeBERTa v3: `protectai/deberta-v3-base-injection-onnx`
