/**
 * RESP-001 — responsivité de la mise en page master-détail (onglets Calculs / PV).
 *
 * Symptôme (ticket) : sous ~1140px, la colonne gauche (liste + bouton « Nouveau
 * calcul ») « sort du cadre » et le bouton d'ajout n'est plus visible.
 *
 * Invariants vérifiés à plusieurs largeurs (large, laptop étroit, très étroit) :
 *   - le bouton « Nouveau calcul » est VISIBLE et DANS le viewport ;
 *   - aucun DÉBORDEMENT horizontal (rien ne sort du cadre) ;
 *   - le drill-down étroit (liste → détail → retour) fonctionne ;
 *   - régression large : les deux colonnes coexistent, bouton visible.
 *
 * Mode MOCK (`?demo=active` + cookie) : aucune dépendance à l'API réelle.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CALCULS = '/app/be-routes-dakar/projets/proj_01/calculs?demo=active';
const PV = '/app/be-routes-dakar/projets/proj_01/pv?demo=active';
const SHOT_DIR = '/private/tmp/claude-501/-Users-macbook-Desktop-roadsen/970529db-8c11-49a7-8db2-4022338f02ed/scratchpad';

async function setMockAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: 'roadsen_mock_auth', value: '1', url: BASE_URL, sameSite: 'Lax' },
  ]);
}

/** true si aucun débordement horizontal (à 1px près). */
async function noHOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test.describe('RESP-001 — master-détail responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  // Largeurs clés, dont la BANDE 1025–1279px (sidebar déployée + drill-down actif) où
  // le bug RESP-001 se manifestait : la liste passait sous la sidebar.
  for (const width of [1440, 1280, 1200, 1140, 1100, 1000, 900]) {
    test(`Calculs @${width}px : « Nouveau calcul » visible, non masqué, sans débordement`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 820 });
      await page.goto(BASE_URL + CALCULS);

      const nouveau = page.getByRole('button', { name: /nouveau calcul/i });
      await expect(nouveau).toBeVisible({ timeout: 12000 });

      await page.screenshot({ path: `${SHOT_DIR}/resp-calculs-${width}.png` });

      const box = await nouveau.boundingBox();
      expect(box, 'boundingBox du bouton').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeLessThan(820);
      expect(await noHOverflow(page), 'pas de débordement horizontal').toBe(true);
      // OCCLUSION : le bouton ne doit pas être masqué par la sidebar (le trial click
      // échoue si un autre élément intercepte le pointeur au centre du bouton).
      await nouveau.click({ trial: true, timeout: 4000 });
    });
  }

  test('Calculs @1100px : drill-down liste → détail → retour', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 820 });
    await page.goto(BASE_URL + CALCULS);

    const calcRow = page
      .getByRole('button')
      .filter({ hasText: /dimensionnement|burmister|chaussée/i })
      .first();
    await expect(calcRow).toBeVisible({ timeout: 12000 });
    await calcRow.click();

    // en mode détail : bouton retour visible
    const back = page.getByRole('button', { name: /retour|liste/i }).first();
    await expect(back).toBeVisible({ timeout: 5000 });
    await back.click();

    // retour à la liste : bouton d'ajout de nouveau visible
    await expect(page.getByRole('button', { name: /nouveau calcul/i })).toBeVisible({ timeout: 5000 });
  });

  test('Calculs @1440px (régression large) : liste ET panneau détail coexistent', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto(BASE_URL + CALCULS);
    await expect(page.getByRole('button', { name: /nouveau calcul/i })).toBeVisible({ timeout: 12000 });
    // la liste (colonne gauche) et le panneau (droite) sont tous deux présents
    const listCol = page.locator('.calculs-list-col');
    const panel = page.locator('.calculs-panel');
    await expect(listCol).toBeVisible();
    await expect(panel).toBeVisible();
    const lb = await listCol.boundingBox();
    const pb = await panel.boundingBox();
    expect(lb).not.toBeNull();
    expect(pb).not.toBeNull();
    // côte à côte : le panneau commence après la liste
    expect(pb!.x).toBeGreaterThanOrEqual(lb!.x + lb!.width - 2);
  });

  test('PV @1100px : liste des PV sans débordement horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 820 });
    await page.goto(BASE_URL + PV);
    await expect(page.getByText(/scellé/i).first()).toBeVisible({ timeout: 12000 });
    await page.screenshot({ path: `${SHOT_DIR}/resp-pv-1100.png` });
    expect(await noHOverflow(page), 'pas de débordement horizontal (PV)').toBe(true);
  });
});
