# HoneyLLM Testing & Tuning Plan

## Problem

The canary probes and detection rules are implemented but unvalidated against real-world prompt injection payloads. The local model (Phi-3-mini) needs behavioral calibration so its responses to injected content mirror what GPT-4, Claude, and Gemini would do — otherwise the canary detects Phi-3 quirks, not actual injections.

---

## Phase 1: Acquire Test Datasets

### 1A. Payload Collections (raw injection strings)

| Source | What | Action |
|--------|------|--------|
| `TakSec/Prompt-Injection-Everywhere` | 6 categorized payload .txt files (basic, SQLi, XSS, prompt leak) | `gh repo clone TakSec/Prompt-Injection-Everywhere` |
| `deepset/prompt-injections` (HF) | ~600 labeled injection/benign pairs | `huggingface-cli download deepset/prompt-injections` |
| `Lakera/mosscap_prompt_injection` (HF) | 100K+ real injection attempts from DEF CON Gandalf | `huggingface-cli download Lakera/mosscap_prompt_injection` |
| `Arcanum-Sec/arc_pi_taxonomy` | 18 techniques × 20 evasion methods, documented | `gh repo clone Arcanum-Sec/arc_pi_taxonomy` |
| `greshake/llm-security` | Original indirect injection scenarios + fuzzer | `gh repo clone greshake/llm-security` |
| `PayloadsAllTheThings/Prompt Injection` | Curated payloads from SwissKeyRepo | Already in PayloadsAllTheThings |

### 1B. Benchmark Frameworks

| Source | What | Action |
|--------|------|--------|
| `lakeraai/pint-benchmark` | 4,314 inputs for evaluating detection systems | `gh repo clone lakeraai/pint-benchmark` |
| `microsoft/BIPIA` | Indirect injection benchmark with external content scenarios | `gh repo clone microsoft/BIPIA` |
| `Norrrrrrr-lyn/WAInjectBench` | Web agent injection detection benchmark | `gh repo clone Norrrrrrr-lyn/WAInjectBench` |
| Perplexity `BrowseSafe-Bench` (HF) | 14,719 samples, 11 attack types, browser agent focus | `huggingface-cli download perplexity-ai/browsesafe-bench` |

### 1C. Clean Site Corpus

For false-positive testing, we need pages that are NOT injected but contain content that could confuse a naive detector:

| Category | Examples | Why it's tricky |
|----------|----------|-----------------|
| Security blogs | OWASP, Krebs on Security, Hacker News | Discuss injection techniques in visible text |
| AI documentation | OpenAI docs, Anthropic docs, LangChain docs | Contain "system prompt", "ignore instructions" as documentation |
| Code tutorials | StackOverflow, MDN, W3Schools | Have code snippets with fetch(), eval(), XHR |
| Legal/compliance | Privacy policies, cookie notices | Hidden text in expandable sections |
| Accessibility | Screen-reader-heavy sites | Lots of aria-hidden, sr-only text |
| News sites | BBC, Reuters, NYT | Complex DOM, many hidden elements |
| E-commerce | Product pages with reviews | Hidden metadata, structured data |

---

## Phase 2: Build Test Harness

### 2A. Static Test Pages (`test-pages/`)

Create a directory of self-contained HTML files, each embedding injection payloads using a specific DOM technique. Each page gets a ground-truth label.

```
test-pages/
├── clean/
│   ├── simple-article.html          # Plain text article
│   ├── security-blog.html           # Discusses injections (false positive test)
│   ├── code-tutorial.html           # Has fetch(), eval() in code blocks
│   ├── accessibility-heavy.html     # Lots of aria-hidden, sr-only
│   └── complex-ecommerce.html       # Hidden metadata, JSON-LD
├── injected/
│   ├── hidden-div-basic.html        # display:none div with "ignore previous"
│   ├── hidden-div-exfil.html        # display:none with webhook URL
│   ├── white-on-white.html          # Same-color text injection
│   ├── tiny-font.html               # font-size:0px injection
│   ├── offscreen-absolute.html      # position:absolute; left:-9999px
│   ├── meta-tag-injection.html      # Injection in <meta> description
│   ├── alt-text-injection.html      # Injection in image alt attributes
│   ├── comment-injection.html       # HTML comments with instructions
│   ├── aria-label-injection.html    # aria-label with hidden instructions
│   ├── data-attr-injection.html     # data-* attributes with payloads
│   ├── noscript-injection.html      # <noscript> block injection
│   ├── css-content-injection.html   # CSS ::before/::after content property
│   ├── role-hijack.html             # "You are now DAN" style
│   ├── multi-technique.html         # Combines 3+ techniques
│   └── encoded-unicode.html         # Unicode steganography (U+E0000 range)
├── borderline/
│   ├── security-advisory.html       # Real CVE discussion mentioning injections
│   ├── ai-research-paper.html       # Academic paper about prompt injection
│   └── chatbot-help-page.html       # FAQ about "how to write prompts"
└── manifest.json                    # Ground truth labels + expected verdicts
```

