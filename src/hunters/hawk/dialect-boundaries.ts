import { CHARS_PER_TOKEN_TABLE } from '@/shared/constants.js';

export interface LanguageRuleSet {
  readonly sentencePattern: RegExp;
  readonly paragraphPattern: RegExp;
  readonly charsPerToken: number;
}

const PARAGRAPH_BREAK = /\n\n/g;

const EN_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!?][\s\n]/g,
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
  sentencePattern: /[.!?。][\s\n]?/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['ko'],
});

const AR_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!؟][\s\n]?/g,
  paragraphPattern: PARAGRAPH_BREAK,
  charsPerToken: CHARS_PER_TOKEN_TABLE['ar'],
});

const HE_RULES: LanguageRuleSet = Object.freeze({
  sentencePattern: /[.!?][\s\n]/g,
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
