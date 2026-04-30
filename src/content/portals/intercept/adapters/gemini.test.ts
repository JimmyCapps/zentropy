// @vitest-environment jsdom
import { describeAdapter } from './adapter-spec.js';
import { geminiInterceptAdapter } from './gemini.js';

describeAdapter({
  adapter: geminiInterceptAdapter,
  hostnameMatches: ['gemini.google.com'],
  hostnameMisses: ['chatgpt.com', 'claude.ai', 'example.com'],
  fixtureFile: 'gemini-composer.html',
  expectedSeedText: 'Ask Gemini…',
});
