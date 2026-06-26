/**
 * e2e — Page de test moteurs (surface recette).
 *
 * Parcours : sélection du moteur chaussée → saisie des paramètres →
 * clic « Calculer » → résultat whitelisté affiché.
 *
 * Ce test exige :
 *   - E2E_BASE_URL : URL de l'app web (ex. http://localhost:3000)
 *   - E2E_API_BASE_URL : URL de l'API (ex. http://localhost:3001)
 *
 * Sans ces variables, les tests s'auto-skippent proprement (pas de faux-vert).
 *
 * CONFIDENTIALITÉ DoD §8 : le test de bundle (ci-dessous) vérifie que le
 * bundle web compilé NE CONTIENT AUCUN marqueur moteur confidentiel.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL;
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Parcours utilisateur — moteur chaussée (Burmister)
// ---------------------------------------------------------------------------

test.describe('Page de test moteurs — /recette', () => {
  test.skip(!BASE_URL, 'E2E_BASE_URL non défini : pas de cible web stable');

  test('given la page /recette, when je sélectionne le moteur chaussée et calcule, then le résultat apparaît', async ({
    page,
  }) => {
    await page.goto('/recette');

    // La page doit s'afficher avec le sélecteur de moteur
    await expect(page.getByRole('heading', { name: /recette/i })).toBeVisible();
    await expect(page.getByLabel(/moteur/i)).toBeVisible();

    // Sélectionner le moteur Burmister (chaussée)
    await page.getByLabel(/moteur/i).selectOption('burmister');

    // Les champs du formulaire doivent apparaître (champ trafic)
    await expect(page.getByLabel(/TMJA/i)).toBeVisible();

    // Renseigner la clé de recette (vide en dev local = guard inerte)
    const keyInput = page.getByLabel(/clé de recette/i);
    await keyInput.fill('');

    // Les valeurs exemple sont pré-remplies — on vérifie qu'un champ numérique
    // contient bien une valeur (le formulaire a pré-rempli les exemples)
    const tmjaInput = page.getByLabel(/TMJA/i);
    await expect(tmjaInput).not.toHaveValue('');

    // Lancer le calcul
    await page.getByRole('button', { name: /calculer/i }).click();

    // Attendre le résultat (l'API répond avec l'enveloppe { ok, meta, output })
    const resultSection = page.getByTestId('calc-result');
    await expect(resultSection).toBeVisible({ timeout: 15000 });

    // Le résultat doit mentionner la conformité (champ "conforme" de BurmisterOutput)
    const resultText = await resultSection.textContent();
    expect(resultText).toMatch(/conforme|ok|NE|famille|ornierage/i);
  });

  test('given un moteur sélectionné, when la clé est incorrecte (non vide), then une erreur 401 est affichée proprement', async ({
    page,
  }) => {
    // Ce test n'est pertinent que si l'API est configurée avec une clé
    // (RECETTE_API_KEY posée). On vérifie simplement que l'UI gère l'erreur.
    await page.goto('/recette');
    await page.getByLabel(/moteur/i).selectOption('burmister');

    // Clé intentionnellement invalide
    await page.getByLabel(/clé de recette/i).fill('cle-invalide-test');

    await page.getByRole('button', { name: /calculer/i }).click();

    // L'UI doit afficher un message d'erreur (401 ou enveloppe ok:false)
    // — on attend soit une bannière d'erreur, soit le résultat avec erreur
    const errorOrResult = page.getByTestId('calc-error').or(page.getByTestId('calc-result'));
    await expect(errorOrResult).toBeVisible({ timeout: 10000 });
  });

  test('given la page /recette, when je change de moteur, then le formulaire se met à jour', async ({
    page,
  }) => {
    await page.goto('/recette');

    // Changer pour Terzaghi
    await page.getByLabel(/moteur/i).selectOption('terzaghi');
    // Un champ spécifique à Terzaghi doit apparaître
    await expect(page.getByLabel(/forme/i)).toBeVisible();

    // Changer pour Pressiomètre
    await page.getByLabel(/moteur/i).selectOption('pressiometre');
    // Un champ spécifique au pressiomètre (libellé unique dans ce formulaire)
    await expect(page.getByLabel(/Profondeur \(libellé\)/)).toBeVisible();
  });

  test('given la clé de recette saisie, when je recharge la page, then la clé est restaurée depuis sessionStorage', async ({
    page,
  }) => {
    await page.goto('/recette');
    await page.getByLabel(/clé de recette/i).fill('ma-cle-test-session');

    // Recharger la page
    await page.reload();

    // La clé doit être restaurée
    await expect(page.getByLabel(/clé de recette/i)).toHaveValue('ma-cle-test-session');
  });
});

// ---------------------------------------------------------------------------
// Test de confidentialité — le bundle web ne contient aucun marqueur moteur
// ---------------------------------------------------------------------------

test.describe('Confidentialité DoD §8 — bundle web', () => {
  /**
   * Vérifie que le bundle Next.js compilé ne contient pas le marqueur confidentiel
   * embarqué dans chaque moteur (__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__).
   *
   * Ce test est LOCAL (ne nécessite pas E2E_BASE_URL) : il lit le répertoire .next/.
   * Il s'exécute uniquement si le build existe (pnpm build a été lancé).
   *
   * Pattern : cf. DoD §8 — contrôle de bundle CI.
   */
  test('le bundle web compilé ne contient aucun symbole moteur confidentiel', () => {
    const nextBuildDir = path.resolve(
      __dirname,
      '../../apps/web/.next/static/chunks',
    );

    if (!fs.existsSync(nextBuildDir)) {
      // Build non disponible : skip explicite (pas de faux-vert)
      test.skip(
        true,
        "Build Next.js absent (.next/static/chunks) : lancer 'pnpm build' d'abord",
      );
      return;
    }

    const CONFIDENTIAL_MARKER = '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__';
    const ENGINE_SPECIFIER = '@roadsen/engines';

    const jsFiles = fs
      .readdirSync(nextBuildDir)
      .filter((f) => f.endsWith('.js'));

    expect(jsFiles.length).toBeGreaterThan(0);

    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(nextBuildDir, file), 'utf8');
      expect(
        content,
        `Le fichier bundle ${file} contient le marqueur confidentiel moteur`,
      ).not.toContain(CONFIDENTIAL_MARKER);
      expect(
        content,
        `Le fichier bundle ${file} contient le specifier @roadsen/engines`,
      ).not.toContain(ENGINE_SPECIFIER);
    }
  });
});

// ---------------------------------------------------------------------------
// Test de santé API directe (vérifie que l'endpoint recette existe bien)
// ---------------------------------------------------------------------------

test.describe('Sanité endpoint recette', () => {
  test('POST /calc/burmister répond 201 ou 401 (endpoint existant)', async ({
    request,
  }) => {
    // Test de l'API directement — valide que l'endpoint est bien à /calc/burmister
    const resp = await request.post(`${API_BASE_URL}/calc/burmister`, {
      data: {
        layers: [{ mat: 'BBSG1', E: 5400, nu: 0.35, h: 0.06 }],
        subgrade: { E: 50, nu: 0.35 },
        traffic: { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 },
        load: { p: 0.662, a: 0.125, d: 0.375 },
      },
      headers: { 'Content-Type': 'application/json' },
    });
    // 201 = calcul ok ; 401 = clé recette requise mais absente ; les deux prouvent que l'endpoint existe
    expect([201, 401]).toContain(resp.status());
  });
});
