# Phase 4 Stage 4E — Chromium-family browser compatibility audit

Tracks: issue [#8](https://github.com/JimmyCapps/zentropy/issues/8). Manual playbook: [`../manual-tests/2.8.md`](../manual-tests/2.8.md). Sprint 2 §2.8.

**Status:** scaffold — rows populated by the manual sweep.

## Method

For each browser, load `dist/` unpacked, visit `https://en.wikipedia.org/wiki/Sourdough`, record the five binary cells (extension-loads / scan-completes / verdict-shown / WebGPU-available / Nano-available), and commit two screenshots (`<browser>-gpu.png`; `chrome-nano.png` for Chrome only) under `compat-screenshots/`.

Test pages used: `https://en.wikipedia.org/wiki/Sourdough` (clean control). Inject-fixture coverage deferred to Sprint 6 follow-up.

Cells: `✅` pass · `❌` fail · `n/a` not applicable (e.g. Nano outside Chrome) · `?` not yet measured.

## Matrix

| Browser | Build | Extension loads | Scan completes | Verdict shown | WebGPU available | Nano available | Notes |
|---|---|---|---|---|---|---|---|
| Chrome (stable) | ? | ? | ? | ? | ? | ? | — |
| Edge | ? | ? | ? | ? | ? | n/a | — |
| Brave | ? | ? | ? | ? | ? | n/a | — |
| Opera | ? | ? | ? | ? | ? | n/a | — |
| Vivaldi | ? | ? | ? | ? | ? | n/a | — |
| Arc | ? | ? | ? | ? | ? | n/a | — |

## Per-browser details

<details>
<summary>Chrome (stable)</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `chrome://gpu/` rasterization status)_
- **Nano available:** _result (cite `chrome://on-device-internals/`)_
- **Screenshots:** `compat-screenshots/chrome-gpu.png`, `compat-screenshots/chrome-nano.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

<details>
<summary>Edge</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `edge://gpu/` rasterization status)_
- **Nano available:** n/a
- **Screenshots:** `compat-screenshots/edge-gpu.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

<details>
<summary>Brave</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `brave://gpu/` rasterization status)_
- **Nano available:** n/a
- **Screenshots:** `compat-screenshots/brave-gpu.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

<details>
<summary>Opera</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `opera://gpu/` rasterization status)_
- **Nano available:** n/a
- **Screenshots:** `compat-screenshots/opera-gpu.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

<details>
<summary>Vivaldi</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `vivaldi://gpu/` rasterization status)_
- **Nano available:** n/a
- **Screenshots:** `compat-screenshots/vivaldi-gpu.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

<details>
<summary>Arc</summary>

- **Build:** _channel + version_
- **Extension loads:** _result_
- **Scan completes:** _result_
- **Verdict shown:** _result_
- **WebGPU available:** _result (cite `arc://gpu/` or the Chromium-equivalent URL Arc exposes)_
- **Nano available:** n/a
- **Screenshots:** `compat-screenshots/arc-gpu.png`
- **Console errors:** _none / list_
- **Notes:** —

</details>

## Findings

_Populated after the sweep completes. Capture: regressions vs. Chrome baseline, vendor-specific quirks, blocking issues filed._