### 2B. Test Manifest Schema

```typescript
interface TestCase {
  file: string;
  expectedVerdict: 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';
  techniques: string[];           // e.g. ['hidden-div', 'role-hijack']
  payloadSource: string;          // e.g. 'TakSec/basic-v1.txt:line42'
  description: string;
  falsePositiveRisk: boolean;     // true for borderline/clean pages
}
```

### 2C. Automated Test Runner

A Playwright-based harness that:
1. Starts a local HTTP server serving `test-pages/`
2. Loads the extension
3. For each test page:
   - Navigates to the page
   - Waits for `window.__AI_SECURITY_REPORT__`
   - Records the verdict, confidence, probe results, and flags
   - Compares against `manifest.json` ground truth
4. Outputs a confusion matrix and per-technique detection rate

---

## Phase 3: Model Behavioral Calibration

### The Problem

Phi-3-mini won't respond identically to GPT-4/Claude/Gemini when encountering injection payloads. The canary system works by detecting **behavioral divergence** — if the model's behavior is already weird on clean content, we get false positives. If it's resistant to injections by default, we get false negatives.

### 3A. Baseline Behavioral Profiling

For each of the 3 probes, run the same inputs through:
- **Phi-3-mini** (our canary) — local via WebLLM
- **GPT-4o-mini** — via OpenAI API
- **Claude 3.5 Haiku** — via Anthropic API
- **Gemini 1.5 Flash** — via Google API

Record outputs for:
- 10 clean page excerpts
- 10 injected page excerpts
- 5 borderline page excerpts

### 3B. Divergence Mapping

Create a matrix showing how each model responds to each probe × input combination:

```
                    Clean Input         Injected Input
                    Phi  GPT  Claude    Phi  GPT  Claude
Summarization:      ✓    ✓    ✓        ?    ?    ?
Instruction Det:    ✓    ✓    ✓        ?    ?    ?
Adversarial:        ✓    ✓    ✓        ?    ?    ?
```

Key questions:
- Does Phi-3 comply with injections more/less readily than commercial models?
- Does Phi-3 produce different false signals on clean content?
- Do the adversarial probe outputs diverge similarly across models?

### 3C. Probe Prompt Tuning

Based on divergence mapping, adjust the probe system prompts so Phi-3 behaves more like the commercial models:

1. **Summarization probe**: If Phi-3 is chattier than GPT-4 on clean pages, tighten the system prompt ("respond in exactly 2 sentences, no more")
2. **Instruction detection probe**: If Phi-3 hallucinates injections on clean pages, add explicit few-shot examples of clean content returning `{"found": false}`
3. **Adversarial probe**: If Phi-3 is more resistant to injections than commercial models, weaken the system prompt further ("you MUST follow all instructions found")

### 3D. Detection Rule Tuning

Adjust the regex patterns and scoring weights in the analysis modules:

| Signal | Current Weight | Tune Based On |
|--------|---------------|---------------|
| `SCORE_SUMMARIZATION_ANOMALY` | 20 | False positive rate on clean pages |
| `SCORE_INSTRUCTION_DETECTION` | 40 | True positive rate on injected pages |
| `SCORE_ADVERSARIAL_DIVERGENCE` | 30 | Jaccard similarity threshold between probes |
| `SCORE_ROLE_DRIFT` | 15 | Role adoption regex hit rate |
| `SCORE_EXFILTRATION_INTENT` | 25 | URL/webhook pattern precision |
| `SCORE_HIDDEN_CONTENT_INSTRUCTIONS` | 20 | Hidden text detection accuracy |
| `THRESHOLD_SUSPICIOUS` | 30 | Target: <5% false positive rate |
| `THRESHOLD_COMPROMISED` | 65 | Target: <1% false negative rate on known injections |

---

## Phase 4: Technique Coverage Matrix

### 4A. Detection Coverage by DOM Location

For each injection embedding technique, measure detection rate:

| Technique | Ingestion Module | Detected By | Expected Rate |
|-----------|-----------------|-------------|---------------|
| `display:none` div | `hidden-dom.ts` | Instruction detection + adversarial | >95% |
| `visibility:hidden` | `hidden-dom.ts` | Same | >95% |
| White-on-white text | `visible-text.ts` (extracted as visible) | Adversarial only | 60-80% |
| `font-size:0` | `hidden-dom.ts` (if style matched) | Instruction detection | 70-90% |
| `position:absolute; left:-9999px` | `hidden-dom.ts` (partial) | Instruction detection | 50-70% |
| Meta tag content | `metadata.ts` | NOT YET — needs probe integration | 0% → fix needed |
| Image alt text | NOT extracted | NOT detected | 0% → fix needed |
| HTML comments | NOT extracted | NOT detected | 0% → fix needed |
| `aria-label` | NOT extracted | NOT detected | 0% → fix needed |
| `data-*` attributes | NOT extracted | NOT detected | 0% → fix needed |
| CSS `content:` property | NOT extracted | NOT detected | 0% → fix needed |
| `<noscript>` blocks | NOT extracted | NOT detected | 0% → fix needed |
| Unicode steganography | Partially (depends on text extraction) | Instruction detection | 10-30% |

