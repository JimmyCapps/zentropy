# Experiments

This folder holds exploratory implementations that explore different design trade-offs than the main HoneyLLM extension. They are **not** part of the published extension — they live here as reference implementations and comparison material.

Each subfolder is self-contained with its own `package.json`, build pipeline, and tests. They do not share dependencies or CI with the root project.

## Current experiments

### [`ai-page-guard/`](./ai-page-guard/)

A classifier-based alternative to HoneyLLM's generative-LLM probes.

| | HoneyLLM (root) | AI Page Guard (experiment) |
|---|---|---|
| **Detection** | Generative LLM probes (Phi-3-mini) | ONNX classifiers (Prompt Guard 22M + DeBERTa v3) |
| **Runtime** | MLC-LLM via WebGPU | ONNX Runtime Web via WASM |
| **Hardware** | WebGPU-capable GPU required | Any CPU (no GPU needed) |
| **First scan** | ~30-60s (model download from CDN) | ~1s (model bundled with extension) |
| **Inference** | ~1-3s per probe (generative) | ~50-200ms per chunk (classifier) |
| **Granularity** | Page-level (14K chars) | Element-level (per leaf) |
| **Novel attacks** | Behavioural analysis catches them | Limited to trained patterns |

Both expose the same signal API (`window.__AI_SECURITY_REPORT__`) so downstream AI tools can consume either implementation.

See [`ai-page-guard/README.md`](./ai-page-guard/README.md) for architecture, install, and test instructions.
