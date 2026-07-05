/**
 * e2e LIVE — Console back-office SUPERADMIN contre l'app EN LIGNE.
 *
 *   Front  : https://roadsen.vercel.app   (Vercel)
 *   Backend: https://roadsen.onrender.com (Render — recette)
 *
 * Prouve, en vrai navigateur : (1) le login SUPERADMIN REDIRIGE automatiquement vers
 * /admin (fix : un compte sans org part au back-office) — /admin est désormais le
 * TABLEAU DE BORD (Vague B), plus un simple redirect vers /admin/orgs ; (2) la console
 * orgs liste les orgs réelles ; (3) la page DÉTAIL d'une org se charge (fix : plus de
 * crash SSR dû à un gestionnaire onMouseOver dans un Server Component) ; (4) Vague B —
 * tableau de bord (KPI), audit global, console abonnements se chargent (migration
 * 0014) ; (5) /app redirige sans 404 (fix lien "Retour à l'app" de AdminTopbar).
 *
 * ⚠️ Vague B cible l'API 0014 (stats/audit/subscriptions enrichis) — PAS ENCORE
 * déployée sur Render au moment de l'écriture. Ces specs sont écrites test-first
 * (DoD §9) mais ne passeront qu'une fois le backend déployé ; ne pas s'attendre à un
 * vert immédiat en RUN_LIVE tant que le déploiement n'est pas fait.
 *
 * Identifiants via ENV (jamais en dur / commité) :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.admin.config.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { test, expect, type Page } from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;
const DEMO_ORG_ID = '3ed01e5d-c757-481e-ae3a-c8b14a5fc871';

const SHOTS = path.resolve(__dirname, '../../test-results/live-admin');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

/** Remplit et soumet le formulaire de login (sans forcer de destination). */
async function submitLogin(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
  expect(resp.status(), 'le login superadmin doit renvoyer 200').toBe(200);
}

test.describe('LIVE — Console back-office SUPERADMIN (Vercel ↔ Render)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis (cible la prod en ligne).');
  test.skip(!EMAIL || !PASSWORD, 'SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD requis.');

  test('login superadmin -> REDIRECTION AUTO vers /admin (tableau de bord)', async ({ page }) => {
    await submitLogin(page);
    // FIX #1 : redirection automatique vers le back-office (aucune navigation manuelle).
    // /admin est désormais le TABLEAU DE BORD (Vague B) — plus un redirect vers /admin/orgs.
    await page.waitForURL(/\/admin\/?$/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-dashboard');
    expect(page.url(), 'doit atterrir sur /admin (pas la galerie tenant ni /)').toContain('/admin');
    await expect(page.getByText(/BACK-OFFICE/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Tableau de bord' }),
      'le tableau de bord doit afficher son titre',
    ).toBeVisible({ timeout: 30_000 });
  });

  test('liste des organisations : orgs réelles visibles', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/admin/orgs`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-orgs');
    await expect(
      page.getByText(/Bureau Demo STARFIRE|BET Demo Client/).first(),
      'la console doit lister une organisation réelle',
    ).toBeVisible({ timeout: 30_000 });
  });

  test('détail org SE CHARGE (pas de crash SSR) + onglets visibles', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/admin/orgs/${DEMO_ORG_ID}`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-org-detail');
    // FIX #2 : la page ne doit PAS afficher l'écran d'erreur serveur Next.js.
    await expect(
      page.getByText(/couldn.t load|server error|page n.a pas pu/i),
      'la page détail ne doit pas crasher (plus de gestionnaire dans le Server Component)',
    ).toHaveCount(0);
    // Preuve positive : le nom de l'org + au moins un onglet du détail.
    await expect(page.getByText('Bureau Demo STARFIRE').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Membres|Abonnement|Usage/).first(),
      'les onglets du détail doivent être visibles',
    ).toBeVisible({ timeout: 20_000 });
  });

  // ============================ Vague B — nouvelles vues globales ============================

  test('tableau de bord /admin : KPI + alertes/flux visibles, pas de crash', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/admin`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-dashboard-kpi');
    await expect(
      page.getByText(/couldn.t load|server error|page n.a pas pu/i),
      'le tableau de bord ne doit pas crasher',
    ).toHaveCount(0);
    await expect(page.getByText(/Organisations actives/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Activité récente/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('audit global /admin/audit : tableau + filtres visibles, pas de crash', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/admin/audit`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-audit');
    await expect(
      page.getByText(/couldn.t load|server error|page n.a pas pu/i),
      "la page d'audit ne doit pas crasher",
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: "Journal d'audit" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Filtrer par action')).toBeVisible({ timeout: 15_000 });
  });

  test('console abonnements /admin/subscriptions : tableau + filtres visibles, pas de crash', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/admin/subscriptions`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-subscriptions');
    await expect(
      page.getByText(/couldn.t load|server error|page n.a pas pu/i),
      'la console abonnements ne doit pas crasher',
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Abonnements' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Filtrer par famille d'abonnement")).toBeVisible({ timeout: 15_000 });
  });

  test('lien "Retour à l\'app" (/app) NE 404 PLUS jamais pour un SUPERADMIN', async ({ page }) => {
    await submitLogin(page);
    await page.goto(`${FRONT}/app`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'app-redirect');
    // FIX #5 : /app doit rediriger (1re org, ou /admin si aucune) — jamais 404.
    await expect(page.getByText(/404|This page could not be found/i)).toHaveCount(0);
    expect(page.url(), 'doit repartir vers une org (/app/{slug}) ou /admin, jamais rester 404 sur /app nu').toMatch(
      /\/app\/[^/]+|\/admin/,
    );
  });
});
