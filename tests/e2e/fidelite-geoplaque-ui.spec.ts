/**
 * FIDÉLITÉ D'INTERFACE GEOPLAQUE — HTML client (référence) ↔ NOTRE app live.
 * ==========================================================================
 *
 * OBJECTIF (distinct de l'équivalence golden-master qui compare des NOMBRES bruts
 * serveur↔HTML) : PRODUIRE LA PREUVE des écarts d'INTERFACE, de FONCTIONNEMENT et
 * d'AFFICHAGE entre l'outil GEOPLAQUE du client et notre portage. Le titulaire
 * constate que « geoplaque est très différent de ce que le client a fourni » et
 * exige 0 % d'écart. Ce spec ne CORRIGE rien : il CATALOGUE + CAPTURE.
 *
 * DISPOSITIF :
 *   1. CLIENT (référence, LECTURE seule) — GEOPLAQUE_V10.html chargé en file://
 *      dans un vrai Chromium. On extrait l'inventaire COMPLET de l'UI (header/menu,
 *      tool rail, canvas, onglets Modèle/Sol/Propriétés/Résultats/2D, tous les champs
 *      de chaque pane, boutons d'action, statut). On calcule un cas radier de
 *      référence (setState + solve + refreshResults) pour capturer le panneau
 *      RÉSULTATS réellement rendu (cartographie 9 champs, EC7, synthèse). Captures
 *      par pane → docs/audits-fidelite/captures/client-*.png.
 *   2. NOUS (live) — login geoplaque@starfire.test sur roadsen.vercel.app, logiciel
 *      GEOPLAQUE. Même inventaire (onglets réels, sections, champs, boutons). Captures
 *      alignées → docs/audits-fidelite/captures/nous-*.png.
 *   3. Le tout est journalisé (console.log JSON) pour alimenter le rapport
 *      docs/audits-fidelite/geoplaque-ecarts-ui.md.
 *
 * ZÉRO FAUX-VERT : si le HTML client est absent, ÉCHEC DUR (pas de skip silencieux).
 * Les captures sont des ARTEFACTS de preuve : leur absence n'invalide pas les
 * assertions structurelles, mais toute assertion load-bearing (présence d'onglets,
 * de solveurs) échoue si l'inventaire est vide.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE (structure + rendu), PAS la
 * justesse scientifique (responsabilité STARFIRE — split contractuel). L'équivalence
 * NUMÉRIQUE des moteurs est déjà prouvée à 0 % par equivalence-geoplaque-golden.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Page } from '@playwright/test';

// Symboles GLOBAUX du HTML d'origine (résolus dans le navigateur au evaluate).
// `state` est un `const` top-level (binding LEXICAL, PAS une propriété de globalThis)
// et `solveModel`/`doSolve` sont des déclarations de fonction : tous accessibles en
// IDENTIFIANTS NUS depuis page.evaluate (jamais via globalThis.state — qui est undefined).
declare const state: {
  rafts: unknown;
  pointLoads: unknown;
  lineLoads: unknown;
  areaLoads: unknown;
  pointSprings: unknown;
  lineSprings: unknown;
  layers: unknown;
  results: unknown;
};
declare function solveModel(opts: unknown): Record<string, unknown>;
declare function doSolve(): void;

// --------------------------------------------------------------------------
// Références & cibles
// --------------------------------------------------------------------------

const FROZEN_HTML = path.resolve(
  __dirname,
  '../../../03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html',
);
const FRONT = 'https://roadsen.vercel.app';
const GP_EMAIL = process.env.GP_EMAIL ?? 'geoplaque@starfire.test';
const GP_PASSWORD = process.env.GP_PASSWORD ?? 'P@sser12345#';
const ORG_SLUG = 'etude-geoplaque';
const RUN_CALC = process.env.RUN_CALC === '1';
const NAV = 120_000;

const CAP_DIR = path.resolve(__dirname, '../../docs/audits-fidelite/captures');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');

function ensureDirs(): void {
  mkdirSync(CAP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
}

/** Dump JSON lisible pour le rapport (un fichier par côté). */
function dumpJson(name: string, data: unknown): void {
  ensureDirs();
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// ==========================================================================
// SUITE 1 — INVENTAIRE + CAPTURES DU HTML CLIENT (référence, file://)
// ==========================================================================

interface ClientInventory {
  title: string;
  brand: string;
  menuButtons: string[];
  toolRail: { tool: string; tip: string }[];
  tabs: { pane: string; label: string; active: boolean }[];
  panes: Record<string, PaneFields>;
  resultFieldButtons: string[];
  ec7Rows: { label: string; value: string; comment: string }[];
  synthese: { label: string; value: string }[];
}
interface PaneFields {
  sectionTitles: string[];
  fields: { label: string; id: string; type: string; value: string }[];
  toggles: { label: string; id: string }[];
  actionButtons: string[];
}

test.describe('FIDÉLITÉ GEOPLAQUE — inventaire + captures du HTML CLIENT (référence)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    if (!existsSync(FROZEN_HTML)) {
      throw new Error(
        `HTML client de référence ABSENT (${FROZEN_HTML}). Sources hors dépôt : ` +
          `impossible de cataloguer l'UI de référence — ÉCHEC dur (pas de skip silencieux).`,
      );
    }
    ensureDirs();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', () => {
      /* icônes CDN absentes en file:// — sans effet sur les solveurs/DOM */
    });
    await page.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    // Sanity : les solveurs + la globale state sont présents (identifiants NUS).
    const globals = await page.evaluate(() => ({
      solveModel: typeof solveModel,
      doSolve: typeof doSolve,
      state: typeof state !== 'undefined',
    }));
    expect(globals.solveModel, 'solveModel absent').toBe('function');
    expect(globals.doSolve, 'doSolve absent').toBe('function');
    expect(globals.state, 'globale state absente').toBe(true);
  });

  test('given le HTML client, when on catalogue l’UI, then on capture la structure COMPLÈTE (5 onglets, tool rail, canvas)', async () => {
    // ---- Inventaire structurel via le DOM réel ----
    const inv = (await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const attr = (el: Element | null, a: string) =>
        el ? el.getAttribute(a) || '' : '';

      const brand =
        txt(document.querySelector('.brand .word')) +
        ' ' +
        txt(document.querySelector('.brand small'));
      const menuButtons = Array.from(document.querySelectorAll('.menu button')).map((b) =>
        txt(b),
      );
      const toolRail = Array.from(document.querySelectorAll('.rail button.tool')).map(
        (b) => ({
          tool: attr(b, 'data-tool'),
          tip: txt(b.querySelector('.tip')),
        }),
      );
      const tabs = Array.from(document.querySelectorAll('.inspector .tabs button')).map(
        (b) => ({
          pane: attr(b, 'data-pane'),
          label: txt(b),
          active: b.classList.contains('active'),
        }),
      );

      const panes: Record<string, unknown> = {};
      for (const paneEl of Array.from(document.querySelectorAll('.inspector .pane'))) {
        const id = attr(paneEl, 'id');
        const sectionTitles = Array.from(paneEl.querySelectorAll('.secth')).map((s) =>
          txt(s),
        );
        const fields = Array.from(paneEl.querySelectorAll('label.field')).map((l) => {
          const input = l.querySelector('input,textarea,select');
          return {
            label: txt(l.querySelector('span')) || txt(l),
            id: attr(input, 'id'),
            type: input
              ? (input as HTMLInputElement).type || input.tagName.toLowerCase()
              : '',
            value: input ? (input as HTMLInputElement).value : '',
          };
        });
        const toggles = Array.from(paneEl.querySelectorAll('label.toggle')).map((l) => ({
          label: txt(l),
          id: attr(l.querySelector('input'), 'id'),
        }));
        const actionButtons = Array.from(paneEl.querySelectorAll('button'))
          .map((b) => txt(b))
          .filter(Boolean);
        panes[id] = { sectionTitles, fields, toggles, actionButtons };
      }
      return {
        title: document.title,
        brand,
        menuButtons,
        toolRail,
        tabs,
        panes,
      };
    })) as unknown as Partial<ClientInventory>;

    // Assertions load-bearing (l'inventaire doit être non vide et fidèle au fichier).
    expect(inv.tabs, 'les 5 onglets client attendus').toBeTruthy();
    expect(inv.tabs!.map((t) => t.pane)).toEqual([
      'model',
      'soil',
      'props',
      'results',
      'ps',
    ]);
    expect(
      inv.toolRail!.length,
      'tool rail non vide (≥ 10 outils)',
    ).toBeGreaterThanOrEqual(10);
    expect(
      inv.menuButtons!.length,
      'menu (Nouveau/Exemple/… ≥ 5)',
    ).toBeGreaterThanOrEqual(5);

    // ---- Captures par pane ----
    // Le layout client = header + tool rail + canvas (stage) + inspector (droite).
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-00-vue-globale.png'),
      fullPage: false,
    });

    // Bascule d'onglet via switchPane() (la routine réelle des boutons .tabs) —
    // plus fiable qu'un .click() (le simple clic ne déclenche pas toujours le handler
    // inline dans ce HTML). Un wait laisse le pane se rendre avant la capture.
    const switchPane = async (pane: string) => {
      await page.evaluate(
        (p) => (globalThis as { switchPane?: (x: string) => void }).switchPane?.(p),
        pane,
      );
      await page.waitForTimeout(200);
    };
    // Onglet Modèle (défaut actif).
    await switchPane('model');
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-01-onglet-modele.png'),
      fullPage: false,
    });
    // Onglet Sol.
    await switchPane('soil');
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-02-onglet-sol.png'),
      fullPage: false,
    });
    // Onglet Propriétés (vide sans sélection).
    await switchPane('props');
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-03-onglet-proprietes.png'),
      fullPage: false,
    });
    // Onglet 2D (déformations planes + axi + tri-raft).
    await switchPane('ps');
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-05-onglet-2d.png'),
      fullPage: false,
    });

    dumpJson('geoplaque-inventaire-client.json', inv);
    console.log('[CLIENT INVENTAIRE]\n' + JSON.stringify(inv, null, 2));
  });

  test('given un cas radier de référence, when on calcule côté client, then on capture le panneau Résultats (cartographie 9 champs, EC7, synthèse)', async () => {
    // Cas de référence : carré 6×6, charge centrée 1000 kN, 2 couches (miroir des
    // fixtures d'équivalence). On renseigne state puis on lance solve()+refreshResults()
    // comme le fait le bouton « Calculer » (doCalc du HTML), afin de rendre le pane
    // RÉSULTATS réellement affiché (renderRes/refreshResults) — pas la sortie brute.
    const res = await page.evaluate(() => {
      state.rafts = [
        {
          pts: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 6 },
            { x: 0, y: 6 },
          ],
          E: 32000,
          nu: 0.2,
          e: 0.4,
        },
      ];
      state.pointLoads = [{ x: 3, y: 3, Fz: 1000 }];
      state.lineLoads = [];
      state.areaLoads = [];
      state.pointSprings = [];
      state.lineSprings = [];
      state.layers = [
        { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
        { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
      ];
      let err: string | null = null;
      try {
        // doSolve() est la routine du bouton « Calculer » (#solve.onclick=runSolve→doSolve) :
        // lit les options DOM (meshsize=0.8 par défaut), appelle solveModel, renseigne
        // state.results, bascule sur le pane Résultats et le rend (refreshResults).
        doSolve();
      } catch (e) {
        err = String((e && (e as Error).message) || e);
      }
      return { err, hasResults: !!state.results };
    });
    expect(res.err, `le calcul client doit aboutir : ${res.err}`).toBeNull();
    expect(res.hasResults, 'state.results doit être renseigné après solve()').toBe(true);

    // Onglet Résultats → capture le rendu réel (refreshResults l'a déjà peuplé).
    await page.locator('.inspector .tabs button[data-pane="results"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(CAP_DIR, 'client-04-onglet-resultats.png'),
      fullPage: false,
    });

    // Extraction du panneau Résultats rendu (cartographie, EC7, synthèse).
    const rr = await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const attr = (el: Element | null, a: string) =>
        el ? el.getAttribute(a) || '' : '';
      const body = document.getElementById('resbody');
      const fieldButtons = Array.from(
        body?.querySelectorAll('.res-field button[data-f]') ?? [],
      ).map((b) => `${attr(b, 'data-f')}=${txt(b)}`);
      // Vérifications EC7 : rendues par chk() = <div flex> dot + <span>label</span> +
      // <b>valeur</b> (PAS de classe .chk dans le pane — .chk n'existe qu'au print).
      // On sélectionne les div directs de resbody qui portent un span ET un b, sans être
      // une .stat (synthèse) ni une .secth ni un .res-field.
      const ec7Rows = Array.from(body?.children ?? [])
        .filter(
          (c) =>
            c.tagName === 'DIV' &&
            !c.classList.contains('stat') &&
            !c.classList.contains('secth') &&
            !c.classList.contains('res-field') &&
            c.querySelector('span') &&
            c.querySelector('b'),
        )
        .map((c) => ({
          label: txt(c.querySelector('span')),
          value: txt(c.querySelector('b')),
          comment: '',
        }));
      // Synthèse : .stat (span label + b valeur).
      const synthese = Array.from(body?.querySelectorAll('.stat') ?? []).map((s) => ({
        label: txt(s.querySelector('span')),
        value: txt(s.querySelector('b')),
      }));
      // Titres de section du pane résultats.
      const sections = Array.from(body?.querySelectorAll('.secth') ?? []).map((s) =>
        txt(s),
      );
      // Toggles (isovaleurs, bandes, points critiques) + sélecteur de niveaux.
      const toggles = Array.from(body?.querySelectorAll('label.toggle') ?? []).map((t) =>
        txt(t),
      );
      const fullText = txt(body);
      return {
        sections,
        fieldButtons,
        ec7Rows,
        synthese,
        toggles,
        fullTextLen: fullText.length,
      };
    });
    expect(
      rr.fieldButtons.length,
      'la cartographie doit exposer les 9 boutons de champ',
    ).toBe(9);
    expect(
      rr.ec7Rows.length,
      'les vérifications EC7 doivent être rendues',
    ).toBeGreaterThanOrEqual(4);
    expect(rr.synthese.length, 'la synthèse doit être rendue').toBeGreaterThanOrEqual(6);

    dumpJson('geoplaque-resultats-client.json', rr);
    console.log(
      '[CLIENT RÉSULTATS radier carré 6×6 / P=1000]\n' + JSON.stringify(rr, null, 2),
    );
  });
});

