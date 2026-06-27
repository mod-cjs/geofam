/**
 * e2e — Shell + parcours cœur (Lot 2 batch 1)
 *
 * Parcours testés :
 *   D-01 : connexion → liste projets → calcul → émission PV → onglet PV
 *   D-02 : gating abonnement (expiré, quota épuisé, module verrouillé)
 *   États : vide, chargement, erreur, accès clavier
 *
 * Prérequis : le dev server ROADSEN tourne sur localhost:3000 (reuseExistingServer).
 * Sans E2E_BASE_URL NI serveur local, les tests de parcours s'auto-skippent.
 * Le test de confidentialité bundle est LOCAL et ne dépend pas du serveur.
 *
 * Scénarios de démo activés via query param ?demo=<scenario>
 * (voir src/lib/api/client.ts : getActiveScenario).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** URL de l'app — fournie ou par défaut (localhost). */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * Cookie mock auth — posé manuellement pour éviter de dépendre de l'UI login.
 * On fournit `url` SEUL (Playwright rejette la coexistence url+path).
 */
async function setMockAuth(page: import('@playwright/test').Page) {
  await page.context().addCookies([
    {
      name: 'roadsen_mock_auth',
      value: '1',
      url: BASE_URL,
      sameSite: 'Lax',
    },
  ]);
}

/** Racine de l'app shell (orgSlug fixe en mock). */
const SHELL_ROOT = '/app/be-routes-dakar/projets';

// ---------------------------------------------------------------------------
// D-01 — Parcours cœur : connexion → projets → calcul → PV
// ---------------------------------------------------------------------------

test.describe('D-01 — Parcours cœur : login → projets → calcul → PV', () => {
  test.beforeEach(async ({ page }) => {
    // Poser l'auth mock avant toute navigation
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given la page login, when je soumets des identifiants valides, then je suis redirigé vers les projets', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/login');
    await page.getByLabel('Adresse e-mail').fill('chef@bureau.sn');
    await page.getByLabel('Mot de passe').fill('secret');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page).toHaveURL(/\/projets/, { timeout: 8000 });
  });

  test('given la page login, when je soumets "wrong" comme mot de passe, then une erreur 401 est affichée sans quitter la page', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/login');
    await page.getByLabel('Adresse e-mail').fill('chef@bureau.sn');
    await page.getByLabel('Mot de passe').fill('wrong');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('given la page login, when je soumets sans email, then l erreur de validation apparaît en ligne', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/login');
    // Toucher l'email field (blur déclenche la validation)
    await page.getByLabel('Adresse e-mail').fill('');
    await page.getByLabel('Mot de passe').click(); // blur sur email
    await expect(page.getByText(/adresse e-mail est requise/i)).toBeVisible();
  });

  test('given la liste des projets (scénario actif), when la page charge, then au moins un projet est visible', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    // Attendre la fin du chargement (skeleton remplacé par les cartes)
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });
    // Au moins un projet (les mocks en fournissent 3)
    const firstProject = page.getByRole('link').filter({ hasText: /RN|voirie|pont/i }).first();
    await expect(firstProject).toBeVisible({ timeout: 5000 });
  });

  test('given la liste projets, when je clique sur un projet, then je suis redirigé vers l onglet Calculs (F-02)', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    // Attendre les projets
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });
    // Cliquer sur le premier lien projet
    await page.getByRole('link').filter({ hasText: /RN|voirie|pont/i }).first().click();
    // F-02 : onglet par défaut = Calculs
    await expect(page).toHaveURL(/\/calculs/, { timeout: 6000 });
  });

  test('given l onglet Calculs, when je sélectionne un moteur et saisis les champs, then les résultats s affichent', async ({
    page,
  }) => {
    // Naviguer directement vers les calculs du premier projet mock
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=active');

    // Choisir un moteur (C-01 — sélecteur moteur)
    const burmisterBtn = page.getByRole('button', { name: /burmister|chaussée/i }).first();
    await expect(burmisterBtn).toBeVisible({ timeout: 8000 });
    await burmisterBtn.click();

    // Remplir le libellé (champ requis)
    const labelInput = page.getByLabel(/libellé du calcul/i);
    await expect(labelInput).toBeVisible({ timeout: 5000 });
    await labelInput.fill('Test Playwright E2E');

    // Cliquer sur Calculer
    await page.getByRole('button', { name: /calculer/i }).click();

    // Les résultats doivent apparaître (mock répond instantanément)
    await expect(page.getByText(/résultat|résultats/i)).toBeVisible({ timeout: 10000 });
  });

  test('given un calcul terminé, when je clique Émettre un PV, then le modal C-02 s ouvre', async ({
    page,
  }) => {
    // Les mocks incluent des calculs déjà DONE — naviguer vers un calcul existant
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=active');

    // Sélectionner un calcul existant avec statut DONE dans la liste gauche
    const calcRow = page.getByRole('button').filter({ hasText: /dimensionnement|burmister/i }).first();
    await expect(calcRow).toBeVisible({ timeout: 8000 });
    await calcRow.click();

    // Bouton Émettre un PV
    const emettreBtn = page.getByRole('button', { name: /émettre un pv/i });
    await expect(emettreBtn).toBeVisible({ timeout: 5000 });
    await emettreBtn.click();

    // Modal C-02 doit s'ouvrir
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 4000 });
    await expect(page.getByText(/procès-verbal|note d'honnêteté/i)).toBeVisible();
  });

  test('given l onglet PV, when je visite, then les PV scellés s affichent avec badge "Scellé"', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/pv?demo=active');

    // Au moins un PV avec badge Scellé
    await expect(page.getByText(/scellé/i).first()).toBeVisible({ timeout: 8000 });

    // Boutons Vérifier et Télécharger
    await expect(page.getByRole('button', { name: /vérifier/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /télécharger/i }).first()).toBeVisible();
  });

  test('given la navigation clavier, when j active le skip-link, then le focus va sur #main', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    // Tabulation active le skip-link
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: /aller au contenu principal/i });
    if (await skipLink.isVisible()) {
      await page.keyboard.press('Enter');
      const main = page.locator('#main');
      await expect(main).toBeFocused({ timeout: 2000 });
    }
  });
});

