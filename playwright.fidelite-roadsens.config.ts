/**
 * Playwright — configuration DÉDIÉE au spec de FIDÉLITÉ D'INTERFACE ROADSENS.
 *
 * But : PROUVER les écarts UI / fonctionnement / affichage entre :
 *   - le HTML CLIENT gelé (référence) — packages/engines/reference/roadsens_burmister_definitive.html
 *     (v2.0.0, scellée ADR 0013), piloté dans un VRAI Chromium en file:// (LECTURE seule) ;
 *   - NOTRE app LIVE — https://roadsen.vercel.app (login geoplaque@starfire.test),
 *     org etude-geoplaque, logiciel ROADSENS.
 *
 * Ce spec ne compare pas des NOMBRES bruts serveur↔HTML (c'est le rôle de
 * equivalence-burmister-golden.spec.ts) : il CATALOGUE la structure d'interface des deux
 * côtés, prend des CAPTURES alignées, et compare l'AFFICHAGE bout-en-bout (onglets,
 * formulaires, catalogue/presets, panneau Résultats, rapport Détails 9 sections, valeurs
 * rendues). Même dispositif que playwright.fidelite-geoplaque.config.ts.
 *
 * Aucun webServer local : la cible NOUS est le déploiement LIVE (Vercel↔Render). Le HTML
 * client est chargé en file://. workers:1 (déterminisme, un seul navigateur).
 *
 * Lancer :
 *   corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-roadsens.config.ts
 *   # volet comparaison de VALEURS (consomme du quota, ≤ 6 calculs) :
 *   RUN_CALC=1 corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-roadsens.config.ts -g "comparaison des VALEURS"
 *
 * Variables d'env optionnelles (défauts = identifiants de la mission) :
 *   RS_EMAIL / RS_PASSWORD — compte de l'org etude-geoplaque (pack COMPLETE, 6 modules).
 *   RUN_CALC=1 — active le volet comparaison de valeurs (quota). Off par défaut.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /fidelite-roadsens-ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/fidelite-roadsens-report' }],
  ],
  outputDir: 'test-results/fidelite-roadsens-artifacts',
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
