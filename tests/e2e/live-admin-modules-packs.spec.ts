/**
 * e2e LIVE — AFFECTATION DES MODULES ET DES PACKS d'un abonnement (SUPERADMIN)
 * + PREUVE DU GATE de calcul, contre l'app EN LIGNE.
 *
 *   Front  : https://roadsen.vercel.app/admin   (Vercel)
 *   Backend: https://roadsen.onrender.com        (Render — recette)
 *
 * Ce spec SOUMET DE VRAIES MUTATIONS d'entitlements (pack + modules) via l'UI
 * SUPERADMIN (modal « Modules débloqués » du SubscriptionEditor) et PROUVE que
 * l'affectation gate RÉELLEMENT le calcul côté serveur :
 *   - un module NON coché  → POST /projects/:id/calc/:engine renvoie 403 (reason
 *     MODULE_NOT_IN_PACK, « Module non inclus ») pour l'OWNER de l'org ;
 *   - le même module coché → le 403 DISPARAÎT (400 de validation ou 201), preuve
 *     que le gate est bien piloté par l'entitlement et non par autre chose.
 *
 * Zéro faux-vert : chaque étape assert le STATUT réel (pas « pas d'erreur »), le
 * corps de réponse (reason typé), et la valeur persistée (pack rechargé). Le gate
 * est exercé via l'API backend DIRECTE (contexte APIRequestContext Node — pas de
 * CORS) avec le token de l'OWNER + en-tête X-Org-Id : impossible de faux-verdir
 * en passant par une couche UI permissive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RÈGLE DE SÉCURITÉ DES DONNÉES (stricte) :
 *  - Toute donnée créée est préfixée `E2E-TEST-mods-` / `e2e-mods-...@test.local`.
 *  - Suffixe unique par run (RUN_ID env, sinon Date.now()).
 *  - AUCUNE mutation sur demo-starfire / bet-demo-client / ryhow99.
 *  - PAS de teardown ici : les ids créés sont journalisés (console + fichier)
 *    pour que l'orchestrateur nettoie la base.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTE DE MAPPING (important) — le libellé des checkboxes du modal N'EST PAS le
 * slug du moteur de calcul :
 *    checkbox UI   →  slug moteur /calc/:engine   (entitlement stocké = libellé UI)
 *    burmister     →  burmister                    (identiques)
 *    terzaghi      →  terzaghi                     (identiques)
 *    casagrande    →  pieux
 *    geoplaque     →  radier   (couvre plane-strain/axi/tri-raft)
 *    pressiopro    →  pressiometre (couvre pressio-etalonnage/calibrage)
 *    fastlab       →  labo
 * Le gate compare le slug moteur (après groupement) à la liste d'entitlements
 * STOCKÉE (= libellés UI). Seuls `burmister` et `terzaghi` ont libellé == slug ;
 * la PREUVE DU GATE s'appuie donc sur `burmister` (aucune ambiguïté de mapping).
 *
 * Identifiants via ENV (jamais en dur / commité) :
 *   RUN_LIVE=1 SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.modulespacks.config.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  test,
  expect,
  request as pwRequest,
  type Page,
  type APIRequestContext,
  type Response,
} from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const BACKEND = 'https://roadsen.onrender.com';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;
const API_TIMEOUT = 120_000; // cold-start Render

const RUN_ID = process.env.RUN_ID ?? String(Date.now());

// Données E2E-TEST-mods-<unique> (mdp OWNER >= 12 caractères, jamais un compte réel).
const ORG_NAME = `E2E-TEST-mods-${RUN_ID}`;
const ORG_SLUG = `e2e-test-mods-${RUN_ID}`;
const OWNER_EMAIL = `e2e-mods-${RUN_ID}@test.local`;
const OWNER_NAME = 'E2E-TEST Owner Mods';
const OWNER_PASSWORD = 'E2eModsOwnerPass123'; // 19 chars >= 12

const SHOTS = path.resolve(__dirname, '../../test-results/live-admin-modules-packs');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// ─── Journal des données créées (pour teardown par l'orchestrateur) ───────────
const CREATED: Array<Record<string, string>> = [];
function record(entity: Record<string, string>) {
  CREATED.push(entity);
  // eslint-disable-next-line no-console
  console.log('[E2E-CREATED]', JSON.stringify(entity));
  fs.writeFileSync(
    path.join(SHOTS, `created-${RUN_ID}.json`),
    JSON.stringify({ RUN_ID, created: CREATED }, null, 2),
  );
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

async function login(page: Page) {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/auth/login') && r.request().method() === 'POST',
      { timeout: 90_000 },
    ),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
  expect(resp.status(), 'le login superadmin doit renvoyer 200').toBe(200);
  await page.waitForURL(/\/admin/, { timeout: 60_000 }).catch(() => {});
}

/**
 * Crée l'org E2E-TEST-mods- via le wizard avec un OWNER inline et le PACK ROUTES
 * (entitlements auto = ['burmister']). Renvoie les ids réels capturés au backend.
 */
