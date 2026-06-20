/**
 * Playwright — configuration minimale (smoke e2e).
 *
 * Le job CI `e2e` (uniquement au merge sur main) installe Chromium puis lance
 * `pnpm test:e2e` (= `playwright test`). On garde ICI un harnais leger : un
 * smoke test e2e suffit pour le socle ; les parcours lourds (auth, multi-tenant,
 * generation de PV) arriveront avec les features correspondantes.
 *
 * Le `webServer` (lancement de l app web) est volontairement DESACTIVE tant que
 * l app n expose pas de page stable a tester : on n active un parcours reseau
 * qu une fois la cible reelle disponible (pas de faux-vert e2e). Voir le smoke
 * test (tests/e2e/smoke.spec.ts) qui s auto-skippe en l absence de BASE_URL.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    ...(BASE_URL ? { baseURL: BASE_URL } : {}),
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer: a activer quand l app web exposera une page e2e stable :
  // webServer: {
  //   command: 'pnpm --filter @roadsen/web start',
  //   url: BASE_URL ?? 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
