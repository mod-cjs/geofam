/**
 * Playwright — config LIVE de MUTATION du back-office SUPERADMIN (Vercel ↔ Render).
 *
 * Variante de playwright.admin.config.ts ciblant tests/e2e/live-admin-mutations.spec.ts.
 * Ce spec EXÉCUTE réellement les workflows de mutation (création d'org, top-up quota,
 * suspension, membres, comptes globaux) contre l'app EN LIGNE, sur des données
 * STRICTEMENT préfixées `E2E-TEST-` (aucune donnée démo réelle n'est touchée).
 *
 * Lancer :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.mutations.config.ts
 *
 * Timeouts généreux : cold start Render (~60–90 s) + plusieurs allers-retours par test.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-admin-mutations\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/live-admin-mutations-artifacts',
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
