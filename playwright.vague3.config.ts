/**
 * Playwright — vérification LIVE des UI Vague 3 (gestion utilisateurs, Vercel ↔
 * Render), NON-mutantes.
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.vague3.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-admin-vague3\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/vague3-artifacts',
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
