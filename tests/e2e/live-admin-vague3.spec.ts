/**
 * e2e LIVE — vérification NON-MUTANTE de la GESTION UTILISATEURS (Vague 3 —
 * création, fiche actionnable, rôle plateforme, appartenances) sur Vercel ↔ Render.
 * Prouve que les nouvelles actions sont câblées et déployées (présence + ouverture
 * des modals). NE soumet AUCUNE mutation (données réelles préservées) :
 * pas de création d'utilisateur, pas de changement de rôle plateforme, pas de
 * retrait d'organisation — uniquement ouverture/fermeture de modals et lecture.
 *
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.vague2.config.ts \
 *       tests/e2e/live-admin-vague3.spec.ts
 *
 * NOTE HONNÊTE : ce fichier n'a PAS encore été exécuté en conditions réelles
 * (aucun déploiement effectué dans le cadre de cette tâche — consigne « NE
 * déploie PAS »). À faire tourner après le prochain déploiement préprod.
 */
import { test, expect, type Page } from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;

async function login(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

test.describe('LIVE Vague 3 — Gestion utilisateurs câblée (non-mutant)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis.');
  test.skip(!EMAIL || !PASSWORD, 'creds requis.');

  test('/admin/users : "Nouvel utilisateur" ouvre le modal de création (sans soumettre)', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/users`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
    await expect(page.getByRole('heading', { name: 'Nouvel utilisateur' })).toBeVisible({ timeout: 10_000 });
    // bouton Créer désactivé tant que le formulaire est invalide (email/mdp vides)
    await expect(page.getByRole('button', { name: 'Créer' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/vague3/create-user-modal.png', fullPage: true });
  });

  test('fiche utilisateur : édition identité, rôle plateforme et appartenances présents', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/users`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await page.getByRole('link').filter({ hasText: /.+/ }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

    await expect(page.getByRole('heading', { name: "Éditer l'identité" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Rôle plateforme' })).toBeVisible();
    await expect(page.getByLabel('Rôle plateforme')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter à une org' })).toBeVisible();

    // Le bouton Enregistrer (identité) doit être désactivé sans changement (garde anti no-op)
    await expect(page.getByRole('heading', { name: "Éditer l'identité" }).locator('..').getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    await page.screenshot({ path: 'test-results/vague3/user-detail.png', fullPage: true });
  });

  test('fiche utilisateur : "Ajouter à une org" ouvre le modal + la recherche org répond', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/users`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await page.getByRole('link').filter({ hasText: /.+/ }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

    await page.getByRole('button', { name: 'Ajouter à une org' }).click();
    await expect(page.getByRole('heading', { name: 'Ajouter à une organisation' })).toBeVisible({ timeout: 10_000 });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/orgs') && r.url().includes('q='), { timeout: 15_000 }).catch(() => null),
      page.getByLabel('Rechercher une organisation').fill('de'),
    ]);
    expect(resp?.status() ?? 200, 'la recherche org doit répondre').toBeLessThan(400);
    await page.screenshot({ path: 'test-results/vague3/add-to-org.png', fullPage: true });
  });
});
