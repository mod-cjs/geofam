/**
 * e2e LIVE — Console back-office SUPERADMIN contre l'app EN LIGNE.
 *
 *   Front  : https://roadsen.vercel.app   (Vercel)
 *   Backend: https://roadsen.onrender.com (Render — recette)
 *
 * Prouve, en vrai navigateur, que le SUPERADMIN se connecte et que la console
 * /admin (Lot 1 read-first) s'affiche avec de vraies données (orgs listées).
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

const SHOTS = path.resolve(__dirname, '../../test-results/live-admin');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

test.describe('LIVE — Console back-office SUPERADMIN (Vercel ↔ Render)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis (cible la prod en ligne).');
  test.skip(!EMAIL || !PASSWORD, 'SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD requis.');

  test('login superadmin -> /admin affiche les organisations réelles', async ({ page }) => {
    // 1) Login réel via le formulaire.
    await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.getByLabel('Adresse e-mail').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    // On attend la RÉPONSE /auth/login (200 = token posé) plutôt qu'une redirection :
    // le SUPERADMIN n'a pas d'org, donc la redirection tenant vers /app/:org n'a pas lieu.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 90_000 }),
      page.getByRole('button', { name: 'Se connecter' }).click(),
    ]);
    expect(resp.status(), 'le login superadmin doit renvoyer 200').toBe(200);

    // 2) Navigation explicite vers la console /admin (garde serveur : cookie -> GET /admin/me).
    await page.goto(`${FRONT}/admin/orgs`, { waitUntil: 'domcontentloaded', timeout: NAV });
    // Laisse la garde serveur + le fetch orgs se résoudre.
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'admin-orgs');

    // 3) La garde ne doit PAS avoir renvoyé vers /login (sinon cookie/role KO).
    expect(page.url(), 'ne doit pas être redirigé vers /login').toContain('/admin');

    // 4) Preuve POSITIVE : au moins une org RÉELLE de la DB est listée + marqueur back-office.
    await expect(
      page.getByText(/Bureau Demo STARFIRE|BET Demo Client/).first(),
      'la console doit lister une organisation réelle (données live via /admin/orgs)',
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/BACK-OFFICE/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
