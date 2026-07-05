/**
 * Playwright — config AUDIT du back-office live (Vercel ↔ Render).
 * Parcours exhaustif read-only qui COLLECTE les manquements (ne fail pas au 1er).
 *
 * Lancer :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.audit.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /admin-audit\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/admin-audit-artifacts',
  timeout: 300_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