async function createOrgRoutes(page: Page): Promise<{ orgId: string; ownerId: string }> {
  await page.goto(`${FRONT}/admin/orgs/new`, {
    waitUntil: 'domcontentloaded',
    timeout: NAV,
  });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

  // Étape 1 — compte OWNER (création inline)
  await page.getByRole('button', { name: 'Nouveau compte' }).click();
  await page.getByLabel('Nom complet').fill(OWNER_NAME);
  await page.getByLabel('Email', { exact: true }).fill(OWNER_EMAIL);
  await page.getByLabel('Mot de passe initial').fill(OWNER_PASSWORD);
  await shot(page, 'w1-step1-owner');
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 2 — Organisation
  await page.getByLabel("Nom de l'organisation").fill(ORG_NAME);
  await page.getByLabel(/Slug/).fill(ORG_SLUG);
  await shot(page, 'w1-step2-org');
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 3 — Abonnement : PACK ROUTES (→ entitlements = ['burmister']) + quota
  await page.locator('#pack').selectOption('ROUTES');
  await page.getByLabel(/Quota/).fill('100');
  await expect(
    page.getByText(/Modules inclus\s*:\s*burmister/i),
    'le pack ROUTES doit exposer un seul module inclus (burmister)',
  ).toBeVisible({ timeout: 10_000 });
  await shot(page, 'w1-step3-sub-routes');

  const userRespP = page.waitForResponse(
    (r) => r.url().endsWith('/admin/users') && r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  const orgRespP = page.waitForResponse(
    (r) => r.url().endsWith('/admin/orgs') && r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: "Créer l'organisation" }).click();

  const userResp = await userRespP;
  expect(userResp.status(), 'création du compte OWNER (200/201)').toBeLessThan(300);
  const ownerBody = (await userResp.json()) as { userId: string };
  record({
    type: 'user',
    userId: ownerBody.userId,
    email: OWNER_EMAIL,
    name: OWNER_NAME,
  });

  const orgResp = await orgRespP;
  if (orgResp.status() >= 300) {
    const errText = await orgResp.text().catch(() => '');
    throw new Error(`Création org a échoué (${orgResp.status()}) : ${errText}`);
  }
  const orgBody = (await orgResp.json()) as { orgId: string };
  record({ type: 'org', orgId: orgBody.orgId, slug: ORG_SLUG, name: ORG_NAME });

  await expect(
    page.getByText(/Organisation créée/i),
    'le wizard doit confirmer la création',
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, 'w1-created');

  return { orgId: orgBody.orgId, ownerId: ownerBody.userId };
}

