import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  timeout: 180000,
  retries: 0,
  workers: 1, // Must be 1 — extensions share browser state
  use: {
    browserName: 'chromium',
  },
});
