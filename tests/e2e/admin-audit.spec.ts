/**
 * e2e AUDIT — parcours EXHAUSTIF du back-office /admin en ligne (Vercel ↔ Render).
 *
 * But : détecter TOUS les manquements — crashes SSR, erreurs console, requêtes réseau
 * en échec (4xx/5xx), boutons/onglets morts, états vides sans repère, et features
 * attendues (cadrage) mais absentes. On COLLECTE (jamais de fail au 1er problème) puis
 * on écrit un rapport JSON + un résumé lisible.
 *
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.audit.config.ts
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

const OUT = path.resolve(__dirname, '../../test-results/admin-audit');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});

type Sev = 'BLOQUANT' | 'MAJEUR' | 'MINEUR' | 'INFO';
interface Finding { sev: Sev; area: string; msg: string }
const findings: Finding[] = [];
let area = 'init';
const note = (sev: Sev, msg: string) => findings.push({ sev, area, msg });

/** Vérifie la présence d'un élément ; note un manquement sinon. Ne throw jamais. */
async function expectVisible(page: Page, locatorText: RegExp | string, label: string, sev: Sev = 'MAJEUR') {
  const loc = typeof locatorText === 'string' ? page.getByText(locatorText, { exact: false }) : page.getByText(locatorText);
  // Attente RÉELLE (jusqu'à 8s) — sinon faux négatif si le rendu n'est pas encore fini.
  const ok = await loc.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (!ok) note(sev, `Absent/invisible : ${label}`);
  return ok;
}

async function crashCheck(page: Page) {
  const crashed = await page.getByText(/couldn.t load|server error|page n.a pas pu|Application error|500|Internal Server/i).first().isVisible().catch(() => false);
  if (crashed) note('BLOQUANT', `Écran d'erreur affiché sur ${page.url()}`);
  return crashed;
}