async function openOrgAbonnement(page: Page, orgId: string) {
  await page.goto(`${FRONT}/admin/orgs/${orgId}`, {
    waitUntil: 'domcontentloaded',
    timeout: NAV,
  });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await expect(
    page.getByText(/couldn.t load|server error|page n.a pas pu/i),
    'le détail ne doit pas crasher',
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('tab', { name: 'Abonnement' }).click();
  await expect(page.getByRole('button', { name: 'Modules' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Ouvre la modal « Modules débloqués » et renvoie le locator du dialog. */
async function openModulesModal(page: Page) {
  await page.getByRole('button', { name: 'Modules' }).click();
  const modDlg = page.getByRole('dialog');
  await expect(modDlg.getByRole('heading', { name: 'Modules débloqués' })).toBeVisible({
    timeout: 15_000,
  });
  return modDlg;
}

/**
 * Clique « Enregistrer » et attend la réponse PATCH entitlements (ignore l'OPTIONS
 * preflight). Vérifie le statut, que la modal se ferme, et renvoie {status, body}.
 * En cas d'erreur backend/CORS, la modal reste ouverte → toBeHidden échoue (rouge
 * honnête, jamais un faux-vert).
 */
async function saveEntitlements(
  page: Page,
  modDlg: ReturnType<Page['getByRole']>,
): Promise<{ status: number; requestBody: { pack: string; entitlements: string[] } }> {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r: Response) =>
        r.url().includes('/subscription/entitlements') &&
        r.request().method() === 'PATCH',
      { timeout: 90_000 },
    ),
    modDlg.getByRole('button', { name: 'Enregistrer' }).click(),
  ]);
  const status = resp.status();
  const requestBody = resp.request().postDataJSON() as {
    pack: string;
    entitlements: string[];
  };
  expect(
    status,
    `PATCH entitlements doit réussir (envoi ${JSON.stringify(requestBody)})`,
  ).toBeLessThan(300);
  await expect(modDlg, 'la modal doit se fermer après succès').toBeHidden({
    timeout: 15_000,
  });
  return { status, requestBody };
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

test.describe('LIVE — Affectation modules & packs + preuve du gate (E2E-TEST-mods-)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis (cible la prod en ligne).');
  test.skip(!EMAIL || !PASSWORD, 'SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD requis.');

  test('Affectation modules/packs pilote réellement le gate de calcul', async ({
    page,
  }) => {
    let orgId = '';

    // ── W1 : créer l'org E2E-TEST-mods- (pack ROUTES, entitlements=[burmister]) ──
    await test.step('W1 — créer une org E2E-TEST-mods- (pack ROUTES)', async () => {
      await login(page);
      const created = await createOrgRoutes(page);
      orgId = created.orgId;

      // Preuve : l'org apparaît en liste (filtre SQL serveur par slug).
      await page.goto(`${FRONT}/admin/orgs?q=${encodeURIComponent(ORG_SLUG)}`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV,
      });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await expect(
        page.getByText(ORG_NAME).first(),
        "l'org créée doit apparaître dans la liste",
      ).toBeVisible({ timeout: 30_000 });
      await shot(page, 'w1-list');

      // Preuve : le détail montre le pack ROUTES sur l'onglet Abonnement.
      await openOrgAbonnement(page, orgId);
      await expect(
        page.getByText('ROUTES', { exact: true }).first(),
        'le détail doit refléter le pack ROUTES à la création',
      ).toBeVisible({ timeout: 15_000 });
      await shot(page, 'w1-detail-routes');
    });

    // ── W2 : changer le PACK ROUTES → COMPLETE ──────────────────────────────────
    await test.step('W2 — changer le pack ROUTES → COMPLETE', async () => {
      const modDlg = await openModulesModal(page);
      // À l'ouverture, le select pack doit refléter l'état courant (ROUTES).
      await expect(
        modDlg.getByRole('combobox'),
        'le select pack doit refléter le pack courant (ROUTES)',
      ).toHaveValue('ROUTES');
      await modDlg.getByRole('combobox').selectOption('COMPLETE');
      await shot(page, 'w2-modal-complete-selected');

      const { requestBody } = await saveEntitlements(page, modDlg);
      expect(requestBody.pack, 'le PATCH doit porter pack=COMPLETE').toBe('COMPLETE');

      // Preuve de persistance 1 : le read-view détail affiche COMPLETE.
      await expect(
        page.getByText('COMPLETE', { exact: true }).first(),
        'le détail doit refléter pack=COMPLETE après enregistrement',
      ).toBeVisible({ timeout: 20_000 });
      await shot(page, 'w2-detail-complete');
    });

    // ── W3 : affecter/retirer des MODULES (retirer burmister) ───────────────────
    await test.step('W3 — modules : cocher radier+pressiometre, décocher burmister', async () => {
      const modDlg = await openModulesModal(page);
      // Preuve de persistance 2 : le pack rechargé vaut bien COMPLETE.
      await expect(
        modDlg.getByRole('combobox'),
        'le pack persisté (rechargé) doit valoir COMPLETE',
      ).toHaveValue('COMPLETE');

      // Mapping : radier→geoplaque, pressiometre→pressiopro. On les coche
      // (idempotent), et on RETIRE burmister — le module clé du gate.
      await modDlg.getByRole('checkbox', { name: 'geoplaque', exact: true }).check();
      await modDlg.getByRole('checkbox', { name: 'pressiopro', exact: true }).check();
      await modDlg.getByRole('checkbox', { name: 'burmister', exact: true }).uncheck();
      await shot(page, 'w3-modal-modules-edited');

      const { requestBody } = await saveEntitlements(page, modDlg);
      expect(
        requestBody.entitlements,
        'burmister doit être RETIRÉ de la liste envoyée',
      ).not.toContain('burmister');
      expect(
        requestBody.entitlements,
        'geoplaque (radier) doit rester affecté',
      ).toContain('geoplaque');
      expect(
        requestBody.entitlements,
        'pressiopro (pressiometre) doit rester affecté',
      ).toContain('pressiopro');
      await shot(page, 'w3-saved');
    });

    // ── W4 : PREUVE DU GATE (le point clé) ──────────────────────────────────────
    // Après W3, burmister n'est PLUS affecté. On prouve, avec le token de l'OWNER,
    // que le calcul burmister est barré (403 MODULE_NOT_IN_PACK), puis qu'il passe
    // dès qu'on ré-affecte burmister via l'UI.
    await test.step('W4 — le gate : module non affecté → 403, affecté → plus de 403', async () => {
      const api: APIRequestContext = await pwRequest.newContext({ timeout: API_TIMEOUT });
      try {
        // Login OWNER (token + claim orgs) — jamais le superadmin ici.
        const loginResp = await api.post(`${BACKEND}/auth/login`, {
          data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
        });
        expect(loginResp.status(), "login OWNER de l'org E2E-TEST-mods-").toBe(200);
        const { accessToken } = (await loginResp.json()) as { accessToken: string };
        const authHeaders = { Authorization: `Bearer ${accessToken}`, 'X-Org-Id': orgId };

        // Projet tenant (création non gatée) pour porter le calcul.
        const projResp = await api.post(`${BACKEND}/projects`, {
          headers: authHeaders,
          data: { name: `E2E-TEST-mods-proj-${RUN_ID}` },
        });
        expect(projResp.status(), 'création projet OWNER').toBeLessThan(300);
        const project = (await projResp.json()) as { id: string };
        record({
          type: 'project',
          projectId: project.id,
          orgId,
          name: `E2E-TEST-mods-proj-${RUN_ID}`,
        });

        // ── Probe A : burmister NON affecté → 403 « Module non inclus » ────────
        // NB : le filtre global anti-fuite (AllExceptionsFilter) réduit le corps à
        // { statusCode, error, message, traceId } et RETIRE le champ `reason` typé —
        // le message reste le signal stable du refus de MODULE (« Module non inclus
        // dans votre abonnement »), distinct de « Abonnement expiré » (402) et de
        // « Quota d'utilisation atteint » (402).
        const probeA = await api.post(
          `${BACKEND}/projects/${project.id}/calc/burmister`,
          { headers: authHeaders, data: {} },
        );
        const bodyA = (await probeA.json().catch(() => ({}))) as { message?: string };
        expect(
          probeA.status(),
          `module NON affecté → 403 attendu (corps: ${JSON.stringify(bodyA)})`,
        ).toBe(403);
        expect(
          bodyA.message ?? '',
          'le 403 doit être un refus de MODULE (« Module non inclus »), pas quota/expiration',
        ).toMatch(/Module non inclus/i);
        fs.writeFileSync(
          path.join(SHOTS, `gate-probeA-403-${RUN_ID}.json`),
          JSON.stringify({ status: probeA.status(), body: bodyA }, null, 2),
        );

        // ── Ré-affecter burmister via l'UI (modal → cocher burmister → save) ───
        const modDlg = await openModulesModal(page);
        await modDlg.getByRole('checkbox', { name: 'burmister', exact: true }).check();
        const { requestBody } = await saveEntitlements(page, modDlg);
        expect(
          requestBody.entitlements,
          'burmister doit être RÉ-AFFECTÉ dans la liste envoyée',
        ).toContain('burmister');
        await shot(page, 'w4-burmister-reassigned');

        // ── Probe B : burmister affecté → le 403 DISPARAÎT (400/201, pas 403) ──
        const probeB = await api.post(
          `${BACKEND}/projects/${project.id}/calc/burmister`,
          { headers: authHeaders, data: {} },
        );
        const bodyB = (await probeB.json().catch(() => ({}))) as { message?: string };
        expect(
          probeB.status(),
          `module affecté → le gate module ne doit PLUS renvoyer 403 (statut ${probeB.status()}, corps ${JSON.stringify(bodyB)})`,
        ).not.toBe(403);
        // Défense supplémentaire : plus aucun refus « Module non inclus » ne doit
        // subsister une fois burmister ré-affecté (le 400/201 doit venir d'ailleurs).
        expect(
          bodyB.message ?? '',
          'aucun refus « Module non inclus » ne doit subsister une fois burmister affecté',
        ).not.toMatch(/Module non inclus/i);
        fs.writeFileSync(
          path.join(SHOTS, `gate-probeB-${RUN_ID}.json`),
          JSON.stringify({ status: probeB.status(), body: bodyB }, null, 2),
        );
      } finally {
        await api.dispose();
      }
    });

    // ── W5 : /admin/audit trace les changements d'entitlements ───────────────────
    await test.step("W5 — /admin/audit reflète les ENTITLEMENTS_SET sur l'org", async () => {
      await page.goto(`${FRONT}/admin/audit?action=ENTITLEMENTS_SET`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV,
      });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await expect(page.getByRole('heading', { name: "Journal d'audit" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText('ENTITLEMENTS_SET').first(),
        'le journal filtré doit lister des entrées ENTITLEMENTS_SET',
      ).toBeVisible({ timeout: 30_000 });
      const orgTarget = `org:${orgId.slice(0, 8)}`;
      await expect(
        page.getByText(orgTarget).first(),
        "au moins une entrée ENTITLEMENTS_SET doit cibler l'org E2E-TEST-mods-",
      ).toBeVisible({ timeout: 30_000 });
      await shot(page, 'w5-audit-entitlements');
    });
  });

  // ── Journalisation finale pour le teardown ──────────────────────────────────
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      '\n============ DONNÉES E2E-TEST-mods- À NETTOYER (teardown DB) ============',
    );
    // eslint-disable-next-line no-console
    console.log(`RUN_ID=${RUN_ID}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ created: CREATED }, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      '========================================================================\n',
    );
  });
});
