// @vitest-environment jsdom
import { describeThinkingAdapter } from './adapter-spec.js';
import { geminiThinkingAdapter } from './gemini.js';

describeThinkingAdapter({
  adapter: geminiThinkingAdapter,
  hostnameMatches: ['gemini.google.com'],
  hostnameMisses: ['chatgpt.com', 'claude.ai', 'example.com'],
  fixtureFile: 'gemini-thinking.html',
  expectedThinkingFragment: 'prime numbers',
});