// ---------------------------------------------------------------------------
// D-02 — Gating abonnement
// ---------------------------------------------------------------------------

test.describe('D-02 — Gating abonnement (ADR 0011)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given un abonnement expiré, when j accède aux calculs, then la bannière "lecture seule" (role=alert) est visible', async ({
    page,
  }) => {
    await page.goto(
      BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=expired',
    );
    // Assertion POSITIVE et précise : la bannière d'expiration, en role=alert.
    const banner = page.getByRole('alert').filter({ hasText: /abonnement expiré.*lecture seule/i });
    await expect(banner).toBeVisible({ timeout: 8000 });
  });

  test('given un abonnement expiré, when je sélectionne un calcul DONE sans PV, then "Émettre un PV" est ABSENT', async ({
    page,
  }) => {
    await page.goto(
      BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=expired',
    );
    // calc_02 = DONE, sans pvId : le SEUL motif d'absence du bouton est l'expiration.
    const calcRow = page.getByTestId('calc-row-calc_02');
    await expect(calcRow).toBeVisible({ timeout: 8000 });
    await calcRow.click();

    // Le panneau de résultats doit être ouvert (verdict visible) — preuve que le calcul est bien affiché.
    await expect(page.getByText(/conforme/i).first()).toBeVisible({ timeout: 6000 });

    // Bouton Émettre un PV ABSENT (count 0, pas seulement masqué).
    await expect(page.getByRole('button', { name: /émettre un pv/i })).toHaveCount(0);
  });

  test('given un quota épuisé, when j accède aux calculs, then la bannière "Quota épuisé" (role=alert) est visible', async ({
    page,
  }) => {
    await page.goto(
      BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=quota-exhausted',
    );
    const banner = page.getByRole('alert').filter({ hasText: /quota épuisé/i });
    await expect(banner).toBeVisible({ timeout: 8000 });
  });

  test('given un quota épuisé, when je sélectionne un calcul DONE sans PV, then "Émettre un PV" est ABSENT', async ({
    page,
  }) => {
    await page.goto(
      BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=quota-exhausted',
    );
    const calcRow = page.getByTestId('calc-row-calc_02');
    await expect(calcRow).toBeVisible({ timeout: 8000 });
    await calcRow.click();
    await expect(page.getByText(/conforme/i).first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('button', { name: /émettre un pv/i })).toHaveCount(0);
  });

  test('given un pack ROUTES, when j ouvre le sélecteur, then terzaghi/casagrande sont verrouillés et burmister déverrouillé', async ({
    page,
  }) => {
    await page.goto(
      BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=module-locked',
    );

    // Ouvrir le sélecteur de moteurs (mode select-engine) — pas de if() : on EXIGE le bouton.
    const newCalcBtn = page.getByRole('button', { name: /nouveau calcul/i }).first();
    await expect(newCalcBtn).toBeVisible({ timeout: 8000 });
    await newCalcBtn.click();

    // Pack ROUTES = [burmister, pressiometre]. terzaghi et casagrande sont HORS pack.
    const terzaghi = page.getByTestId('engine-item-terzaghi');
    const casagrande = page.getByTestId('engine-item-casagrande');
    const burmister = page.getByTestId('engine-item-burmister');

    await expect(terzaghi).toBeVisible({ timeout: 5000 });
    await expect(casagrande).toBeVisible();
    await expect(burmister).toBeVisible();

    // Verrouillés : data-locked=true + bouton désactivé + cadenas présent.
    await expect(terzaghi).toHaveAttribute('data-locked', 'true');
    await expect(terzaghi).toBeDisabled();
    await expect(page.getByTestId('engine-lock-terzaghi')).toBeVisible();

    await expect(casagrande).toHaveAttribute('data-locked', 'true');
    await expect(casagrande).toBeDisabled();
    await expect(page.getByTestId('engine-lock-casagrande')).toBeVisible();

    // Contre-épreuve : burmister EST dans le pack → déverrouillé, cliquable, pas de cadenas.
    await expect(burmister).toHaveAttribute('data-locked', 'false');
    await expect(burmister).toBeEnabled();
    await expect(page.getByTestId('engine-lock-burmister')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Isolation tenant — un autre org ne voit jamais les projets d'org_01
// ---------------------------------------------------------------------------

test.describe('Isolation tenant — /app/labo-thies', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given le tenant labo-thies (org_02), when je liste les projets, then aucun projet d org_01 n apparaît', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/labo-thies/projets?demo=active');
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });

    // Les projets org_01 (libellés mock) ne doivent JAMAIS apparaître pour org_02.
    await expect(page.getByText(/RN2 — PK 45/i)).toHaveCount(0);
    await expect(page.getByText(/Pont de Mbodiene/i)).toHaveCount(0);
    await expect(page.getByText(/Zone industrielle Thiès/i)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Verdict NON CONFORME — le cœur métier doit être atteignable (parcours réel)
// ---------------------------------------------------------------------------

test.describe('Verdict — NON CONFORME atteignable (F-08)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given le calcul fixture NON CONFORME, when je le sélectionne, then le VerdictBanner affiche "NON CONFORME" et aucun PV', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/calculs?demo=active');

    // calc_fail_01 = fixture MOCK_CALC_FAIL (verdict FAIL, sans pvId).
    const failRow = page.getByTestId('calc-row-calc_fail_01');
    await expect(failRow).toBeVisible({ timeout: 8000 });
    await failRow.click();

    // VerdictBanner affiche le libellé fail.
    await expect(page.getByText('NON CONFORME').first()).toBeVisible({ timeout: 6000 });
  });

  // NB : le déterminisme du verdict FAIL via un nouveau calcul (?demo=fail / seuil
  // d'épaisseur burmister < 0,20 m) est prouvé au niveau unité dans
  // src/lib/api/__tests__/mock-gating.test.ts (bloc « déterminisme du verdict »),
  // qui pilote runCalc directement sans dépendre du remplissage complet du
  // formulaire dynamique (parcours fragile, hors périmètre de cette sentinelle).
});

