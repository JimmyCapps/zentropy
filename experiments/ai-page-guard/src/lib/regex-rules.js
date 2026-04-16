/**
 * Regex detection rules for AI Page Guard.
 *
 * DESIGN PRINCIPLE: Only flag content that is unambiguously adversarial.
 * False positives break real websites (Gmail, YouTube, etc.).
 * When in doubt, let the ONNX classifiers handle it.
 */

const TEXT_PATTERNS = [
  // Instruction markers — these are LLM-specific tokens that should never appear in normal web content
  { regex: /<!--\s*inject:/i, category: 'instruction_marker', label: '<!-- inject:' },
  { regex: /\[INST\][\s\S]*?\[\/INST\]/i, category: 'instruction_marker', label: '[INST]...[/INST]' },
  { regex: /<\|system\|>/i, category: 'instruction_marker', label: '<|system|>' },
  { regex: /<\|user\|>/i, category: 'instruction_marker', label: '<|user|>' },
  { regex: /<\|assistant\|>/i, category: 'instruction_marker', label: '<|assistant|>' },

  // Prompt injection — require multi-word phrases with clear adversarial intent
  // "ignore previous instructions" is unambiguous — normal text doesn't use this phrase
  { regex: /ignore\s+(all\s+)?previous\s+instructions/i, category: 'prompt_injection', label: 'ignore previous instructions' },
  { regex: /disregard\s+(all\s+)?(the\s+)?(above|previous)\s+(instructions|rules|guidelines)/i, category: 'prompt_injection', label: 'disregard instructions' },
  { regex: /\bdo\s+anything\s+now\b/i, category: 'prompt_injection', label: 'do anything now' },

  // Removed overly broad patterns:
  // - "you are now" — matches everyday English ("you are now logged in")
  // - "system prompt" — matches legitimate tech discussions
  // - "jailbreak" — matches legitimate iOS/security discussions
  // - base64 blobs — matches auth tokens, data URIs, minified JS on every site
];

export function scanText(text) {
  for (const { regex, category, label } of TEXT_PATTERNS) {
    if (regex.test(text)) {
      return { matched: true, category, pattern: label };
    }
  }
  return { matched: false, category: null, pattern: null };
}

/**
 * Check if an element is suspiciously hidden AND contains injection-like text.
 * Hidden elements are extremely common in modern web apps (menus, modals,
 * tooltips, accessibility elements). Only flag them if the text content
 * also looks like a prompt injection attempt.
 */
export function scanElement(el) {
  const style = el.style || {};
  const text = (el.textContent || '').trim();
  if (!text || text.length < 20) return { matched: false, category: null, pattern: null };

  // Check if element is hidden via inline styles
  const isHidden =
    style.display === 'none' ||
    style.opacity === '0' || style.opacity === '0.0' ||
    style.fontSize === '0' || style.fontSize === '0px' ||
    (style.position === 'absolute' && typeof el.getBoundingClientRect === 'function' &&
      (() => { const r = el.getBoundingClientRect(); return r.left < -5000 || r.top < -5000; })());

  if (!isHidden) return { matched: false, category: null, pattern: null };

  // Hidden element found — but ONLY flag if text content looks like injection.
  // This prevents stripping legitimate hidden UI (menus, modals, tooltips).
  const lowerText = text.toLowerCase();
  const injectionSignals = [
    'ignore previous', 'ignore all previous',
    'disregard above', 'disregard the above', 'disregard previous',
    'you are now', 'act as', 'pretend to be',
    'do anything now', 'bypass', 'override',
    'reveal your', 'show me your', 'output your',
    'system prompt', 'instructions were',
    '[inst]', '<|system|>', '<|user|>',
    'ignore safety', 'ignore guidelines',
  ];

  const hasInjectionSignal = injectionSignals.some(signal => lowerText.includes(signal));
  if (hasInjectionSignal) {
    // Determine which hiding method
    let pattern = 'hidden';
    if (style.display === 'none') pattern = 'display:none';
    else if (style.opacity === '0' || style.opacity === '0.0') pattern = 'opacity:0';
    else if (style.fontSize === '0' || style.fontSize === '0px') pattern = 'font-size:0';
    else pattern = 'offscreen';

    return { matched: true, category: 'hidden_content', pattern };
  }

  return { matched: false, category: null, pattern: null };
}
