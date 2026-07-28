/**
 * Playwright — NOTE + SCELLEMENT DU DOCUMENT PRESSIOPRO (6e moteur, DoD §8/§9).
 *
 * Comble la dette de patron : les 5 autres logiciels ont un e2e navigateur dédié
 * (fidélité/scellement) ; PressioPro n'avait que des unitaires (`clone-render.test`,
 * `contract.test`) + le contrôle d'impression. Cette config exécute le SEUL spec
 * `tests/e2e/pressiopro-note-scellement.spec.ts` — parcours réel du clone servi en
 * `<iframe srcdoc sandbox>` (calcul EXCISÉ, recalcul serveur), sur backend e2e :
 *
 *   (1) NOTE : Exemple fictif → Calculer (dépouillement) → la note s'affiche
 *       (E_M, catégorie, courbe P–V) → Sceller → le PV scellé se re-sert.
 *   (2) GARDE DE COURSE dry-run : un aperçu (`dryRun`) n'active PAS l'émission de PV
 *       et NE crée AUCUN calcul scellable ; seul un vrai « Calculer » le permet.
 *   (3) §8 : le document scellé n'embarque ni symbole moteur, ni <canvas>, ni image
 *       `data:` (courbe canvas re-dessinée en SVG inline), et passe la VRAIE garde
 *       serveur `assertInertHtml`.
 *
 * Réutilise le MÊME dispositif que les pilotes fidélité/scellement (stub backend
 * pour l'appel SERVEUR→SERVEUR /me/entitlements, next dev réel, JWT_SECRET partagé,
 * distdir dédié). Le stub `fidelite-roadsens-stub.mjs` accorde déjà le module
 * `pressiometre` (pack COMPLETE). Tous les appels CLIENT (entitlements, projets,
 * calc, snapshot, pv) sont interceptés par `page.route` dans le spec.
 *
 * Lancer :
 *   npx playwright test --config=playwright.scellement-pressiopro.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3103;
const STUB_PORT = 3196;
export const PP_JWT_SECRET = 'scellement-pressiopro-e2e-secret-32bytes-min-xxxx';
export const PP_WEB_PORT = WEB_PORT;
export const PP_STUB_PORT = STUB_PORT;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /pressiopro-note-scellement\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: 'test-results/scellement-pressiopro-report' },
    ],
  ],
  outputDir: 'test-results/scellement-pressiopro-artifacts',
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
        JWT_SECRET: PP_JWT_SECRET,
        PORT: String(WEB_PORT),
        ROADSEN_DISTDIR: '.next-scellement-pressiopro',
      },
    },
  ],
});
