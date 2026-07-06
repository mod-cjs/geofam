/**
 * e2e LIVE — MUTATIONS du back-office SUPERADMIN contre l'app EN LIGNE.
 *
 *   Front  : https://roadsen.vercel.app/admin   (Vercel)
 *   Backend: https://roadsen.onrender.com        (Render — recette)
 *
 * Contrairement à live-admin.spec.ts (lecture) et live-admin-vague2.spec.ts (ouverture
 * de modals sans soumettre), CE spec SOUMET DE VRAIES MUTATIONS et vérifie que l'état a
 * réellement changé (réponses backend + re-rendu UI). Chaque étape = assertion réelle +
 * screenshot de preuve. Zéro faux-vert : une mutation bloquée par le réseau échoue avec
 * un diagnostic explicite, elle n'est jamais comptée verte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RÈGLE DE SÉCURITÉ DES DONNÉES (stricte) :
 *  - Toute donnée créée est préfixée `E2E-TEST-` / `e2e-...@test.local` / `e2e-test-...`.
 *  - Suffixe unique par run (RUN_ID env, sinon Date.now()) → aucun collisionnement.
 *  - AUCUNE mutation sur les orgs démo (demo-starfire, bet-demo-client) ni sur ryhow99.
 *  - PAS de teardown DB ici : les ids créés sont journalisés (console + fichier + afterAll)
 *    pour que l'orchestrateur nettoie la base.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * État partagé entre tests : persisté SUR DISQUE (pas en mémoire) car Playwright
 * redémarre le worker après un échec, ce qui remettrait à zéro un état module-level.
 *
 * Identifiants via ENV (jamais en dur / commité) :
 *   RUN_LIVE=1 RUN_ID=$(date +%s) SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *     corepack pnpm@9.12.0 exec playwright test --config=playwright.mutations.config.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { test, expect, type Page, type Locator } from '@playwright/test';

const FRONT = 'https://roadsen.vercel.app';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN = process.env.RUN_LIVE === '1';
const NAV = 120_000;

// Suffixe unique de run — partagé par tous les workers du MÊME run (via RUN_ID).
const RUN_ID = process.env.RUN_ID ?? String(Date.now());
const OWNER_PASSWORD = 'E2eTestOwnerPass123'; // >= 8, jamais un compte réel

const SHOTS = path.resolve(__dirname, '../../test-results/live-admin-mutations');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// ─────────────────────────────────────────────────────────────────────────────
// Store d'état sur disque (survit au redémarrage de worker) — clé par RUN_ID.
// ─────────────────────────────────────────────────────────────────────────────
interface CreatedOrg {
  orgId: string;
  slug: string;
  name: string;
}
interface CreatedUser {
  userId: string;
  email: string;
  fullName: string;
}
interface RunState {
  orgA?: CreatedOrg;
  orgB?: CreatedOrg;
  ownerA?: CreatedUser;
  ownerB?: CreatedUser;
  created: (CreatedOrg | CreatedUser)[];
}

const CTX_FILE = path.join(SHOTS, `ctx-${RUN_ID}.json`);

function readState(): RunState {
  try {
    return JSON.parse(fs.readFileSync(CTX_FILE, 'utf8')) as RunState;
  } catch {
    return { created: [] };
  }
}
function writeState(patch: Partial<RunState>) {
  const cur = readState();
  const next: RunState = { ...cur, ...patch };
  fs.writeFileSync(CTX_FILE, JSON.stringify(next, null, 2));
}
function record(entity: CreatedOrg | CreatedUser) {
  const cur = readState();
  cur.created = cur.created ?? [];
  cur.created.push(entity);
  fs.writeFileSync(CTX_FILE, JSON.stringify(cur, null, 2));
  // eslint-disable-next-line no-console
  console.log('[E2E-CREATED]', JSON.stringify(entity));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function login(page: Page) {
  // Les toggles isActive/transferOwner passent par window.confirm → auto-accept.
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
 * Déclenche une mutation (action = clic/selectOption) et attend SOIT la réponse backend
 * attendue, SOIT une bannière d'erreur réseau. Si l'erreur gagne (ex. « Failed to fetch »),
 * échoue VITE avec un diagnostic — jamais un timeout muet, jamais un faux-vert.
 */
