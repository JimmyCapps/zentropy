/**
 * Spider — deterministic pattern matching for prompt injection.
 *
 * Ported from kynwu/ai-page-guard's regex-rules.js (PR #1). Standalone, no
 * dependencies, no LLM. Intended as the Stage 5A starting point per issue #3.
 *
 * DESIGN PRINCIPLE — only flag content that is unambiguously adversarial.
 * False positives break real websites (Gmail, YouTube, accessibility UI,
 * etc.). When in doubt, let Canary / Hawk / Wolf handle it downstream.
 *
 * Note on the original scanElement() function: ai-page-guard's DOM-level
 * hidden-element check is intentionally omitted here because HoneyLLM's
 * content-script ingestion already separates visible/hidden text into
 * PageSnapshot (see src/types/snapshot.ts). Spider runs on the extracted
 * text chunks and stays DOM-agnostic.
 */

export type SpiderCategory = 'instruction_marker' | 'prompt_injection';

export interface SpiderPattern {
  readonly regex: RegExp;
  readonly category: SpiderCategory;
  readonly label: string;
}

export interface SpiderMatch {
  readonly matched: boolean;
  readonly category: SpiderCategory | null;
  readonly pattern: string | null;
}

export const SPIDER_PATTERNS: readonly SpiderPattern[] = [
  // Instruction markers — LLM-specific tokens that should never appear in
  // normal web content. High precision, low recall by design.
  { regex: /<!--\s*inject:/i, category: 'instruction_marker', label: '<!-- inject:' },
  { regex: /\[INST\][\s\S]*?\[\/INST\]/i, category: 'instruction_marker', label: '[INST]...[/INST]' },
  { regex: /<\|system\|>/i, category: 'instruction_marker', label: '<|system|>' },
  { regex: /<\|user\|>/i, category: 'instruction_marker', label: '<|user|>' },
  { regex: /<\|assistant\|>/i, category: 'instruction_marker', label: '<|assistant|>' },

  // Prompt injection — multi-word phrases with clear adversarial intent.
  // Each phrase must be one that normal prose does not organically produce.
  {
    regex: /ignore\s+(all\s+)?previous\s+instructions/i,
    category: 'prompt_injection',
    label: 'ignore previous instructions',
  },
  {
    regex: /disregard\s+(all\s+)?(the\s+)?(above|previous)\s+(instructions|rules|guidelines)/i,
    category: 'prompt_injection',
    label: 'disregard instructions',
  },
  {
    regex: /\bdo\s+anything\s+now\b/i,
    category: 'prompt_injection',
    label: 'do anything now',
  },

  // Previously-evaluated patterns rejected for false-positive rates:
  // - "you are now"     → matches "you are now logged in"
  // - "system prompt"   → matches legitimate technical discussions
  // - "jailbreak"       → matches iOS / security content
  // - standalone base64 → matches auth tokens, data URIs, minified JS
];

const NO_MATCH: SpiderMatch = { matched: false, category: null, pattern: null };

/**
 * Scan a text chunk for prompt-injection signatures. Returns the first
 * matching pattern, or NO_MATCH if clean. Typical latency: <1ms for chunks
 * up to MAX_CHUNK_CHARS (14K chars).
 */
export function scanText(text: string): SpiderMatch {
  for (const { regex, category, label } of SPIDER_PATTERNS) {
    if (regex.test(text)) {
      return { matched: true, category, pattern: label };
    }
  }
  return NO_MATCH;
}
