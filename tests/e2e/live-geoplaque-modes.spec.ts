/**
 * e2e LIVE — les 3 solveurs 2D de GEOPLAQUE (déformations planes, axisymétrique,
 * radier triangulaire) se chargent sur Vercel sans crash, DEPUIS l'onglet « 2D »
 * du logiciel GEOPLAQUE (consolidation : ce ne sont plus des logiciels séparés,
 * ce sont des modes de GEOPLAQUE — cf. pane-ps du client GEOPLAQUE_V10.html).
 * Compte démo tenant réel (org demo-starfire, pack PLATEFORME = tous modules).
 *
 *   RUN_LIVE=1 corepack pnpm@9.12.0 exec playwright test --config=playwright.live.config.ts \
 *     tests/e2e/live-geoplaque-modes.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const CREDS = { email: 'demo@starfire.test', password: 'RoadsenDemo2026!' };
const ORG = 'demo-starfire';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;

async function login(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(CREDS.email);
  await page.getByLabel('Mot de passe').fill(CREDS.password);
  await Promise.all([
    page.waitForURL(/\/app\/demo-starfire\/(logiciels|projets)/, { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

/** Ouvre GEOPLAQUE, sélectionne un projet FD (onglet Modèle & sol), puis passe sur l'onglet 2D. */
async function openGeoplaque2d(page: Page) {
  await page.goto(`${FRONT}/app/${ORG}/logiciels/geoplaque`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
  await expect(
    page.getByText(/couldn.t load|server error|Application error|page n.a pas pu/i),
  ).toHaveCount(0);
  const picker = page.getByRole('combobox', { name: 'Projet' });
  await expect
    .poll(async () => picker.locator('option').count(), { timeout: 25_000 })
    .toBeGreaterThan(2);
  await picker.selectOption({ index: 1 });
  await page.getByRole('tab', { name: '2D' }).click();
}

const MODES = [
  { slug: 'plane-strain', label: 'déformations planes' },
  { slug: 'axi', label: 'axisymétrique' },
  { slug: 'tri-raft', label: 'radier triangulaire' },
];

test.describe('LIVE — GEOPLAQUE onglet 2D, 3 solveurs (Vercel)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis.');

  for (const m of MODES) {
    test(`${m.slug} (${m.label}) : le solveur charge dans l'onglet 2D, calcule, pas de crash`, async ({ page }) => {
      await login(page);
      await openGeoplaque2d(page);

      const calcBtn = page.getByTestId(`btn-calculer-${m.slug}`);
      await expect(calcBtn).toBeVisible({ timeout: 30_000 });

      // CALCUL RÉEL (chaîne Vercel→Render→dispatch→moteur→adapter), avec les défauts du form.
      const [calcResp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/calc') && r.request().method() === 'POST', { timeout: 90_000 }),
        calcBtn.click(),
      ]);
      expect(calcResp.status(), `calcul ${m.slug} doit réussir (dispatch serveur)`).toBeLessThan(300);
      await expect(page.getByText(/couldn.t load|server error|Erreur interne/i)).toHaveCount(0);
      await expect(page.getByTestId(`resultats-${m.slug}`).getByText(/mm|tassement|Résultat|kN/i).first()).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `test-results/geoplaque-modes/${m.slug}.png`, fullPage: true });
    });
  }

  test('tri-raft affiche le bandeau d\'avertissement (charges soil / moments ignorés)', async ({ page }) => {
    await login(page);
    await openGeoplaque2d(page);
    await expect(page.getByTestId('tri-raft-warning')).toBeVisible({ timeout: 20_000 });
  });
});
