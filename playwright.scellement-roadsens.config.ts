/**
 * Playwright — SCELLEMENT DU DOCUMENT ROADSENS (option-3, DoD §8/§9).
 *
 * Prouve, sur le CLONE roadsens réel servi en `<iframe srcdoc sandbox>` via
 * ToolFrame (calcul EXCISÉ, recalcul serveur intercepté) :
 *   (2) FIDÉLITÉ DE CAPTURE : le `printHtml` émis par le bridge `snapshot:capture`
 *       reproduit À L'IDENTIQUE les zones .printable (pane-r + pane-d) rendues.
 *   (3) GARDE §8 SUR CONTENU RÉEL : ce printHtml passe la VRAIE garde serveur
 *       `assertInertHtml` (via scripts/assert-inert-run.mts en sous-processus).
 *   (a) CHEMIN loadPreset : la note de préset (pane-s) n'est ni imprimée ni capturée
 *       -> aucun document incomplet scellé.
 *
 * Réutilise le MÊME dispositif que le pilote de fidélité roadsens (stub backend
 * 3198 pour l'appel serveur→serveur /me/entitlements, next dev réel 3102, JWT_SECRET
 * partagé, distdir dédié). reuseExistingServer hors CI = réutilise le build fidélité.
 *
 * Lancer :
 *   npx playwright test --config=playwright.scellement-roadsens.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3102;
const STUB_PORT = 3198;
export const SC_JWT_SECRET = 'fidelite-roadsens-e2e-secret-32bytes-min-xxxxxxxx';
export const SC_WEB_PORT = WEB_PORT;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /scellement-roadsens-document\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/scellement-roadsens-report' }],
  ],
  outputDir: 'test-results/scellement-roadsens-artifacts',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node scripts/fidelite-roadsens-stub.mjs`,
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `pnpm --filter @roadsen/web exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        JWT_SECRET: SC_JWT_SECRET,
        PORT: String(WEB_PORT),
        ROADSEN_DISTDIR: '.next-fidelite-roadsens',
      },
    },
  ],
});