// ==========================================================================
// SUITE 2 — INVENTAIRE + CAPTURES DE NOTRE APP LIVE (Vercel↔Render)
// ==========================================================================

async function login(page: Page): Promise<void> {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(GP_EMAIL);
  await page.getByLabel('Mot de passe').fill(GP_PASSWORD);
  await Promise.all([
    page.waitForURL(new RegExp(`/app/${ORG_SLUG}/(logiciels|projets)`), { timeout: NAV }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

test.describe('FIDÉLITÉ GEOPLAQUE — inventaire + captures de NOTRE app LIVE', () => {
  test('given l’org etude-geoplaque connectée, when j’ouvre GEOPLAQUE, then on catalogue nos onglets + capture chaque état', async ({
    browser,
  }) => {
    test.setTimeout(400_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);

    await login(page);
    await page.goto(`${FRONT}/app/${ORG_SLUG}/logiciels/geoplaque`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await expect(
      page.getByText(
        /couldn.t load|server error|Application error|page n.a pas pu|403|non autorisé/i,
      ),
    ).toHaveCount(0);

    // Sous-titre GEOPLAQUE (unique + visible dans le contenu principal — le titre
    // « GEOPLAQUE » apparaît aussi caché dans la nav latérale, d'où le ciblage du sous-titre).
    await expect(
      page.getByText(/Radier .* plaque sur sol multicouche/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Inventaire de NOS onglets (role=tab) + sections/champs visibles.
    const ourTabs = await page
      .locator('[role="tab"]')
      .allTextContents()
      .then((a) => a.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean));
    console.log('[NOUS onglets live] ' + JSON.stringify(ourTabs));

    // Capture par onglet. On clique chaque onglet role=tab et on capture.
    await page.screenshot({
      path: path.join(CAP_DIR, 'nous-00-vue-globale.png'),
      fullPage: true,
    });

    const tabLabels = [
      'Modèle & sol',
      'Charges & ressorts',
      'Résultats & cartographie',
      '2D',
    ];
    let idx = 1;
    for (const label of tabLabels) {
      const tab = page
        .getByRole('tab', { name: new RegExp(label.replace(/[&]/g, '.'), 'i') })
        .first();
      if (
        await tab
          .count()
          .then((c) => c > 0)
          .catch(() => false)
      ) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(400);
        const slug = label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        await page.screenshot({
          path: path.join(CAP_DIR, `nous-0${idx}-onglet-${slug}.png`),
          fullPage: true,
        });
      }
      idx++;
    }

    // Inventaire des sections + libellés de champ visibles (heuristique : secth + labels).
    const ourInventory = await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map((t) =>
        txt(t),
      );
      const buttons = Array.from(document.querySelectorAll('button'))
        .map((b) => txt(b))
        .filter((t) => t.length > 1 && t.length < 60);
      const labels = Array.from(document.querySelectorAll('label'))
        .map((l) => txt(l))
        .filter(Boolean);
      return {
        tabs,
        buttons: Array.from(new Set(buttons)),
        labels: Array.from(new Set(labels)),
      };
    });
    dumpJson('geoplaque-inventaire-nous.json', ourInventory);
    console.log('[NOUS INVENTAIRE live]\n' + JSON.stringify(ourInventory, null, 2));

    expect(ourTabs.length, 'notre app doit présenter des onglets').toBeGreaterThanOrEqual(
      1,
    );
    await ctx.close();
  });

  test('given RUN_CALC=1, when je lance un calcul radier live, then on capture le panneau Résultats & cartographie', async ({
    browser,
  }) => {
    test.skip(
      !RUN_CALC,
      'RUN_CALC=1 requis (consomme du quota, ≤6 calculs) pour le volet calcul live.',
    );
    test.setTimeout(400_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);

    await login(page);
    await page.goto(`${FRONT}/app/${ORG_SLUG}/logiciels/geoplaque`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

    // --- 1. Projet : sélectionne le 1er existant, sinon en crée un (mutation, pas un calcul) ---
    const projetSelect = page.getByLabel('Projet', { exact: true });
    const optionValues = await projetSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    const firstReal = optionValues.find((v) => v && v !== '__new__');
    if (firstReal) {
      await projetSelect.selectOption(firstReal);
    } else {
      await projetSelect.selectOption('__new__');
      const nameInput = page.getByLabel('Nom du nouveau projet');
      await nameInput.fill(`E2E fidélité GEOPLAQUE ${Date.now()}`);
      await page.getByRole('button', { name: 'Créer' }).click();
      await page.waitForTimeout(2500);
    }

    // --- 2. Formulaire minimal valide : onglet Modèle & sol → 1 couche renseignée ---
    await page
      .getByRole('tab', { name: /Modèle/i })
      .first()
      .click();
    await page.waitForTimeout(400);
    // Le radier carré 6×6 est pré-rempli (E=30000, ν=0.2, e=0.4). Renseigne la couche de sol
    // (positionnel : inputs de la 1re ligne du tableau « Profil de sol »).
    const soilRow = page
      .locator('table', { has: page.locator('th', { hasText: 'E (MPa)' }) })
      .locator('tbody tr')
      .first();
    await soilRow.locator('input').nth(0).fill('-12'); // Base z
    await soilRow.locator('input').nth(1).fill('20'); // E (MPa)
    await soilRow.locator('input').nth(2).fill('0.33'); // ν
    // Charge : onglet Charges → renseigne la charge RÉPARTIE pré-remplie (emprise 0,0→6,6
    // sur le radier, q vide par défaut). q=50 kPa sur toute la plaque : charge valide,
    // plus robuste que d'ajouter une ligne ponctuelle vide.
    await page
      .getByRole('tab', { name: /Charges/i })
      .first()
      .click();
    await page.waitForTimeout(400);
    const areaTable = page
      .locator('table', { has: page.locator('th', { hasText: /q \(kPa\)/i }) })
      .first();
    const areaRow = areaTable.locator('tbody tr').first();
    // Colonnes : x1,y1,x2,y2,q → q est le 5e input de la ligne.
    await areaRow.locator('input').nth(4).fill('50');
    await page.waitForTimeout(200);

    // Le bouton Calculer s'active dès qu'un projet est sélectionné/créé.
    const calcBtn = page.getByRole('button', { name: /^Calculer/ }).first();
    const enabled = await calcBtn.isEnabled().catch(() => false);
    if (enabled) {
      const [resp] = await Promise.all([
        page
          .waitForResponse(
            (r) =>
              /\/projects\/[^/]+\/calc\/(radier|plane-strain|axi|tri-raft)$/.test(
                new URL(r.url()).pathname,
              ),
            { timeout: 120_000 },
          )
          .catch(() => null),
        calcBtn.click(),
      ]);
      if (resp)
        console.log(
          `[NOUS calc live] HTTP ${resp.status()} ${new URL(resp.url()).pathname}`,
        );
      await page.waitForTimeout(1500);
    } else {
      console.log(
        '[NOUS calc live] bouton Calculer inactif (projet requis) — capture de l’état.',
      );
    }
    await page
      .getByRole('tab', { name: /Résultats/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(CAP_DIR, 'nous-06-resultats-calcul.png'),
      fullPage: true,
    });

    // Extraction des lignes affichées (Diagnostics EC7 + cartographie).
    const rr = await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('table tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td,th')).map((c) => txt(c)),
      );
      // Sélecteur des 9 champs de cartographie (testid réel = heatmap-field-<key>).
      const fieldButtons = Array.from(
        document.querySelectorAll('[data-testid^="heatmap-field-"]'),
      )
        .map((b) => txt(b))
        .filter(Boolean);
      return { rows: rows.filter((r) => r.length > 0), fieldButtons };
    });
    dumpJson('geoplaque-resultats-nous.json', rr);
    console.log('[NOUS RÉSULTATS live]\n' + JSON.stringify(rr, null, 2));
    await ctx.close();
  });
});
