/**
 * Playwright — config LIVE de MUTATION : AFFECTATION DES MODULES ET DES PACKS
 * d'un abonnement (back-office SUPERADMIN), et PREUVE DU GATE de calcul.
 *
 * Variante de playwright.mutations.config.ts ciblant
 * tests/e2e/live-admin-modules-packs.spec.ts. Ce spec EXÉCUTE réellement, contre
 * l'app EN LIGNE (Vercel ↔ Render) :
 *   - création d'org E2E-TEST-mods-<unique> via le wizard (pack ROUTES) ;
 *   - changement de PACK (ROUTES → COMPLETE) via la modal « Modules débloqués » ;
 *   - affectation/retrait de MODULES (checkboxes) ;
 *   - PREUVE DU GATE : owner d'org, module non affecté → 403 « Module non inclus »,
 *     module affecté → plus de 403 (calcul API direct, token owner + X-Org-Id) ;
 *   - vérification que /admin/audit trace les changements (ENTITLEMENTS_SET).
 *
 * Données STRICTEMENT préfixées `E2E-TEST-` (aucune donnée démo réelle touchée).
 * PAS de teardown ici : les ids créés sont journalisés pour l'orchestrateur.
 *
 * Lancer :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.modulespacks.config.ts
 *
 * Timeouts généreux : cold start Render (~60–90 s) + plusieurs allers-retours.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /live-admin-modules-packs\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/live-admin-modules-packs-artifacts',
  timeout: 300_000,
  use: {
    baseURL: 'https://roadsen.vercel.app',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
