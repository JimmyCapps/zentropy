// @vitest-environment jsdom
import { describeAdapter } from './adapter-spec.js';
import { chatgptInterceptAdapter } from './chatgpt.js';

describeAdapter({
  adapter: chatgptInterceptAdapter,
  hostnameMatches: ['chatgpt.com', 'chat.openai.com'],
  hostnameMisses: ['claude.ai', 'gemini.google.com', 'example.com'],
  fixtureFile: 'chatgpt-composer.html',
  expectedSeedText: 'Ask anything',
});
