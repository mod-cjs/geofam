/**
 * Playwright — configuration DÉDIÉE au spec de FIDÉLITÉ D'INTERFACE GEOPLAQUE.
 *
 * But : PROUVER les écarts UI / fonctionnement / affichage entre :
 *   - le HTML CLIENT gelé (référence) — 03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html,
 *     piloté dans un VRAI Chromium en file:// (LECTURE seule, JAMAIS modifié) ;
 *   - NOTRE app LIVE — https://roadsen.vercel.app (login geoplaque@starfire.test),
 *     logiciel GEOPLAQUE.
 *
 * Ce spec ne compare pas des NOMBRES bruts serveur↔HTML (c'est le rôle de
 * equivalence-geoplaque-golden.spec.ts) : il CATALOGUE la structure d'interface des
 * deux côtés, prend des CAPTURES alignées, et compare l'AFFICHAGE bout-en-bout
 * (onglets/modes, formulaires, panneau résultats, cartes, valeurs rendues).
 *
 * Aucun webServer local : la cible NOUS est le déploiement LIVE (Vercel↔Render).
 * Le HTML client est chargé en file://. workers:1 (déterminisme, un seul navigateur).
 *
 * Lancer :
 *   corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-geoplaque.config.ts
 *
 * Variables d'env optionnelles (défauts = identifiants de la mission) :
 *   GP_EMAIL / GP_PASSWORD — compte de l'org etude-geoplaque (pack COMPLETE).
 *   RUN_CALC=1 — active le volet CALCULS live (consomme du quota, ≤6 calculs). Off par défaut.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /fidelite-geoplaque-ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/fidelite-geoplaque-report' }],
  ],
  outputDir: 'test-results/fidelite-geoplaque-artifacts',
  // Marge pour le cold-start Render (free tier) au login live.
  timeout: 420_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
