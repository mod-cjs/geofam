/**
 * e2e LIVE — closeout : les 6 logiciels de la plateforme se chargent sur Vercel,
 * ont un projet selectionnable (domaine) et CALCULENT cote serveur (Render) sans crash.
 * Compte demo tenant reel (org demo-starfire, pack PLATEFORME = tous modules ;
 * entitlements groupes : GEOPLAQUE->radier, pressio-etalonnage/calibrage->pressiometre).
 *
 *   RUN_LIVE=1 corepack pnpm@9.12.0 exec playwright test --config=playwright.allengines.config.ts
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

// domaine attendu du picker par logiciel (informe le seuil d'options attendu)
const ENGINES = [
  { slug: 'roadsens', label: 'ROADSENS (chaussées)' },
  { slug: 'terzaghi', label: 'Terzaghi (superficielles)' },
  { slug: 'casagrande', label: 'CASAGRANDE (pieux)' },
  { slug: 'geoplaque', label: 'GEOPLAQUE (radier)' },
  { slug: 'pressiopro', label: 'PressioPro (Ménard)' },
  { slug: 'fastlab', label: 'FASTLAB (labo GTR)' },
];

test.describe('LIVE closeout — les 6 logiciels chargent + calculent (Vercel↔Render)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis.');

  for (const e of ENGINES) {
    test(`${e.slug} (${e.label}) : charge, projet sélectionnable, calcule sans crash`, async ({ page }) => {
      await login(page);
      await page.goto(`${FRONT}/app/${ORG}/logiciels/${e.slug}`, { waitUntil: 'domcontentloaded', timeout: NAV });
      await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

      // pas d'écran d'erreur SSR
      await expect(page.getByText(/couldn.t load|server error|Application error|page n.a pas pu/i)).toHaveCount(0);

      // un déclencheur de calcul est présent (testid ou libellé « Calculer »)
      const calcBtn = page
        .getByTestId('btn-calculer')
        .or(page.getByRole('button', { name: /^Calculer/i }).first());
      await expect(calcBtn.first()).toBeVisible({ timeout: 30_000 });

      // projet sélectionnable (picker par domaine peuplé)
      const picker = page.getByRole('combobox', { name: 'Projet' }).first();
      await expect
        .poll(async () => picker.locator('option').count(), { timeout: 25_000 })
        .toBeGreaterThan(2);
      await picker.selectOption({ index: 1 });

      // CALCUL serveur : le POST /calc part et NE crashe PAS le serveur (status < 500).
      // (un 400 de validation resterait acceptable ici = formulaire a completer, pas un crash ;
      //  mais avec les defauts du formulaire on attend un succes pour la plupart.)
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/calc') && r.request().method() === 'POST', { timeout: 90_000 }),
        calcBtn.first().click(),
      ]);
      expect(resp.status(), `calcul ${e.slug} : le serveur ne doit pas planter (5xx)`).toBeLessThan(500);
      // pas d'erreur interne affichée
      await expect(page.getByText(/Erreur interne|server error|couldn.t load/i)).toHaveCount(0);
      await page.screenshot({ path: `test-results/all-engines/${e.slug}.png`, fullPage: true });
      // trace du statut pour le rapport
      console.log(`[${e.slug}] calc HTTP ${resp.status()}`);
    });
  }
});