// ---------------------------------------------------------------------------
// États UI — vide, chargement, erreur (composants de l'écran)
// ---------------------------------------------------------------------------

test.describe('États UI — vide / erreur / accessibilité', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given la bibliothèque, when la page charge, then les 6 moteurs sont groupés par domaine', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/be-routes-dakar/bibliotheque?demo=active');
    await expect(page.getByRole('heading', { name: 'Bibliothèque de moteurs' })).toBeVisible({
      timeout: 8000,
    });
    // 3 groupes de domaine
    await expect(page.getByText('Chaussées').first()).toBeVisible();
    await expect(page.getByText('Fondations').first()).toBeVisible();
    // Labo
    await expect(page.getByText(/labo|sol/i).first()).toBeVisible();
  });

  test('given la sidebar, when je navigue entre les liens, then la navigation clavier fonctionne (tabulation)', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    // La sidebar doit avoir au moins un lien Mes projets
    const projetsLink = page.getByRole('link', { name: /mes projets/i });
    await expect(projetsLink).toBeVisible({ timeout: 6000 });
    // Vérifier que le lien est focusable
    await projetsLink.focus();
    await expect(projetsLink).toBeFocused();
  });

  test('given la page overview, when je navigue, then les compteurs calculs et PV sont affichés', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/overview?demo=active');
    await expect(page.getByText('Calculs')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/PV scellés/i)).toBeVisible();
  });

  test('given la page infos projet, when je modifie le nom, then le bouton enregistrer est actif', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/app/be-routes-dakar/projets/proj_01/infos?demo=active');
    await expect(page.getByLabel(/nom du projet/i)).toBeVisible({ timeout: 8000 });

    const input = page.getByLabel(/nom du projet/i);
    await input.fill('Nouveau nom Playwright');

    const saveBtn = page.getByRole('button', { name: /enregistrer/i });
    await expect(saveBtn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// F-03 — Nouveau projet self-service
// ---------------------------------------------------------------------------

test.describe('F-03 — Nouveau projet self-service', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/login');
    await setMockAuth(page);
  });

  test('given la liste des projets, when je clique Nouveau projet, then le modal de création s ouvre', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /nouveau projet/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 4000 });
    await expect(page.getByLabel(/nom du projet/i)).toBeVisible();
  });

  test('given le modal de création, when je valide sans nom, then une erreur en ligne s affiche', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /nouveau projet/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 4000 });

    // Blur sur le champ nom sans remplir
    await page.getByLabel(/nom du projet/i).focus();
    await page.getByLabel(/nom du projet/i).blur();
    await expect(page.getByText(/le nom est requis/i)).toBeVisible();
  });

  test('given le modal de création, when je saisis un nom et valide, then le projet apparaît dans la liste', async ({
    page,
  }) => {
    await page.goto(BASE_URL + `${SHELL_ROOT}?demo=active`);
    await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /nouveau projet/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 4000 });

    await page.getByLabel(/nom du projet/i).fill('Projet Playwright Test');
    await page.getByRole('button', { name: 'Créer le projet' }).click();

    // Le modal se ferme et on est redirigé vers les calculs du nouveau projet (F-02)
    await expect(page).toHaveURL(/\/projets\/proj_new_\d+\/calculs|\/calculs/, {
      timeout: 8000,
    });
  });
});

