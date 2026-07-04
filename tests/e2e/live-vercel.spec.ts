/**
 * e2e LIVE — Parcours utilisateur contre l'app EN LIGNE (réelle, pas de mock).
 *
 *   Front  : https://roadsen.vercel.app   (Vercel)
 *   Backend: https://roadsen.onrender.com (Render — recette)
 *
 * C'est du e2e RÉEL : vrai navigateur (chromium headless), vrai front, vrai
 * backend, vraie donnée. Le login est SOUMIS (pas de cookie mock) ; l'app pose
 * le token et le middleware (jose) gère la suite.
 *
 * Compte de démo (réel) :
 *   demo@starfire.test / RoadsenDemo2026!  → org « demo-starfire » (role OWNER)
 *   Donnée existante : 1 projet « Projet Demo - Chaussee RN1 »,
 *     1 calcul (chaussee-burmister), 1 PV (PV-RDS-demo-starfire-2026-000001).
 *
 * ⚠️ Render free tier = cold start ~60-90 s à la 1re requête → timeouts généreux.
 *
 * Ce spec est INDÉPENDANT de la couche mock (specs shell-parcours / recette-calc).
 * Il ne tourne QUE quand RUN_LIVE=1 est posé, pour ne pas s'exécuter par accident
 * dans la suite locale/CI mock (zéro faux-vert : pas de skip silencieux ailleurs,
 * mais ici on cible explicitement la prod en ligne sur demande).
 *
 * Lancer :
 *   RUN_LIVE=1 corepack pnpm@9.12.0 exec playwright test tests/e2e/live-vercel.spec.ts \
 *     --config=playwright.live.config.ts --project=chromium
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, type Page, type Browser } from '@playwright/test';

const LIVE_FRONT = 'https://roadsen.vercel.app';
const LIVE_API = 'https://roadsen.onrender.com';

const CREDS = { email: 'demo@starfire.test', password: 'RoadsenDemo2026!' };
const ORG_SLUG = 'demo-starfire';
const PROJETS_URL = `${LIVE_FRONT}/app/${ORG_SLUG}/projets`;

// Répertoire de preuves (screenshots) — gitignored (test-results/).
const SHOTS = path.resolve(__dirname, '../../test-results/live-vercel');
fs.mkdirSync(SHOTS, { recursive: true });

const NAV = 120_000; // navigation : tolère le cold start Render
const RUN = process.env.RUN_LIVE === '1';

function shot(page: Page, name: string) {
  return page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/**
 * Login RÉEL : remplit et soumet le formulaire, attend la redirection projets.
 * En cas d'échec, capture le message d'alerte pour rendre la cause explicite
 * (la latence Render est absorbée par le warm-up ; un 4xx revient vite).
 */
async function login(page: Page) {
  await page.goto(`${LIVE_FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(CREDS.email);
  await page.getByLabel('Mot de passe').fill(CREDS.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  // Attendre la REDIRECTION vers l'app (= seul signal de succès fiable). Un échec
  // se traduit par un timeout. NE PAS racer sur l'alerte : le conteneur role="alert"
  // du formulaire est toujours présent/visible (même vide) → la course se résolvait
  // instantanément et concluait à l'échec à tort (faux négatif).
  try {
    await page.waitForURL(/\/app\/demo-starfire\/(logiciels|projets)/, { timeout: 60_000 });
  } catch {
    const alertTxt = (await page.getByRole('alert').first().textContent().catch(() => '')) ?? '';
    await shot(page, 'B1-ECHEC-login');
    throw new Error(
      `Login échoué : on reste sur ${page.url()}. Message d'alerte: « ${alertTxt.trim()} ».`,
    );
  }
}

// ===========================================================================
// Suite SÉRIELLE — un seul parcours utilisateur continu (session réelle unique),
// pour minimiser les logins et refléter un vrai usage. Chaque étape = un test
// avec une assertion qui PROUVE le comportement réel + un screenshot de preuve.
// ===========================================================================

