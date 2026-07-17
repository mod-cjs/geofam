/**
 * Playwright — configuration DÉDIÉE au spec de FIDÉLITÉ D'INTERFACE TERZAGHI
 * (pilote « clone UI client », ADR 0015).
 *
 * Distinct des configs fidelite-roadsens / fidelite-geoplaque : celles-ci pilotent
 * l'app LIVE (Vercel↔Render). Ici on teste le PILOTE CLONE qui n'est PAS déployé —
 * on lance donc l'app en LOCAL, en MODE RÉEL, sur un port dédié (3101 ≠ 3100/3000),
 * avec :
 *   - NEXT_PUBLIC_API_BASE_URL → un stub backend local (port 3199) qui répond au
 *     SEUL appel serveur→serveur du route handler `/api/tools/:toolId`
 *     (`GET /me/entitlements`). page.route (navigateur) ne peut pas intercepter cet
 *     appel serveur ; sans lui, le clone n'est jamais servi (401). Tous les appels
 *     CLIENT (entitlements, projets, CALCUL) sont interceptés par page.route dans le
 *     spec — le stub refuse le calcul (405) pour garantir zéro faux-vert.
 *   - JWT_SECRET partagé : le middleware (serveur) vérifie le JWT HS256 ; le spec
 *     forge un token signé avec le MÊME secret (claim `orgs` = etude-terzaghi).
 *
 * Le HTML client de RÉFÉRENCE (`packages/engines/reference/terzaghi_V13.html`,
 * gelé, sha256 épinglé) est chargé en file:// (LECTURE seule — JAMAIS modifié).
 *
 * Lancer :
 *   corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-terzaghi.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3101;
const STUB_PORT = 3199;
export const TERZ_JWT_SECRET = 'fidelite-terzaghi-e2e-secret-32bytes-min-xxxxxxxx';
export const TERZ_WEB_PORT = WEB_PORT;
export const TERZ_STUB_PORT = STUB_PORT;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /fidelite-terzaghi-ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/fidelite-terzaghi-report' }],
  ],
  outputDir: 'test-results/fidelite-terzaghi-artifacts',
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
      command: `node scripts/fidelite-terzaghi-stub.mjs`,
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
        JWT_SECRET: TERZ_JWT_SECRET,
        PORT: String(WEB_PORT),
        // distDir isolé : évite le verrou dev Next 16 si un autre serveur dev tourne
        // déjà sur le même dossier (ex. environnement de démo local sur un autre port).
        ROADSEN_DISTDIR: '.next-fidelite-terzaghi',
      },
    },
  ],
});
