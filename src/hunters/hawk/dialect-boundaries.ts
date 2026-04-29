import { CHARS_PER_TOKEN_TABLE } from '@/shared/constants.js';

export interface LanguageRuleSet {
  readonly sentencePattern: RegExp;
  readonly paragraphPattern: RegExp;
  readonly charsPerToken: number;
}

const PARAGRAPH_BREAK = /\n\n/g;

const EN_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!?](?=[\s\n])/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['en'],
});

const ZH_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[。！？”」]/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['zh'],
});

const JA_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[。！？、]/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['ja'],
});

const KO_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!?。]/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['ko'],
});

const AR_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!؟]/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['ar'],
});

const HE_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!?](?=[\s\n])/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['he'],
});

const DEFAULT_RULE_SET: LanguageRuleSet = EN_RULES;

const LANGUAGE_RULE_SETS: Readonly<Record<string, LanguageRuleSet>> = Object.freeze({
  en: EN_RULES,
  es: EN_RULES,
  de: EN_RULES,
  fr: EN_RULES,
  pt: EN_RULES,
  it: EN_RULES,
  zh: ZH_RULES,
  'zh-cn': ZH_RULES,
  'zh-tw': ZH_RULES,
  ja: JA_RULES,
  ko: KO_RULES,
  ar: AR_RULES,
  he: HE_RULES,
});

export function getRuleSet(languageCode: string): LanguageRuleSet {
  const key = languageCode.toLowerCase().trim();
  return LANGUAGE_RULE_SETS[key] ?? DEFAULT_RULE_SET;
}

interface RegexHit {
  readonly matchStart: number;
  readonly matchEnd: number;
}

function lastRegexMatchBefore(
  text: string,
  pattern: RegExp,
  maxIndex: number,
): RegexHit | null {
  let last: RegexHit | null = null;
  for (const m of text.matchAll(pattern)) {
    if (m.index === undefined) continue;
    if (m.index >= maxIndex) break;
    last = { matchStart: m.index, matchEnd: m.index + m[0].length };
  }
  return last;
}

function findDialectSplit(
  remaining: string,
  ruleSet: LanguageRuleSet,
  maxChars: number,
): number {
  const halfMark = maxChars * 0.5;

  const para = lastRegexMatchBefore(remaining, ruleSet.paragraphPattern, maxChars);
  if (para !== null && para.matchStart + 1 >= halfMark) {
    return para.matchStart + 1;
  }

  const sent = lastRegexMatchBefore(remaining, ruleSet.sentencePattern, maxChars);
  if (sent !== null && sent.matchEnd >= halfMark) {
    return sent.matchEnd;
  }

  const wordAt = remaining.lastIndexOf(' ', maxChars);
  if (wordAt !== -1) return wordAt + 1;

  return maxChars;
}

export function applyDialectBoundaries(
  text: string,
  ruleSet: LanguageRuleSet,
  maxChars: number,
): readonly string[] {
  if (text.length <= maxChars) return [text];
  const segments: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.length <= maxChars) {
      segments.push(remaining);
      break;
    }
    const splitAt = findDialectSplit(remaining, ruleSet, maxChars);
    segments.push(remaining.slice(0, splitAt));
    cursor += splitAt;
  }
  return segments;
}
