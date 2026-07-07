/**
 * Playwright — équivalence golden-master ROADSENS (burmister) : HTML CLIENT gelé
 * (navigateur, file://, LECTURE seule) ↔ PLATEFORME (recalcul SERVEUR, API live).
 *
 * Distincte des autres configs : cible le navigateur RÉEL pour piloter `doCalc` du
 * HTML d'origine (pas jsdom) + l'API live Render pour le recalcul serveur. Aucun
 * webServer local. Le HTML gelé n'est JAMAIS modifié (file:// en lecture seule).
 *
 * Lancer :
 *   RUN_LIVE=1 corepack pnpm@9.12.0 exec playwright test \
 *     --config=playwright.equivalence-burmister.config.ts
 *
 * Le volet golden-master (HTML↔API publique) tourne sans RUN_LIVE dès que le HTML
 * source est présent localement ; le volet UI bout-en-bout exige RUN_LIVE=1.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /equivalence-burmister-golden\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/equiv-burmister-report' }],
  ],
  outputDir: 'test-results/equiv-burmister-artifacts',
  timeout: 200_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
