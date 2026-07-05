/**
 * Playwright — config LIVE pour la console back-office /admin (Vercel ↔ Render).
 * Variante de playwright.live.config.ts ciblant tests/e2e/live-admin.spec.ts.
 *
 * Lancer :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.admin.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-admin\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/live-admin-artifacts',
  timeout: 180_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
