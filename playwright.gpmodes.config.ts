import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-geoplaque-modes\.spec\.ts$/,
  fullyParallel: false, retries: 0, reporter: [['list']],
  outputDir: 'test-results/geoplaque-modes-artifacts', timeout: 180_000,
  use: { baseURL: 'https://roadsen.vercel.app', headless: true, trace: 'on', screenshot: 'on', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
