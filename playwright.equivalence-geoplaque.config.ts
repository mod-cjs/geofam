/**
 * Playwright — équivalence golden-master GEOPLAQUE (4 modes : radier ACM, déformations
 * planes, axisymétrique, radier triangulaire) : HTML CLIENT gelé (navigateur, file://,
 * LECTURE seule) ↔ PLATEFORME (recalcul SERVEUR, API live Render).
 *
 * Même méthode/structure que playwright.equivalence-burmister.config.ts. Cible le
 * navigateur RÉEL pour piloter les 4 solveurs (`solveModel`/`solvePlaneStrain`/`solveAxi`/
 * `solveTriRaft`) du HTML d'origine (pas jsdom) + l'API live Render pour le recalcul
 * serveur. Aucun webServer local. Le HTML gelé n'est JAMAIS modifié (file:// lecture seule).
 *
 * Lancer :
 *   corepack pnpm@9.12.0 exec playwright test \
 *     --config=playwright.equivalence-geoplaque.config.ts
 *
 * Le volet golden-master (HTML↔API tenant) provisionne une org JETABLE E2E-TEST-* (via
 * l'API admin, token SUPERADMIN en ENV) et tourne dès que le HTML source est présent
 * localement. Le volet UI bout-en-bout exige RUN_UI=1.
 *
 * ENV requis :
 *   SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD — pour provisionner l'org jetable.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /equivalence-geoplaque-golden\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/equiv-geoplaque-report' }],
  ],
  outputDir: 'test-results/equiv-geoplaque-artifacts',
  // Marge pour le cold-start Render (free tier) sur le volet UI bout-en-bout.
  timeout: 420_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