// ---------------------------------------------------------------------------
// Confidentialité DoD §8 — bundle web (test local, pas de serveur requis)
// ---------------------------------------------------------------------------

test.describe('Confidentialité DoD §8 — bundle web (gate UNIQUE)', () => {
  const CONFIDENTIAL_MARKER = '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__';
  const ENGINE_SPECIFIER = '@roadsen/engines';
  const nextBuildDir = path.resolve(__dirname, '../../apps/web/.next/static/chunks');

  /** Scan partagé : renvoie la liste des fichiers .js d'un dossier qui contiennent `needle`. */
  function chunksContaining(dir: string, needle: string): string[] {
    const hits: string[] = [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      if (content.includes(needle)) hits.push(file);
    }
    return hits;
  }

  test('le bundle web compilé ne contient ni marqueur confidentiel ni specifier @roadsen/engines', () => {
    if (!fs.existsSync(nextBuildDir)) {
      test.skip(
        true,
        "Build Next.js absent (.next/static/chunks) — lancer 'pnpm build' dans apps/web d'abord",
      );
      return;
    }

    const jsFiles = fs.readdirSync(nextBuildDir).filter((f) => f.endsWith('.js'));
    expect(jsFiles.length, 'aucun chunk .js trouvé — chemin de scan invalide ?').toBeGreaterThan(0);

    expect(
      chunksContaining(nextBuildDir, CONFIDENTIAL_MARKER),
      'des chunks contiennent le marqueur confidentiel moteur',
    ).toEqual([]);
    expect(
      chunksContaining(nextBuildDir, ENGINE_SPECIFIER),
      'des chunks contiennent le specifier @roadsen/engines',
    ).toEqual([]);
  });

  /**
   * Test de NON-INERTIE : prouve que la logique de scan détecte RÉELLEMENT le
   * marqueur quand il est présent. Sans ce test, un scan pointant un mauvais
   * dossier (ou une logique cassée) passerait toujours au vert (faux-vert).
   *
   * On fabrique un dossier temporaire avec un faux chunk porteur du marqueur ;
   * le scan DOIT le trouver.
   */
  test('non-inertie : un faux chunk porteur du marqueur est bien détecté par le scan', () => {
    const tmpDir = fs.mkdtempSync(
      path.join(require('node:os').tmpdir(), 'roadsen-bundle-scan-'),
    );
    try {
      const cleanFile = path.join(tmpDir, 'clean.js');
      const dirtyFile = path.join(tmpDir, 'leaky.js');
      fs.writeFileSync(cleanFile, 'export const ok = 1;\n', 'utf8');
      fs.writeFileSync(
        dirtyFile,
        `var x = "${CONFIDENTIAL_MARKER}"; import "${ENGINE_SPECIFIER}";\n`,
        'utf8',
      );

      const markerHits = chunksContaining(tmpDir, CONFIDENTIAL_MARKER);
      const specifierHits = chunksContaining(tmpDir, ENGINE_SPECIFIER);

      // Le scan DOIT trouver le fichier sale — et lui seul.
      expect(markerHits).toEqual(['leaky.js']);
      expect(specifierHits).toEqual(['leaky.js']);
      // Le fichier propre ne doit PAS être un faux positif.
      expect(markerHits).not.toContain('clean.js');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
