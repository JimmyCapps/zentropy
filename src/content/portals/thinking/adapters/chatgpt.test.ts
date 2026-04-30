// @vitest-environment jsdom
import { describeThinkingAdapter } from './adapter-spec.js';
import { chatgptThinkingAdapter } from './chatgpt.js';

describeThinkingAdapter({
  adapter: chatgptThinkingAdapter,
  hostnameMatches: ['chatgpt.com', 'chat.openai.com'],
  hostnameMisses: ['claude.ai', 'gemini.google.com', 'example.com'],
  fixtureFile: 'chatgpt-thinking.html',
  expectedThinkingFragment: 'recursion',
});
