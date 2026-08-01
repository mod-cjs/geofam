/**
 * Playwright — configuration DÉDIÉE au spec de FIDÉLITÉ D'INTERFACE CASAGRANDE
 * (fondations profondes / pieux, NF P 94-262 / Eurocode 7 ; « clone UI client »,
 * ADR 0015).
 *
 * Calquée sur `playwright.fidelite-pressiopro.config.ts` (dernier pilote validé).
 * On teste le CLONE qui n'est PAS déployé — on lance donc l'app en LOCAL, en MODE
 * RÉEL, sur des ports DÉDIÉS pour ne jamais entrer en collision avec les autres
 * moteurs de fidélité (terzaghi 3101/3199, roadsens 3102/3198, pressiopro
 * 3104/3196, fastlab 3106/3194 ; geoplaque est LIVE — pas de port de fidélité dédié) :
 *   - web  = 3105
 *   - stub = 3195  (backend minimal ; sert le SEUL appel serveur→serveur du route
 *     handler `GET /me/entitlements`). page.route (navigateur) ne peut pas intercepter
 *     cet appel serveur ; sans lui, le clone n'est jamais servi (401). Tous les appels
 *     CLIENT (entitlements, projets, CALCUL) sont interceptés par page.route dans le
 *     spec — le stub refuse le calcul (405) pour garantir zéro faux-vert.
 *   - distDir = .next-fidelite-casagrande  (isolé : évite le verrou dev Next si un
 *     autre serveur dev tourne sur le même dossier).
 *   - JWT_SECRET dédié : le middleware (serveur) vérifie le JWT HS256 ; le spec forge
 *     un token signé avec le MÊME secret (claim `orgs` = etude-fid-casagrande).
 *
 * Le HTML client de RÉFÉRENCE (`packages/engines/reference/casagrande_V5.html`, gelé,
 * sha256 épinglé au registre) est chargé en file:// (LECTURE seule — JAMAIS modifié).
 *
 * Lancer :
 *   npx playwright test --config=playwright.fidelite-casagrande.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3105;
const STUB_PORT = 3195;
export const CASA_JWT_SECRET = 'fidelite-casagrande-e2e-secret-32bytes-min-xx';
export const CASA_WEB_PORT = WEB_PORT;
export const CASA_STUB_PORT = STUB_PORT;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /fidelite-casagrande-ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/fidelite-casagrande-report' }],
  ],
  outputDir: 'test-results/fidelite-casagrande-artifacts',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Stub backend (appel serveur→serveur du route handler uniquement).
      command: `node scripts/fidelite-casagrande-stub.mjs`,
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      // App Next.js en MODE RÉEL sur port dédié.
      command: `pnpm --filter @roadsen/web exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        JWT_SECRET: CASA_JWT_SECRET,
        PORT: String(WEB_PORT),
        ROADSEN_DISTDIR: '.next-fidelite-casagrande',
      },
    },
  ],
});
