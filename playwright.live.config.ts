/**
 * Playwright — config dédiée aux tests LIVE (app en ligne Vercel ↔ Render).
 *
 * Distincte de playwright.config.ts : AUCUN webServer local (on ne touche pas au
 * `next dev` :3000 du working tree), cible = la prod en ligne, chromium headless,
 * trace + screenshot conservés comme preuve.
 *
 * Lancer : RUN_LIVE=1 corepack pnpm@9.12.0 exec playwright test \
 *   --config=playwright.live.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-vercel\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/live-report' }]],
  outputDir: 'test-results/live-artifacts',
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
