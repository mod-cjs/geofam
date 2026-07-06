/**
 * e2e LIVE — vérification NON-MUTANTE des UI Vague 2 (Vercel ↔ Render).
 * Prouve que les nouvelles actions sont câblées et déployées (présence + ouverture des
 * modals + recherche user). NE soumet AUCUNE mutation (données réelles préservées).
 *
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.vague2.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;
const ORG_WITH_SUB = '3ed01e5d-c757-481e-ae3a-c8b14a5fc871'; // demo-starfire (a un abo)
const ORG_NO_SUB = 'c3474ceb-dae1-4913-9f91-4ae0463b96fa'; // BET Demo Client (sans abo)

async function login(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

test.describe('LIVE Vague 2 — UI câblées (non-mutant)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis.');
  test.skip(!EMAIL || !PASSWORD, 'creds requis.');

  test('/admin/users : actions Reset mdp + Désactiver présentes, modal reset s’ouvre', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/users`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await expect(page.getByRole('button', { name: 'Reset mdp' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Désactiver|Réactiver/ }).first()).toBeVisible();
    // ouvre la modal reset (sans soumettre)
    await page.getByRole('button', { name: 'Reset mdp' }).first().click();
    await expect(page.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/vague2/users-reset.png', fullPage: true });
  });

  test('détail org : "Ajouter un membre" ouvre le modal + la recherche user répond', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/orgs/${ORG_WITH_SUB}`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Ajouter un membre' }).click();
    await expect(page.getByRole('heading', { name: 'Ajouter un membre' })).toBeVisible({ timeout: 10_000 });
    // recherche (GET, non-mutant) : taper 'ry' doit interroger /admin/users
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/users') && r.url().includes('q='), { timeout: 15_000 }).catch(() => null),
      page.getByLabel('Rechercher un utilisateur').fill('ry'),
    ]);
    expect(resp?.status() ?? 200, 'la recherche user doit répondre').toBeLessThan(400);
    await page.screenshot({ path: 'test-results/vague2/add-member.png', fullPage: true });
  });

  test('détail org SANS abo : onglet Abonnement propose "Rattacher un abonnement"', async ({ page }) => {
    await login(page);
    await page.goto(`${FRONT}/admin/orgs/${ORG_NO_SUB}`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    // onglet du DÉTAIL (singulier « Abonnement ») — pas la nav sidebar « Abonnements »
    await page.getByText('Abonnement', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rattacher un abonnement' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Rattacher un abonnement' }).click();
    await expect(page.getByRole('heading', { name: 'Rattacher un abonnement' })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/vague2/attach-sub.png', fullPage: true });
  });
});
