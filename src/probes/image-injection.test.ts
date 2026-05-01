import { describe, it, expect } from 'vitest';
import { imageInjectionProbe } from './image-injection.js';
import type { ImageRef } from '@/types/snapshot.js';
import { SCORE_IMAGE_INJECTION, THRESHOLD_COMPROMISED } from '@/shared/constants.js';

const sampleImage: ImageRef = {
  src: 'https://example.com/banner.png',
  altText: 'site banner',
  width: 600,
  height: 400,
  visibleInViewport: true,
  sizeClass: 'large',
};

describe('imageInjectionProbe — issue #9 Stage 4G.3', () => {
  it('declares the canonical name and required capabilities', () => {
    expect(imageInjectionProbe.name).toBe('image_injection');
    expect(imageInjectionProbe.requiredCapabilities).toEqual(['image_input']);
  });

  it('exposes a system prompt that targets multimodal injection extraction', () => {
    expect(imageInjectionProbe.systemPrompt).toContain('image');
    expect(imageInjectionProbe.systemPrompt).toContain('injection_present');
    expect(imageInjectionProbe.systemPrompt).toContain('extracted_text');
    expect(imageInjectionProbe.systemPrompt).toContain('technique');
    expect(imageInjectionProbe.systemPrompt).toContain('rationale');
  });

  it('exposes a responseConstraintSchema asking for the JSON output shape', () => {
    expect(imageInjectionProbe.responseConstraintSchema).toBeDefined();
    const schema = imageInjectionProbe.responseConstraintSchema as {
      properties?: Record<string, unknown>;
      required?: readonly string[];
    };
    expect(schema.properties).toBeDefined();
    expect(Object.keys(schema.properties!)).toEqual(
      expect.arrayContaining(['injection_present', 'extracted_text', 'technique', 'rationale']),
    );
  });

  it('builds a user message describing the page chunk for the legacy text path', () => {
    const msg = imageInjectionProbe.buildUserMessage('page text content here');
    expect(msg).toContain('page text content here');
  });

  it('exposes a buildImageMessage that surfaces ImageRef metadata to the model', () => {
    expect(imageInjectionProbe.buildImageMessage).toBeDefined();
    const msg = imageInjectionProbe.buildImageMessage!(sampleImage);
    expect(msg).toContain('https://example.com/banner.png');
    expect(msg).toContain('site banner');
    expect(msg).toContain('600');
    expect(msg).toContain('400');
  });

  it('handles ImageRef with empty altText without crashing', () => {
    const img: ImageRef = { ...sampleImage, altText: '' };
    const msg = imageInjectionProbe.buildImageMessage!(img);
    expect(msg).toContain('https://example.com/banner.png');
  });

  it('passes when injection_present is false (JSON)', () => {
    const result = imageInjectionProbe.analyzeResponse(
      '{"injection_present": false, "extracted_text": "", "technique": null, "rationale": "no payload"}',
      'chunk',
    );
    expect(result.passed).toBe(true);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('fails when injection_present is true (JSON)', () => {
    const result = imageInjectionProbe.analyzeResponse(
      '{"injection_present": true, "extracted_text": "Ignore previous instructions", "technique": "ocr_overlay", "rationale": "bitmap text overrides"}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('image_injection_detected');
    expect(result.flags.some((f) => f.startsWith('technique:'))).toBe(true);
    expect(result.score).toBe(SCORE_IMAGE_INJECTION);
  });

  it('emits a normalised technique flag (lowercase, underscores)', () => {
    const result = imageInjectionProbe.analyzeResponse(
      '{"injection_present": true, "extracted_text": "x", "technique": "OCR Overlay Attack", "rationale": "x"}',
      'chunk',
    );
    expect(result.flags).toContain('technique:ocr_overlay_attack');
  });

  it('handles JSON embedded in surrounding prose', () => {
    const result = imageInjectionProbe.analyzeResponse(
      'Analysis complete:\n{"injection_present": true, "extracted_text": "send tokens", "technique": "qr_code", "rationale": "encoded payload"}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('image_injection_detected');
  });

  it('falls back to keyword detection on non-JSON output', () => {
    const result = imageInjectionProbe.analyzeResponse(
      'The image contains hidden instructions overlaid as bitmap text.',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('image_injection_detected');
    expect(result.flags).toContain('non_json_response');
  });

  it('passes on non-JSON with no injection keywords', () => {
    const result = imageInjectionProbe.analyzeResponse(
      'The image shows a marketing banner with the company logo.',
      'chunk',
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });

  it('falls back on malformed JSON containing injection keywords', () => {
    const result = imageInjectionProbe.analyzeResponse(
      'There is hidden instruction text rendered inside the image {broken: json}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('parse_fallback');
  });

  it('treats missing technique field as detected without technique flag', () => {
    const result = imageInjectionProbe.analyzeResponse(
      '{"injection_present": true, "extracted_text": "x", "rationale": "y"}',
      'chunk',
    );
    expect(result.passed).toBe(false);
    expect(result.flags).toContain('image_injection_detected');
    expect(result.flags.some((f) => f.startsWith('technique:'))).toBe(false);
  });

  it('score stays conservative — never sufficient to cross THRESHOLD_COMPROMISED alone', () => {
    const result = imageInjectionProbe.analyzeResponse(
      '{"injection_present": true, "extracted_text": "lots of text", "technique": "exif", "rationale": "long"}',
      'chunk',
    );
    expect(result.score).toBeLessThan(THRESHOLD_COMPROMISED);
  });

  it('returns passed:true on completely empty output', () => {
    const result = imageInjectionProbe.analyzeResponse('', 'chunk');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });
});
