/**
 * Playwright — configuration DÉDIÉE au spec de FIDÉLITÉ D'INTERFACE ROADSENS
 * (généralisation « clone UI client », ADR 0015 — roadsens = burmister).
 *
 * MODERNISÉE (17/07/2026) sur le patron pilote terzaghi : l'app ROADSENS ne
 * reconstruit PLUS une page React — elle sert le CLONE fidèle de la définitive
 * client (`apps/web/src/tools-cloned/roadsens.html`, calcul EXCISÉ) en
 * `<iframe srcdoc sandbox>` via `ToolFrame`, dont le calcul part côté SERVEUR
 * (DoD §8). On ne cible donc plus le déploiement LIVE (Vercel↔Render) : on lance
 * l'app en LOCAL, en MODE RÉEL, sur un port DÉDIÉ (3102 ≠ 3100/3101/3000), avec :
 *   - NEXT_PUBLIC_API_BASE_URL → un stub backend local (port 3198) qui répond au
 *     SEUL appel serveur→serveur du route handler `/api/tools/:toolId`
 *     (`GET /me/entitlements`). page.route (navigateur) ne peut pas intercepter cet
 *     appel serveur ; sans lui, le clone n'est jamais servi (401). Tous les appels
 *     CLIENT (entitlements, projets, CALCUL) sont interceptés par page.route dans le
 *     spec — le stub refuse le calcul (405) pour garantir zéro faux-vert.
 *   - JWT_SECRET partagé : le middleware (serveur) vérifie le JWT HS256 ; le spec
 *     forge un token signé avec le MÊME secret (claim `orgs` = etude-roadsens).
 *   - ROADSEN_DISTDIR dédié : évite le verrou dev Next 16 si un autre serveur dev
 *     (démo locale, spec terzaghi) tourne déjà sur le même dossier.
 *
 * Le HTML client de RÉFÉRENCE (`packages/engines/reference/roadsens_burmister_definitive.html`,
 * v2.0.0, scellé ADR 0013, sha256 épinglé) est chargé en file:// (LECTURE seule —
 * JAMAIS modifié). workers:1 (déterminisme, un seul navigateur).
 *
 * Lancer :
 *   npx playwright test --config=playwright.fidelite-roadsens.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3102;
const STUB_PORT = 3198;
export const RS_JWT_SECRET = 'fidelite-roadsens-e2e-secret-32bytes-min-xxxxxxxx';
export const RS_WEB_PORT = WEB_PORT;
export const RS_STUB_PORT = STUB_PORT;

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
      command: `node scripts/fidelite-roadsens-stub.mjs`,
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
        JWT_SECRET: RS_JWT_SECRET,
        PORT: String(WEB_PORT),
        ROADSEN_DISTDIR: '.next-fidelite-roadsens',
      },
    },
  ],
});
