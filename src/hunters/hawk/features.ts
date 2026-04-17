/**
 * Hawk feature extractors.
 *
 * Each extractor runs over a chunk of text and returns:
 *   - activation: value in [0, 1] representing how strongly the feature fired
 *   - excerpts:   short strings that triggered the activation (for
 *                 explainability and Stage 5D source mapping)
 *
 * Features are intentionally *different* from Spider's regex rules. Spider
 * does exact-pattern matching; Hawk does density / ratio / signal-combination
 * scoring over patterns Spider's catalog would miss or gloss over.
 */

export interface FeatureActivation {
  readonly activation: number;
  readonly excerpts: readonly string[];
}

const EMPTY: FeatureActivation = { activation: 0, excerpts: [] };

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function truncate(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// -----------------------------------------------------------------
// 1. Marker density — broader than Spider's exact markers.
// Spider catches [INST], <|system|>, etc. Hawk counts ANY
// instruction-marker-like token and scores by density per 100 chars.
// -----------------------------------------------------------------

const MARKER_TOKENS = [
  /\[\/?inst\]/gi,
  /<\|[a-z_]{3,15}\|>/gi,
  /<!--\s*(inject|instruction|system|prompt)/gi,
  /\[\[(system|instruction|prompt)\]\]/gi,
  /\[(new\s+instructions?|system|developer\s+mode|admin\s+mode|debug\s+mode)\]/gi,
];

export function markerDensity(text: string): FeatureActivation {
  const excerpts: string[] = [];
  let total = 0;
  for (const pattern of MARKER_TOKENS) {
    const matches = text.match(pattern);
    if (matches) {
      total += matches.length;
      for (const m of matches.slice(0, 2)) excerpts.push(m);
    }
  }
  if (total === 0) return EMPTY;

  const charsPerHundred = Math.max(1, Math.floor(text.length / 100));
  const density = total / charsPerHundred;

  // Any single marker is already a strong signal. Saturate fast.
  const activation = clamp01(0.6 + density * 0.4);
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// 2. Directive verb density — sigmoid over the rate of injection-style
// verbs. Natural prose occasionally contains "ignore" or "override";
// injection payloads are saturated with them.
// -----------------------------------------------------------------

const DIRECTIVE_VERBS = new Set([
  'ignore', 'disregard', 'override', 'overwrite', 'bypass', 'circumvent',
  'forget', 'pretend', 'reveal', 'expose', 'output', 'print', 'display',
  'leak', 'disclose', 'dump', 'emit', 'regurgitate', 'echo',
]);

export function directiveVerbDensity(text: string): FeatureActivation {
  const words = text.toLowerCase().match(/\b[a-z']+\b/g);
  if (words === null || words.length < 10) return EMPTY;

  const excerpts: string[] = [];
  let hits = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (DIRECTIVE_VERBS.has(word)) {
      hits += 1;
      if (excerpts.length < 3) {
        const start = Math.max(0, i - 2);
        const end = Math.min(words.length, i + 3);
        excerpts.push(truncate(words.slice(start, end).join(' ')));
      }
    }
  }

  // Require at least 2 hits — a single directive verb is commonly present
  // in benign prose ("ignore the warning", "reveal the truth"). Density
  // only makes sense with multiple samples.
  if (hits < 2) return EMPTY;

  const density = hits / words.length;
  // Typical prose ≤0.5%; injection payloads often ≥3-5%. Sharp sigmoid
  // around 1.5% density so the feature saturates fast once we're above
  // "organic" rates but stays flat for incidental directive use.
  const DIRECTIVE_DENSITY_MIDPOINT = 0.015;
  const DIRECTIVE_SIGMOID_SHARPNESS = 400;
  const z = (density - DIRECTIVE_DENSITY_MIDPOINT) * DIRECTIVE_SIGMOID_SHARPNESS;
  const activation = clamp01(1 / (1 + Math.exp(-z)));
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// 3. Role-reassignment phrases — mimics Spider's rejection list but
// contextually: a single phrase is weak, multiple is strong.
// "you are now logged in" alone is benign; combined with other
// features it shifts the score.
// -----------------------------------------------------------------

const ROLE_PHRASES = [
  /\byou\s+are\s+(now|a|an|no\s+longer)\b/gi,
  /\bact\s+(as|like)\b/gi,
  /\bpretend\s+(to\s+be|you('re|\s+are))\b/gi,
  /\bimagine\s+(you('re|\s+are)|yourself\s+as)\b/gi,
  /\bfrom\s+now\s+on\b/gi,
  /\byou\s+(must|will|shall|have\s+to)\s+(always|never|only)\b/gi,
  /\byour\s+(new|updated|real|true)\s+(role|task|purpose|instructions?)\b/gi,
  /\byou\s+have\s+been\s+given\s+(new|updated|revised)/gi,
];

export function roleReassignment(text: string): FeatureActivation {
  const excerpts: string[] = [];
  let hits = 0;
  for (const pattern of ROLE_PHRASES) {
    const matches = text.match(pattern);
    if (matches) {
      hits += matches.length;
      for (const m of matches.slice(0, 2)) excerpts.push(truncate(m));
    }
  }
  if (hits === 0) return EMPTY;

  // 1 hit → 0.25 (weak), 3 hits → 0.65, 5+ → saturates.
  const activation = clamp01(0.1 + Math.log2(hits + 1) * 0.3);
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// 4. Encoding anomalies — zero-width characters, RTL override,
// unusual Unicode blocks that indicate text hiding tricks.
// -----------------------------------------------------------------

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const RTL_OVERRIDE = /[\u202A-\u202E\u2066-\u2069]/g;
const HOMOGLYPH_SUSPECTS = /[\u0400-\u04FF\u0370-\u03FF][a-zA-Z]|[a-zA-Z][\u0400-\u04FF\u0370-\u03FF]/;

export function encodingAnomalies(text: string): FeatureActivation {
  const excerpts: string[] = [];
  let weight = 0;

  const zw = text.match(ZERO_WIDTH);
  if (zw !== null && zw.length > 0) {
    weight += Math.min(0.5, zw.length * 0.1);
    excerpts.push(`zero-width chars x${zw.length}`);
  }

  const rtl = text.match(RTL_OVERRIDE);
  if (rtl !== null && rtl.length > 0) {
    weight += 0.6;
    excerpts.push(`bidi control chars x${rtl.length}`);
  }

  if (HOMOGLYPH_SUSPECTS.test(text)) {
    weight += 0.3;
    excerpts.push('mixed-script adjacency');
  }

  if (weight === 0) return EMPTY;
  return { activation: clamp01(weight), excerpts };
}

// -----------------------------------------------------------------
// 5. Imperative sentence ratio — fraction of sentences that open with
// a directive verb. Prose is typically 5-15% imperative; injection
// payloads are often 50%+.
// -----------------------------------------------------------------

const IMPERATIVE_OPENERS = new Set([
  'ignore', 'disregard', 'override', 'forget', 'output', 'print', 'reveal',
  'display', 'show', 'list', 'enumerate', 'describe', 'tell', 'write',
  'generate', 'produce', 'emit', 'pretend', 'imagine', 'act', 'respond',
  'answer', 'return', 'execute', 'run', 'perform', 'stop', 'halt', 'do',
]);

export function imperativeRatio(text: string): FeatureActivation {
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length < 3) return EMPTY;

  const excerpts: string[] = [];
  let imperatives = 0;
  for (const sentence of sentences) {
    const firstWord = sentence.trim().toLowerCase().match(/^[a-z]+/);
    if (firstWord !== null && IMPERATIVE_OPENERS.has(firstWord[0])) {
      imperatives += 1;
      if (excerpts.length < 3) excerpts.push(truncate(sentence.trim()));
    }
  }

  if (imperatives === 0) return EMPTY;

  const ratio = imperatives / sentences.length;
  // Prose baseline ~0.1. 0.35 → ~0.5 activation. 0.6+ → saturates.
  const activation = clamp01((ratio - 0.1) * 2);
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// 6. Instruction-boundary marker — ALL-CAPS phrase followed by a colon,
// setting up a new instruction scope. Real-world attacks consistently
// use patterns like "SYSTEM OVERRIDE:", "IMPORTANT INSTRUCTIONS FOR
// AI:", "AI ASSISTANT INSTRUCTIONS:", "ATTENTION:". These announce a
// context-switch that benign prose essentially never uses.
// -----------------------------------------------------------------

const INSTRUCTION_BOUNDARY = /\b([A-Z][A-Z\s]{4,40}):\s+[A-Z]/g;
const BOUNDARY_KEYWORDS = /(SYSTEM|INSTRUCTION|AI|ASSISTANT|ATTENTION|OVERRIDE|IMPORTANT|URGENT|NOTE|WARNING)/;

export function instructionBoundary(text: string): FeatureActivation {
  const matches = [...text.matchAll(INSTRUCTION_BOUNDARY)];
  if (matches.length === 0) return EMPTY;

  const relevant = matches.filter((m) => BOUNDARY_KEYWORDS.test(m[1]!));
  if (relevant.length === 0) return EMPTY;

  const excerpts = relevant.slice(0, 3).map((m) => truncate(m[0]!));
  const activation = clamp01(0.5 + relevant.length * 0.25);
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// 7. Output manipulation — phrases telling the LLM exactly what to
// output (or what NOT to output). The directive-verb feature catches
// single words; this feature catches the fuller pattern of
// "respond with X and nothing else" / "output the following" /
// "print exactly" which is specific to injection, not general prose.
// -----------------------------------------------------------------

const OUTPUT_MANIPULATION = [
  /\b(respond|reply)\s+(only\s+)?(with|by|using)\s+(['"]?[A-Za-z])/gi,
  /\boutput\s+(the|your|exactly|only|exact)/gi,
  /\bprint\s+(the|your|exactly|only|out)/gi,
  /\bsay\s+(['"]|exactly|only)/gi,
  /\band\s+nothing\s+else\b/gi,
  /\binstead\s+(output|respond|reply|return|say|print)/gi,
  /\bbegin\s+with\s+['"]/gi,
  /\b(must|always)\s+include\s+(the|this|all)/gi,
];

export function outputManipulation(text: string): FeatureActivation {
  const excerpts: string[] = [];
  let hits = 0;
  for (const pattern of OUTPUT_MANIPULATION) {
    const matches = text.match(pattern);
    if (matches) {
      hits += matches.length;
      for (const m of matches.slice(0, 2)) excerpts.push(truncate(m));
    }
  }
  if (hits === 0) return EMPTY;
  // 1 hit → 0.4, 2 → 0.65, 3+ → saturates.
  const activation = clamp01(0.15 + Math.log2(hits + 1) * 0.35);
  return { activation, excerpts };
}

// -----------------------------------------------------------------
// Feature weights — tuned by engineering judgement. Features sum into
// the classifier logit (see classifier.ts). Weights ordered by
// specificity: instruction_boundary and marker_density almost never
// appear in benign text; directive verb and imperative ratio do.
// -----------------------------------------------------------------

export const FEATURE_WEIGHTS = {
  marker_density: 0.9,
  instruction_boundary: 0.9,
  output_manipulation: 0.8,
  directive_verb_density: 0.7,
  role_reassignment: 0.55,
  encoding_anomalies: 0.85,
  imperative_ratio: 0.35,
} as const;

export type FeatureName = keyof typeof FEATURE_WEIGHTS;

export interface FeatureRun {
  readonly name: FeatureName;
  readonly activation: number;
  readonly excerpts: readonly string[];
  readonly weight: number;
}

export function extractAllFeatures(text: string): readonly FeatureRun[] {
  const extractors: readonly (readonly [FeatureName, FeatureActivation])[] = [
    ['marker_density', markerDensity(text)],
    ['instruction_boundary', instructionBoundary(text)],
    ['output_manipulation', outputManipulation(text)],
    ['directive_verb_density', directiveVerbDensity(text)],
    ['role_reassignment', roleReassignment(text)],
    ['encoding_anomalies', encodingAnomalies(text)],
    ['imperative_ratio', imperativeRatio(text)],
  ];

  return extractors
    .filter(([, result]) => result.activation > 0)
    .map(([name, result]) => ({
      name,
      activation: result.activation,
      excerpts: result.excerpts,
      weight: FEATURE_WEIGHTS[name],
    }));
}