test.describe.configure({ mode: 'serial' });

test.describe('LIVE — Parcours utilisateur app en ligne (Vercel ↔ Render)', () => {
  test.skip(!RUN, 'Live désactivé : poser RUN_LIVE=1 pour cibler la prod en ligne.');

  let browser: Browser;
  let page: Page;

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    // Réveil de l'API Render (cold start) AVANT le 1er test pour absorber la latence.
    try {
      const ctxReq = await browser.newContext();
      await ctxReq.request.post(`${LIVE_API}/auth/login`, {
        data: CREDS,
        timeout: NAV,
        failOnStatusCode: false,
      });
      await ctxReq.close();
    } catch {
      // Le warm-up est best-effort ; les timeouts NAV couvrent le cold start résiduel.
    }
    const ctx = await browser.newContext({ acceptDownloads: true });
    page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(NAV);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  // ---- B1 : Login réel ----------------------------------------------------
  test('B1 — login réel : formulaire soumis → accueil galerie GEOFAM', async () => {
    await login(page);
    // L'accueil est désormais la galerie des logiciels GEOFAM.
    await expect(page.getByRole('heading', { name: 'GEOFAM' })).toBeVisible({ timeout: NAV });
    await shot(page, 'B1-accueil-galerie');
  });

  // ---- C1 : Liste projets -------------------------------------------------
  test('C1 — liste projets : « Projet Demo - Chaussee RN1 » visible (donnée réelle)', async () => {
    const card = page.getByText(/Chaussee RN1/i).first();
    await expect(card).toBeVisible({ timeout: NAV });
    await shot(page, 'C1-liste-projets');
  });

  // ---- C2 : Nouveau projet (bouton + modale) ------------------------------
  // On OUVRE la modale pour prouver le chemin de création, mais on NE crée PAS
  // de projet (pas de pollution de la donnée démo réelle). Honnêteté : on teste
  // la présence/ouverture, pas l'écriture serveur.
  test('C2 — « Nouveau projet » : bouton présent, modale de création s\'ouvre (sans créer)', async () => {
    await page.getByRole('button', { name: /nouveau projet/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/nom du projet/i)).toBeVisible();
    await shot(page, 'C2-modale-nouveau-projet');
    // Refermer sans créer (Échap).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  // ---- C3 : Ouvrir le projet → onglet Calculs par défaut ------------------
  test('C3 — ouvrir le projet → redirection onglet Calculs (F-02)', async () => {
    // La carte projet est un role="listitem" (aria-label « Projet … Chaussee RN1 »),
    // pas un <a> — clic via le rôle réel.
    await page.getByRole('listitem', { name: /Chaussee RN1/i }).first().click();
    await expect(page).toHaveURL(/\/projets\/[^/]+\/calculs/, { timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: NAV }).catch(() => {});
    await shot(page, 'C3-onglet-calculs');
  });

  // ---- C8 / C6 / C7 : master-detail + résultats + verdict -----------------
  test('C8/C6/C7 — calcul existant listé, sélection → résultats + bandeau de verdict', async () => {
    const calcRow = page.locator('[data-testid^="calc-row-"]').first();
    await expect(calcRow).toBeVisible({ timeout: NAV });
    await calcRow.click();
    // Verdict : VerdictBanner expose aria-label « Verdict : CONFORME|NON CONFORME ».
    const verdict = page.getByLabel(/Verdict\s*:/i).first();
    await expect(verdict).toBeVisible({ timeout: 30_000 });
    const verdictText = (await verdict.getAttribute('aria-label')) ?? '';
    expect(verdictText).toMatch(/CONFORME|NON CONFORME/i);
    await shot(page, 'C6-C7-C8-detail-verdict');
  });

  // ---- D3 / D5 : onglet PV, PV listé --------------------------------------
  let pvProjUrl = '';
  test('D3/D5 — onglet PV : le PV PV-RDS-demo-starfire-2026-000001 est listé', async () => {
    const calcUrl = page.url();
    pvProjUrl = calcUrl.replace(/\/calculs.*$/, '/pv');
    await page.goto(pvProjUrl, { waitUntil: 'domcontentloaded', timeout: NAV });
    const pv = page.getByText(/PV-RDS-demo-starfire-2026-000001/i).first();
    await expect(pv).toBeVisible({ timeout: NAV });
    // Badge « Scellé » présent (ADR 0008).
    await expect(page.getByText(/scellé/i).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'D3-D5-onglet-pv');
  });

  // ---- D4 : Télécharger le PDF (download réel) ----------------------------
  test('D4 — télécharger le PDF scellé : un fichier .pdf non vide est reçu', async () => {
    const dlBtn = page.getByRole('button', { name: /Télécharger le PDF/i }).first();
    await expect(dlBtn).toBeVisible({ timeout: 15_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      dlBtn.click(),
    ]);
    const suggested = download.suggestedFilename();
    expect(suggested).toMatch(/\.pdf$/i);
    const dest = path.join(SHOTS, suggested);
    await download.saveAs(dest);
    const size = fs.statSync(dest).size;
    expect(size, 'PDF téléchargé vide').toBeGreaterThan(1000);
    // En-tête PDF binaire : doit commencer par %PDF.
    const head = fs.readFileSync(dest).subarray(0, 5).toString('latin1');
    expect(head).toContain('%PDF');
    await shot(page, 'D4-apres-download-pv');
  });

  // ---- E1 : état nominal (org ACTIVE, quota 1000) -------------------------
  // Les états expiré/quota épuisé ne sont PAS reproductibles sur ce compte
  // (org démo active) → on NE les simule pas. On constate l'état nominal :
  // pas de bannière « lecture seule » / « quota épuisé », calculs accessibles.
  test('E1 — org ACTIVE : aucune bannière de blocage gating (état nominal)', async () => {
    await page.goto(pvProjUrl.replace(/\/pv$/, '/calculs'), {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await expect(
      page.getByRole('alert').filter({ hasText: /lecture seule|quota épuisé|abonnement expiré/i }),
    ).toHaveCount(0, { timeout: 15_000 });
    await shot(page, 'E1-etat-nominal-actif');
  });

  // ---- F1 : Bibliothèque de moteurs --------------------------------------
  test('F1 — bibliothèque de moteurs accessible', async () => {
    await page.goto(`${LIVE_FRONT}/app/${ORG_SLUG}/bibliotheque`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await expect(page.getByRole('heading', { name: /Bibliothèque de moteurs/i })).toBeVisible({
      timeout: NAV,
    });
    await shot(page, 'F1-bibliotheque');
  });

  // ---- G2 : Mon compte ----------------------------------------------------
  test('G2 — page Mon compte accessible', async () => {
    await page.goto(`${LIVE_FRONT}/app/${ORG_SLUG}/compte`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    // L'e-mail réel du compte doit apparaître quelque part sur la page profil.
    await expect(page.getByText(new RegExp(CREDS.email, 'i')).first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, 'G2-compte');
  });

  // ---- G3 : Aide ----------------------------------------------------------
  test('G3 — page Aide accessible', async () => {
    await page.goto(`${LIVE_FRONT}/app/${ORG_SLUG}/aide`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await expect(page.getByRole('heading', { name: /aide/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, 'G3-aide');
  });

  // ---- H1 : Cmd+K (palette) ----------------------------------------------
  test('H1 — Cmd+K ouvre la palette de commandes', async () => {
    await page.goto(PROJETS_URL, { waitUntil: 'domcontentloaded', timeout: NAV });
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({ timeout: NAV });
    await page.keyboard.press('Meta+k');
    // La palette est un dialog avec un champ de recherche.
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible({ timeout: 8_000 });
    await shot(page, 'H1-cmdk-palette');
    await page.keyboard.press('Escape');
  });

  // ---- H4 : Navigation (sidebar collapse, breadcrumb) --------------------
  test('H4 — navigation : sidebar collapse + fil d\'Ariane présents', async () => {
    // Fil d'Ariane (Topbar).
    await expect(page.getByRole('navigation', { name: /Fil d'Ariane/i })).toBeVisible({
      timeout: 15_000,
    });
    // Bouton de réduction de la navigation (état desktop).
    const collapse = page.getByRole('button', { name: /Réduire la navigation|Ouvrir la navigation/i });
    await expect(collapse.first()).toBeVisible({ timeout: 10_000 });
    await collapse.first().click();
    await shot(page, 'H4-navigation-collapse');
  });

  // ---- B7 : Sélecteur d'organisation -------------------------------------
  test('B7 — sélecteur d\'organisation présent (une seule org pour ce compte)', async () => {
    const orgSwitch = page.getByRole('button', { name: /Choisir une organisation/i }).first();
    // L'org démo n'a qu'une organisation : le contrôle peut être un bouton statique.
    await expect(orgSwitch).toBeVisible({ timeout: 15_000 });
    await shot(page, 'B7-org-switcher');
  });

  // ---- B5 : Déconnexion (en dernier — invalide la session) ----------------
  test('B5 — déconnexion : retour à /login', async () => {
    const logout = page.getByRole('button', { name: /Se déconnecter/i }).first();
    await expect(logout).toBeVisible({ timeout: 15_000 });
    await logout.click();
    await expect(page).toHaveURL(/\/login/, { timeout: NAV });
    await shot(page, 'B5-apres-deconnexion');
  });
});

// ===========================================================================
// B1 (négatif) — mauvais mot de passe : message d'erreur, pas de fuite, pas de
// redirection. Contexte FRAIS (indépendant de la suite sérielle).
// ===========================================================================

test.describe('LIVE — Login négatif (sécurité)', () => {
  test.skip(!RUN, 'Live désactivé : poser RUN_LIVE=1.');

  // NB honnêteté : sur le déploiement ACTUEL, le login est cassé en amont
  // (front → /v1/auth/login 404), donc on NE PEUT PAS distinguer un vrai rejet
  // d'identifiants (401) d'un échec de routage. Ce test prouve UNIQUEMENT la
  // propriété fail-closed : un login refusé affiche une alerte, ne redirige pas,
  // ne pose pas de session — et ne déverse ni SQL ni stack. Il ne prouve PAS la
  // validation d'identifiants (impossible tant que /v1 n'est pas corrigé).
  test('B1neg — login refusé → fail-closed : alerte, reste sur /login, pas de fuite', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);
    await page.goto(`${LIVE_FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.getByLabel('Adresse e-mail').fill(CREDS.email);
    await page.getByLabel('Mot de passe').fill('mauvais-mdp-totalement-faux');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 45_000 });
    // Le texte est rempli par React après le 4xx → poll jusqu'à non-vide.
    await expect
      .poll(async () => ((await alert.first().textContent().catch(() => '')) ?? '').trim().length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    const msg = ((await alert.first().textContent()) ?? '').trim();
    // Pas de fuite SENSIBLE (SQL/stack/secret/mot de passe). Le path interne
    // exposé (« Cannot POST /v1/auth/login ») est un défaut UX documenté à part.
    expect(msg).not.toMatch(/sql|stack|exception|at\s+\/home|password|secret/i);
    // Fail-closed (propriété de sécurité robuste) : pas de redirection, pas de session.
    await expect(page).toHaveURL(/\/login/);
    const cookies = await ctx.cookies();
    expect(
      cookies.find((c) => /token|auth/i.test(c.name)),
      'aucune session ne doit être posée sur un login refusé',
    ).toBeFalsy();
    await shot(page, 'B1neg-login-refuse-failclosed');
    await ctx.close();
  });
});