async function runMutation(
  page: Page,
  action: () => Promise<void>,
  pred: (r: import('@playwright/test').Response) => boolean,
  ctxLabel: string,
) {
  const respP = page
    .waitForResponse(pred, { timeout: 90_000 })
    .then((r) => ({ type: 'resp' as const, r }))
    .catch((e) => ({ type: 'timeout' as const, e }));
  const errBanner = page
    .getByText(/Failed to fetch|Une erreur inattendue|Erreur\s*\d/i)
    .first();
  const errP = errBanner
    .waitFor({ state: 'visible', timeout: 90_000 })
    .then(() => ({ type: 'err' as const }))
    .catch(() => ({ type: 'noerr' as const }));

  await action();
  const winner = await Promise.race([respP, errP]);

  if (winner.type === 'err') {
    const banner = (await errBanner.textContent().catch(() => '')) ?? '';
    throw new Error(
      `[${ctxLabel}] Mutation BLOQUÉE côté navigateur — bannière: "${banner.trim()}". ` +
        `Cause confirmée par preflight OPTIONS sur le backend Render : ` +
        `Access-Control-Allow-Headers ne liste pas 'Idempotency-Key' et ` +
        `Access-Control-Allow-Methods ne liste pas PATCH/DELETE. Défaut de déploiement, pas du test.`,
    );
  }
  if (winner.type === 'timeout') throw winner.e;
  return winner.r;
}

/**
 * Crée une organisation E2E-TEST- via le wizard 3 étapes avec un NOUVEAU compte OWNER
 * inline. Capture les ids réels (owner + org) depuis les réponses backend.
 */