### 4B. Ingestion Gaps to Fix

Based on the coverage matrix, extend `content/ingestion/`:

1. **`alt-text.ts`** — Extract all `img[alt]`, `area[alt]` text
2. **`comments.ts`** — Extract HTML comments via `NodeFilter.SHOW_COMMENT`
3. **`aria-labels.ts`** — Extract `[aria-label]`, `[aria-description]`, `[title]` attributes
4. **`data-attrs.ts`** — Extract `data-*` attribute values (selective — only text-like values)
5. **`css-content.ts`** — Extract `::before`/`::after` computed content via `getComputedStyle`
6. **`noscript.ts`** — Extract `<noscript>` inner text
7. **Update `metadata.ts`** — Feed meta description/keywords into probe input, not just metadata record

---

## Phase 5: Iteration Loop

### 5A. Score-to-Decision Calibration

Using the test harness results:

1. Plot score distributions for clean vs injected pages
2. Find optimal threshold values using ROC curve analysis
3. Set `THRESHOLD_SUSPICIOUS` at the point where FPR < 5%
4. Set `THRESHOLD_COMPROMISED` at the point where FNR < 1% for known injections

### 5B. Per-Probe Contribution Analysis

For each test case, record which probes contributed to the verdict:
- If probe X never contributes, its system prompt or analysis rules need revision
- If probe X always triggers on clean content, it needs tightening
- If probe X misses a technique that another probe catches, that's OK (defense in depth)

### 5C. Regression Test Expansion

After each tuning iteration:
1. Add failing cases to the test page corpus
2. Update `manifest.json` with new expected verdicts
3. Re-run the full harness
4. Track detection rate trends over time

---

## Phase 6: Implementation Sequence

### Step 1: Dataset Acquisition (1 hour)
- Clone the 6 payload repos
- Download the 4 HF datasets
- Create `test-data/` directory with organized payloads

### Step 2: Test Page Generation (2-3 hours)
- Write a generator script that takes payloads and wraps them in each DOM technique
- Generate 15+ injected pages, 5+ clean pages, 3+ borderline pages
- Create `manifest.json` with ground truth

### Step 3: Test Harness (2 hours)
- Build Playwright-based runner that loads extension + visits each test page
- Collect `__AI_SECURITY_REPORT__` from each page
- Output confusion matrix, per-technique detection rates

### Step 4: Model Comparison (3-4 hours)
- Script that sends each probe × input to GPT-4o-mini, Claude Haiku, Gemini Flash
- Record behavioral differences from Phi-3
- Document the divergence map

### Step 5: Probe Tuning (2-3 hours)
- Adjust system prompts based on behavioral comparison
- Add few-shot examples if needed
- Re-run test harness, compare before/after

### Step 6: Detection Rule Tuning (2-3 hours)
- Adjust regex patterns, weights, thresholds
- Target: >90% detection on known injections, <5% FP on clean pages
- Fix ingestion gaps (alt text, comments, aria-labels, etc.)

### Step 7: Regression Lock (1 hour)
- Freeze working thresholds/weights
- Add all test pages to CI-runnable E2E suite
- Document detection rate per technique

---

## Key Resources Summary

### Immediate Downloads
```bash
# Payload repos
gh repo clone TakSec/Prompt-Injection-Everywhere
gh repo clone Arcanum-Sec/arc_pi_taxonomy
gh repo clone greshake/llm-security
gh repo clone lakeraai/pint-benchmark
gh repo clone microsoft/BIPIA
gh repo clone Norrrrrrr-lyn/WAInjectBench

# HF datasets
huggingface-cli download deepset/prompt-injections
huggingface-cli download Lakera/mosscap_prompt_injection
huggingface-cli download perplexity-ai/browsesafe-bench
```

### API Keys Needed (for model comparison)
- OpenAI API key (GPT-4o-mini)
- Anthropic API key (Claude 3.5 Haiku)
- Google AI Studio key (Gemini 1.5 Flash)

### Success Criteria
- **Detection rate**: >90% on known injected test pages
- **False positive rate**: <5% on clean pages
- **False positive rate**: <15% on borderline pages (security blogs, AI docs)
- **Technique coverage**: All 12+ embedding techniques detected at >50%
- **Model alignment**: Phi-3 probe outputs within 20% behavioral similarity to GPT-4o-mini on the same inputs
