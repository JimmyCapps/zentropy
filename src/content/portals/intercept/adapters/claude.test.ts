// @vitest-environment jsdom
import { describeAdapter } from './adapter-spec.js';
import { claudeInterceptAdapter } from './claude.js';

describeAdapter({
  adapter: claudeInterceptAdapter,
  hostnameMatches: ['claude.ai'],
  hostnameMisses: ['chatgpt.com', 'gemini.google.com', 'example.com'],
  fixtureFile: 'claude-composer.html',
  expectedSeedText: 'Reply to Claude…',
});