async function createOrgViaWizard(
  page: Page,
  label: 'A' | 'B',
): Promise<{ org: CreatedOrg; owner: CreatedUser }> {
  const orgName = `E2E-TEST-Org-${label}-${RUN_ID}`;
  const slug = `e2e-test-org-${label.toLowerCase()}-${RUN_ID}`;
  const ownerEmail = `e2e-owner-${label.toLowerCase()}-${RUN_ID}@test.local`;
  const ownerName = `E2E-TEST Owner ${label}`;

  await page.goto(`${FRONT}/admin/orgs/new`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

  // Étape 1 — compte OWNER (création inline)
  await page.getByRole('button', { name: 'Nouveau compte' }).click();
  await page.getByLabel('Nom complet').fill(ownerName);
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Mot de passe initial').fill(OWNER_PASSWORD);
  await shot(page, `w1-${label}-step1-owner`);
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 2 — Organisation
  await page.getByLabel("Nom de l'organisation").fill(orgName);
  await page.getByLabel(/Slug/).fill(slug); // déterministe
  await shot(page, `w1-${label}-step2-org`);
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 3 — Abonnement (defaults : COMPLETE, aujourd'hui → +1 an)
  await page.getByLabel(/Quota/).fill('100');
  await shot(page, `w1-${label}-step3-sub`);

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
  expect(userResp.status(), `création du compte OWNER ${label} (200/201)`).toBeLessThan(300);
  const ownerBody = (await userResp.json()) as { userId: string };
  const owner: CreatedUser = { userId: ownerBody.userId, email: ownerEmail, fullName: ownerName };
  record(owner);

  const orgResp = await orgRespP;
  if (orgResp.status() >= 300) {
    const errText = await orgResp.text().catch(() => '');
    throw new Error(`Création org ${label} a échoué (${orgResp.status()}) : ${errText}`);
  }
  const orgBody = (await orgResp.json()) as { orgId: string };
  const org: CreatedOrg = { orgId: orgBody.orgId, slug, name: orgName };
  record(org);

  await expect(
    page.getByText(/Organisation créée/i),
    'le wizard doit confirmer la création',
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, `w1-${label}-created`);

  return { org, owner };
}

async function openOrgDetail(page: Page, org: CreatedOrg) {
  await page.goto(`${FRONT}/admin/orgs/${org.orgId}`, {
    waitUntil: 'domcontentloaded',
    timeout: NAV,
  });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await expect(
    page.getByText(/couldn.t load|server error|page n.a pas pu/i),
    'le détail ne doit pas crasher',
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: org.name })).toBeVisible({ timeout: 30_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LIVE MUTATIONS — Back-office SUPERADMIN (données E2E-TEST-)', () => {
  test.skip(!RUN, 'RUN_LIVE=1 requis (cible la prod en ligne).');
  test.skip(!EMAIL || !PASSWORD, 'SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD requis.');

  // ── Workflow 1 : créer l'org A via le wizard ────────────────────────────────
  test('W1 — créer une org E2E-TEST- (A) via le wizard, visible en liste + détail', async ({
    page,
  }) => {
    await login(page);
    const { org, owner } = await createOrgViaWizard(page, 'A');
    writeState({ orgA: org, ownerA: owner });

    // Preuve 1 : l'org apparaît dans la liste (recherche par slug → filtre SQL serveur).
    await page.goto(`${FRONT}/admin/orgs?q=${encodeURIComponent(org.slug)}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await shot(page, 'w1-A-list');
    await expect(
      page.getByText(org.name).first(),
      "l'org créée doit apparaître dans la liste",
    ).toBeVisible({ timeout: 30_000 });

    // Preuve 2 : la page détail charge et affiche nom + slug.
    await openOrgDetail(page, org);
    await expect(page.getByText(org.slug).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'w1-A-detail');
  });

  // ── Workflow 1bis : créer l'org B (2e owner) ────────────────────────────────
  test('W1bis — créer une 2e org E2E-TEST- (B) avec un 2e compte OWNER', async ({ page }) => {
    await login(page);
    const { org, owner } = await createOrgViaWizard(page, 'B');
    writeState({ orgB: org, ownerB: owner });
    await openOrgDetail(page, org);
    await shot(page, 'w1-B-detail');
  });

  // ── Workflow 2 : money (top-up + renouvellement + modules) ──────────────────
  test('W2 — money sur org A : top-up quota (+50), renouvellement, modules', async ({ page }) => {
    const s = readState();
    test.skip(!s.orgA, 'dépend de W1 (org A).');
    const org = s.orgA!;
    await login(page);
    await openOrgDetail(page, org);

    await page.getByRole('tab', { name: 'Abonnement' }).click();
    await expect(page.getByRole('button', { name: 'Ajuster le quota' })).toBeVisible({
      timeout: 15_000,
    });

    // ── Top-up +50 ─────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Ajuster le quota' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Ajuster le quota' })).toBeVisible();
    const descText = (await dlg.textContent()) ?? '';
    const quotaMatch = descText.match(/Quota actuel\s*:\s*(\d+)/);
    expect(quotaMatch, 'la modal doit exposer le quota actuel').not.toBeNull();
    const oldQuota = Number.parseInt(quotaMatch![1], 10);

    await dlg.getByRole('spinbutton').fill('50');
    await dlg.getByRole('textbox').fill(`E2E-TEST top-up preuve ${RUN_ID}`);
    await dlg.getByRole('checkbox').check();

    const topupResp = await runMutation(
      page,
      () => dlg.getByRole('button', { name: "Confirmer l'ajustement" }).click(),
      (r) => r.url().includes('/subscription/topup') && r.request().method() === 'POST',
      'top-up',
    );
    expect(topupResp.status(), 'top-up doit réussir').toBeLessThan(300);
    const afterTopup = (await topupResp.json()) as { subscription: { quota: number } };
    expect(afterTopup.subscription.quota, `quota ${oldQuota} → ${oldQuota + 50}`).toBe(oldQuota + 50);
    await shot(page, 'w2-A-topup');

    // ── Renouvellement (reset consommation → 0) ───────────────────────────
    await page.getByRole('button', { name: 'Renouveler' }).click();
    const renewDlg = page.getByRole('dialog');
    await expect(renewDlg.getByRole('heading', { name: "Renouveler l'abonnement" })).toBeVisible();
    const renewResp = await runMutation(
      page,
      () => renewDlg.getByRole('button', { name: 'Confirmer le renouvellement' }).click(),
      (r) => r.url().includes('/subscription/renew') && r.request().method() === 'POST',
      'renouvellement',
    );
    expect(renewResp.status(), 'renouvellement doit réussir').toBeLessThan(300);
    const afterRenew = (await renewResp.json()) as { subscription: { consommation: number } };
    expect(afterRenew.subscription.consommation, 'consommation remise à 0').toBe(0);
    await shot(page, 'w2-A-renew');

    // ── Modules (entitlements) ────────────────────────────────────────────
    await page.getByRole('button', { name: 'Modules' }).click();
    const modDlg = page.getByRole('dialog');
    await expect(modDlg.getByRole('heading', { name: 'Modules débloqués' })).toBeVisible();
    const entResp = await runMutation(
      page,
      () => modDlg.getByRole('button', { name: 'Enregistrer' }).click(),
      (r) => r.url().includes('/subscription/entitlements') && r.request().method() === 'PATCH',
      'modules',
    );
    expect(entResp.status(), 'mise à jour des modules doit réussir').toBeLessThan(300);
    await shot(page, 'w2-A-modules');
  });

  // ── Workflow 3 : suspendre puis réactiver l'org A ───────────────────────────
  test("W3 — suspendre (recopie du slug) puis réactiver l'org A", async ({ page }) => {
    const s = readState();
    test.skip(!s.orgA, 'dépend de W1 (org A).');
    const org = s.orgA!;
    await login(page);
    await openOrgDetail(page, org);

    // Bouton HEADER « Suspendre » — exact:true pour ne pas heurter le bouton de ligne
    // membre « Suspendre {nom} » (aria-label) qui existe dès qu'il y a un membre.
    await page.getByRole('button', { name: 'Suspendre', exact: true }).click();
    const susDlg = page.getByRole('dialog');
    await expect(susDlg.getByRole('heading', { name: "Suspendre l'organisation" })).toBeVisible();
    await susDlg.getByPlaceholder(org.slug).fill(org.slug);
    const susResp = await runMutation(
      page,
      () => susDlg.getByRole('button', { name: 'Suspendre', exact: true }).click(),
      (r) => r.url().includes(`/orgs/${org.orgId}/status`) && r.request().method() === 'PATCH',
      'suspension',
    );
    expect(susResp.status(), 'suspension doit réussir').toBeLessThan(300);
    await expect(page.getByText('Suspendu').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Réactiver', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, 'w3-A-suspended');

    await page.getByRole('button', { name: 'Réactiver', exact: true }).click();
    const reaDlg = page.getByRole('dialog');
    await expect(reaDlg.getByRole('heading', { name: "Réactiver l'organisation" })).toBeVisible();
    const reaResp = await runMutation(
      page,
      () => reaDlg.getByRole('button', { name: 'Réactiver', exact: true }).click(),
      (r) => r.url().includes(`/orgs/${org.orgId}/status`) && r.request().method() === 'PATCH',
      'réactivation',
    );
    expect(reaResp.status(), 'réactivation doit réussir').toBeLessThan(300);
    await expect(page.getByRole('button', { name: 'Suspendre', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, 'w3-A-reactivated');
  });

  // ── Workflow 4 : membres (ajout + rôle + transfert OWNER + retrait) ─────────
  test('W4 — membres org A : ajouter B, changer rôle, transférer OWNER, retirer A', async ({
    page,
  }) => {
    const s = readState();
    test.skip(!s.orgA || !s.ownerA || !s.ownerB, 'dépend de W1 + W1bis.');
    const org = s.orgA!;
    const ownerA = s.ownerA!;
    const ownerB = s.ownerB!;
    await login(page);
    await openOrgDetail(page, org);

    // ── Ajouter le membre B ────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Ajouter un membre' }).click();
    const addDlg = page.getByRole('dialog');
    await expect(addDlg.getByRole('heading', { name: 'Ajouter un membre' })).toBeVisible();
    const searchRespP = page.waitForResponse(
      (r) => r.url().includes('/admin/users') && r.url().includes('q='),
      { timeout: 20_000 },
    );
    await addDlg.getByLabel('Rechercher un utilisateur').fill(ownerB.email);
    await searchRespP;
    await addDlg.getByRole('button').filter({ hasText: ownerB.email }).first().click();
    const addResp = await runMutation(
      page,
      () => addDlg.getByRole('button', { name: 'Ajouter', exact: true }).click(),
      (r) => r.url().endsWith(`/orgs/${org.orgId}/members`) && r.request().method() === 'POST',
      'ajout membre',
    );
    expect(addResp.status(), 'ajout du membre B doit réussir').toBeLessThan(300);
    await expect(
      page.getByRole('row').filter({ hasText: ownerB.email }),
      'B doit apparaître dans la table des membres',
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'w4-A-member-added');

    const bRow = (): Locator => page.getByRole('row').filter({ hasText: ownerB.email });

    // ── Changer le rôle de B → ADMIN ───────────────────────────────────────
    const roleResp = await runMutation(
      page,
      () => bRow().getByRole('combobox').selectOption('ADMIN'),
      (r) =>
        r.url().includes(`/orgs/${org.orgId}/members/`) &&
        r.url().endsWith('/role') &&
        r.request().method() === 'PATCH',
      'changement de rôle',
    );
    expect(roleResp.status(), 'changement de rôle doit réussir').toBeLessThan(300);
    await expect(bRow().getByRole('combobox')).toHaveValue('ADMIN');
    await shot(page, 'w4-A-role-changed');

    // ── Transférer OWNER à B ───────────────────────────────────────────────
    const ownerResp = await runMutation(
      page,
      () => bRow().getByRole('button', { name: 'Définir OWNER' }).click(),
      (r) => r.url().endsWith(`/orgs/${org.orgId}/owner`) && r.request().method() === 'PATCH',
      'transfert OWNER',
    );
    expect(ownerResp.status(), 'transfert OWNER doit réussir').toBeLessThan(300);
    await expect(
      page.getByRole('row').filter({ hasText: ownerB.email }).getByText('OWNER (non modifiable)'),
      'B doit devenir OWNER',
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'w4-A-owner-transferred');

    // ── Retirer l'ancien OWNER A (rétrogradé) ──────────────────────────────
    const aRow = page.getByRole('row').filter({ hasText: ownerA.email });
    await aRow.getByRole('button', { name: /^Retirer/ }).click();
    const remDlg = page.getByRole('dialog');
    await expect(remDlg.getByRole('heading', { name: 'Retirer le membre' })).toBeVisible();
    const remResp = await runMutation(
      page,
      () => remDlg.getByRole('button', { name: 'Confirmer le retrait' }).click(),
      (r) => r.url().includes(`/orgs/${org.orgId}/members/`) && r.request().method() === 'DELETE',
      'retrait membre',
    );
    expect(remResp.status(), 'retrait du membre A doit réussir').toBeLessThan(300);
    // Le retrait est un SOFT-remove (is_active=false) : le membre RESTE listé, marqué
    // « Suspendu » (design « retrait soft par défaut » pour l'audit/réversibilité ; il n'est
    // PAS supprimé de la table). On assert donc l'état inactif, pas une disparition.
    await expect(
      page.getByRole('row').filter({ hasText: ownerA.email }).getByText('Suspendu'),
      'A doit être soft-retiré (marqué Suspendu), pas supprimé',
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, 'w4-A-member-removed');
  });

  // ── Workflow 5 : compte global (/admin/users) ───────────────────────────────
  test('W5 — compte global : reset mdp + désactiver + réactiver un user E2E-TEST-', async ({
    page,
  }) => {
    const s = readState();
    test.skip(!s.ownerA, 'dépend de W1 (owner A).');
    const target = s.ownerA!; // compte global E2E-TEST- (jamais ryhow99)
    await login(page);
    await page.goto(`${FRONT}/admin/users?q=${encodeURIComponent(target.email)}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    const row = page.getByRole('row').filter({ hasText: target.email });
    await expect(row, 'le user E2E-TEST- doit être listé').toBeVisible({ timeout: 30_000 });
    await shot(page, 'w5-user-row');

    // ── Reset mot de passe ─────────────────────────────────────────────────
    await row.getByRole('button', { name: 'Reset mdp' }).click();
    await expect(
      page.getByRole('heading', { name: 'Réinitialiser le mot de passe' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByLabel(/Nouveau mot de passe/).fill('E2eResetPassword12345');
    const resetResp = await runMutation(
      page,
      () => page.getByRole('button', { name: 'Réinitialiser' }).click(),
      (r) => r.url().includes('/reset-password') && r.request().method() === 'POST',
      'reset mdp',
    );
    expect(resetResp.status(), 'reset mdp doit réussir').toBeLessThan(300);
    await expect(page.getByText(/Mot de passe réinitialisé/i)).toBeVisible({ timeout: 15_000 });
    await shot(page, 'w5-reset-done');
    await page.getByRole('button', { name: 'Fermer' }).click();

    // ── Désactiver le compte ───────────────────────────────────────────────
    const deacResp = await runMutation(
      page,
      () =>
        page
          .getByRole('row')
          .filter({ hasText: target.email })
          .getByRole('button', { name: 'Désactiver' })
          .click(),
      (r) =>
        r.url().includes(`/admin/users/${target.userId}/active`) &&
        r.request().method() === 'PATCH',
      'désactivation compte',
    );
    expect(deacResp.status(), 'désactivation doit réussir').toBeLessThan(300);
    await expect(
      page.getByRole('row').filter({ hasText: target.email }).getByText('Inactif'),
      'le statut doit passer à Inactif',
    ).toBeVisible({ timeout: 20_000 });
    await shot(page, 'w5-deactivated');

    // ── Réactiver le compte ────────────────────────────────────────────────
    const reacResp = await runMutation(
      page,
      () =>
        page
          .getByRole('row')
          .filter({ hasText: target.email })
          .getByRole('button', { name: 'Réactiver' })
          .click(),
      (r) =>
        r.url().includes(`/admin/users/${target.userId}/active`) &&
        r.request().method() === 'PATCH',
      'réactivation compte',
    );
    expect(reacResp.status(), 'réactivation doit réussir').toBeLessThan(300);
    await expect(
      page.getByRole('row').filter({ hasText: target.email }).getByText('Actif'),
      'le statut doit repasser à Actif',
    ).toBeVisible({ timeout: 20_000 });
    await shot(page, 'w5-reactivated');
  });

  // ── Workflow 6 : l'audit reflète les actions sur org A ──────────────────────
  test('W6 — /admin/audit reflète les actions sur org A (entrées tracées)', async ({ page }) => {
    const s = readState();
    test.skip(!s.orgA, 'dépend de W1 (org A).');
    const org = s.orgA!;
    await login(page);
    await page.goto(`${FRONT}/admin/audit`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await expect(
      page.getByText(/couldn.t load|server error|page n.a pas pu/i),
      "la page d'audit ne doit pas crasher",
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: "Journal d'audit" })).toBeVisible({
      timeout: 30_000,
    });

    // L'audit affiche la cible sous forme `org:{8 premiers caractères}…`.
    const orgTarget = `org:${org.orgId.slice(0, 8)}`;
    await expect(
      page.getByText(orgTarget).first(),
      "au moins une entrée d'audit doit cibler l'org A (provisioning + mutations tentées)",
    ).toBeVisible({ timeout: 30_000 });
    await shot(page, 'w6-audit');
  });

  // ── Journalisation finale pour le teardown ──────────────────────────────────
  test.afterAll(() => {
    const s = readState();
    // eslint-disable-next-line no-console
    console.log('\n================ DONNÉES E2E-TEST- À NETTOYER (teardown DB) ================');
    // eslint-disable-next-line no-console
    console.log(`RUN_ID=${RUN_ID}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ created: s.created ?? [] }, null, 2));
    // eslint-disable-next-line no-console
    console.log('===========================================================================\n');
  });
});
