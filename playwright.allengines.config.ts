import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-all-engines\.spec\.ts$/,
  fullyParallel: false, workers: 1, retries: 1, reporter: [['list']],
  outputDir: 'test-results/all-engines-artifacts', timeout: 200_000,
  use: { baseURL: 'https://roadsen.vercel.app', headless: true, trace: 'on', screenshot: 'on', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
