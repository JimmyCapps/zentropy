// @vitest-environment jsdom
import { describeThinkingAdapter } from './adapter-spec.js';
import { claudeThinkingAdapter } from './claude.js';

describeThinkingAdapter({
  adapter: claudeThinkingAdapter,
  hostnameMatches: ['claude.ai'],
  hostnameMisses: ['chatgpt.com', 'gemini.google.com', 'example.com'],
  fixtureFile: 'claude-thinking.html',
  expectedThinkingFragment: 'prime factorisation',
});