test.describe('AUDIT — back-office /admin (live)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis.');
  test.skip(!EMAIL || !PASSWORD, 'SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD requis.');

  test('parcours exhaustif + collecte des manquements', async ({ page }) => {
    // --- Écoute globale : erreurs console / JS / réseau, attribuées à l'area courante.
    // Console : on ignore « Failed to load resource » (couvert avec URL par le listener
    // response ci-dessous) ; on garde les vraies erreurs JS applicatives.
    page.on('console', (m) => {
      if (m.type() === 'error') {
        const t = m.text();
        if (!/Failed to load resource|favicon|net::ERR_|Download the React DevTools/i.test(t)) {
          note('MINEUR', `Console error: ${t.slice(0, 200)}`);
        }
      }
    });
    page.on('pageerror', (e) => note('MAJEUR', `JS pageerror: ${String(e.message).slice(0, 200)}`));
    // Réseau : capture TOUTE requête 4xx/5xx, dédupliquée par (méthode+chemin), avec l'URL exacte.
    const seenReq = new Set<string>();
    page.on('response', (r) => {
      const s = r.status();
      if (s < 400) return;
      const short = r.url().replace(FRONT, '').replace('https://roadsen.onrender.com', '(api)');
      if (/does-not-exist-xyz/.test(short)) return; // 404 volontaire (test route inconnue)
      const key = `${r.request().method()} ${short.split('?')[0]}`;
      if (seenReq.has(key)) return;
      seenReq.add(key);
      note(s >= 500 ? 'MAJEUR' : 'MINEUR', `HTTP ${s} : ${key}`);
    });

    // ============================ 1. LOGIN + REDIRECTION ============================
    area = 'login';
    await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.getByLabel('Adresse e-mail').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 90_000 }),
      page.getByRole('button', { name: 'Se connecter' }).click(),
    ]);
    const redirectedToAdmin = await page.waitForURL(/\/admin/, { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!redirectedToAdmin) note('MAJEUR', `Login ne redirige pas vers /admin (url = ${page.url()})`);

    // ============================ 2. SHELL (nav + topbar) ============================
    area = 'shell';
    await page.goto(`${FRONT}/admin/orgs`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await crashCheck(page);
    await expectVisible(page, /back-office/i, 'libellé BACK-OFFICE (topbar)');
    await expectVisible(page, 'Organisations', 'nav Organisations');
    await expectVisible(page, 'Utilisateurs', 'nav Utilisateurs');
    await expectVisible(page, /Retour à l.app/, 'lien Retour à l\'app', 'MINEUR');
    // Entrées de nav attendues par le cadrage mais potentiellement absentes :
    for (const [lbl, sev] of [['Abonnements', 'MINEUR'], ['Audit', 'MINEUR'], ['Tableau de bord', 'MINEUR'], ['PV', 'MINEUR']] as [string, Sev][]) {
      const present = await page.locator('nav, aside').getByText(lbl, { exact: false }).first().isVisible().catch(() => false);
      if (!present) note(sev, `Nav globale sans entrée « ${lbl} » (attendu cadrage ?)`);
    }
    await shot(page, '01-shell-orgs');

    // ============================ 3. LISTE ORGS ============================
    area = 'orgs-list';
    await expectVisible(page, 'Organisations', 'titre liste');
    // recherche
    const search = page.getByPlaceholder(/Rechercher/i).first();
    if (!(await search.isVisible().catch(() => false))) note('MAJEUR', 'Champ de recherche orgs absent');
    else {
      await search.fill('demo');
      await page.waitForTimeout(1500);
      await crashCheck(page);
      await shot(page, '02-orgs-search');
      await search.fill('');
    }
    // filtre statut : c'est un <select>/combobox — getByText ne matche pas l'option
    // sélectionnée. On cherche le contrôle par rôle/élément.
    const filterOk = await page
      .getByRole('combobox')
      .or(page.locator('select'))
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!filterOk) note('MINEUR', 'Filtre statut absent');
    // bouton créer
    const newBtn = page.getByRole('button', { name: /Nouvelle organisation/i }).or(page.getByRole('link', { name: /Nouvelle organisation/i }));
    if (!(await newBtn.first().isVisible().catch(() => false))) note('MAJEUR', 'Bouton « Nouvelle organisation » absent');

    // ============================ 4. DÉTAIL ORG + 4 ONGLETS ============================
    area = 'org-detail';
    await page.goto(`${FRONT}/admin/orgs/${DEMO_ORG_ID}`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await crashCheck(page);
    await expectVisible(page, 'Bureau Demo STARFIRE', 'nom org (détail)');
    await expectVisible(page, /Suspendre/, 'action Suspendre org', 'MINEUR');
    await shot(page, '03-detail-membres');

    for (const tab of ['Membres', 'Abonnement', 'Usage', 'Audit']) {
      area = `onglet-${tab}`;
      const tabLoc = page.getByRole('tab', { name: new RegExp(tab, 'i') }).or(page.getByText(new RegExp(`^${tab}`, 'i'))).first();
      const clickable = await tabLoc.isVisible().catch(() => false);
      if (!clickable) { note('MAJEUR', `Onglet « ${tab} » introuvable`); continue; }
      await tabLoc.click().catch(() => note('MAJEUR', `Onglet « ${tab} » non cliquable`));
      await page.waitForTimeout(1200);
      await crashCheck(page);
      await shot(page, `04-onglet-${tab.toLowerCase()}`);
      // contenu vide sans repère ?
      const bodyTxt = (await page.locator('main, [role="tabpanel"], body').first().innerText().catch(() => '')) ?? '';
      if (bodyTxt.trim().length < 40) note('MINEUR', `Onglet « ${tab} » : contenu très pauvre / peut-être vide`);
    }

    // ============================ 5. WIZARD NOUVELLE ORG ============================
    area = 'wizard-new';
    await page.goto(`${FRONT}/admin/orgs/new`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await crashCheck(page);
    const hasForm = await page.locator('form, input').first().isVisible().catch(() => false);
    if (!hasForm) note('MAJEUR', 'Wizard nouvelle org : aucun formulaire/champ visible');
    await shot(page, '05-wizard-new');

    // ============================ 6. LISTE USERS ============================
    area = 'users-list';
    await page.goto(`${FRONT}/admin/users`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await crashCheck(page);
    await expectVisible(page, /Utilisateurs/, 'titre liste users');
    const usearch = page.getByPlaceholder(/Rechercher/i).first();
    if (await usearch.isVisible().catch(() => false)) {
      await usearch.fill('ryhow');
      await page.waitForTimeout(1500);
      await crashCheck(page);
    } else note('MINEUR', 'Recherche users absente');
    await shot(page, '06-users');

    // ============================ 7. ROUTE INEXISTANTE (404 propre ?) ============================
    area = 'not-found';
    await page.goto(`${FRONT}/admin/does-not-exist-xyz`, { waitUntil: 'domcontentloaded', timeout: NAV }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, '07-notfound');

    // ============================ RAPPORT ============================
    const order: Record<Sev, number> = { BLOQUANT: 0, MAJEUR: 1, MINEUR: 2, INFO: 3 };
    findings.sort((a, b) => order[a.sev] - order[b.sev]);
    const counts = findings.reduce<Record<string, number>>((acc, f) => ((acc[f.sev] = (acc[f.sev] ?? 0) + 1), acc), {});
    fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ counts, findings }, null, 2));

    console.log('\n=================== AUDIT BACK-OFFICE — MANQUEMENTS ===================');
    console.log('Résumé :', JSON.stringify(counts));
    for (const f of findings) console.log(`  [${f.sev}] (${f.area}) ${f.msg}`);
    console.log('=====================================================================\n');

    // L'audit lui-même ne "échoue" que s'il y a un BLOQUANT non attendu (le reste = rapport).
    expect(findings.filter((f) => f.sev === 'BLOQUANT'), 'aucun écran de crash ne doit subsister').toEqual([]);
  });
});
