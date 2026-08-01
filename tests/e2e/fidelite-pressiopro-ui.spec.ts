/**
 * FIDÉLITÉ D'INTERFACE PRESSIOPRO — HTML client (référence gelée) ↔ NOTRE clone
 * (essai pressiométrique Ménard, NF EN ISO 22476-4 ; « clone UI client », ADR 0015).
 * ==========================================================================
 *
 * OBJECTIF : PROUVER l'équivalence d'AFFICHAGE/FONCTIONNEMENT entre l'outil
 * PressioPro du client (`pressiometre__1_.html`, gelé) et notre logiciel web —
 * qui, depuis ADR 0015, N'EST PLUS une reconstruction React mais le CLONE fidèle
 * de l'UI client (calcul EXCISÉ), chargé en `<iframe srcdoc sandbox>` via
 * `ToolFrame`, dont le calcul part côté SERVEUR (DoD §8).
 *
 * DISPOSITIF (patron IDENTIQUE au pilote terzaghi — les 4 volets exigés) :
 *   (a) SORTIE SERVEUR du cas de référence — l'état exemple de `loadExempleFictif()`
 *       (profondeur « 2.0 m », pf_idx=2/plm_idx=5) exécuté par le MOTEUR SOURCE
 *       `runPressiometre` en sous-processus (`scripts/pressiopro-engine-run.mts`) :
 *       c'est numériquement la sortie qu'un serveur renverrait (équivalence
 *       module↔origine prouvée par les unitaires du paquet pressiometre). On charge
 *       la SOURCE via tsx (jamais le moteur dans le bundle du spec/navigateur, §8).
 *   (b) RÉFÉRENCE (LECTURE seule) — `pressiometre__1_.html` en file://, « 🧪 Exemple »
 *       cliqué → calcul LOCAL (elle a encore son moteur : calcDepth/autoDetectPhase/
 *       solve3) → extraction DOM (KPIs E_M/pL/pf/α, catégorie, tables paramètres
 *       normalisés + volumes, extrapolation, synthèse, mesures corrigées, onglets).
 *   (c) NOTRE app en LOCAL, MODE RÉEL (port 3104), clone en iframe : même cas via
 *       « 🧪 Exemple » puis « Calculer — Dépouillement complet » ; la requête de
 *       calcul (`POST .../calc/pressiometre`) est INTERCEPTÉE par page.route et
 *       fulfillée avec la sortie du MOTEUR SOURCE sur le body RÉELLEMENT posté par le
 *       clone (`BackendPersistedCalcResult`, engineId `pressiometre`). Extraction du
 *       MÊME jeu d'éléments dans le frame.
 *   (d) CLASSIFICATION FERMÉE par élément : (a) mappé = valeurs identiques (tol rel
 *       5e-3, décimales fr-FR), (b) §8 fail-closed = liste fermée (VIDE pour pressiopro :
 *       « zéro écart », le clone rend TOUT ce que la réf affiche), (c) absent = liste
 *       fermée (VIDE). Toute ligne non classée = ÉCHEC. Assertions dures finales :
 *       uncovered/omitted/valueMismatch vides.
 *
 * ZÉRO FAUX-VERT : réf absente → ÉCHEC dur ; « 0 KPI » extrait d'un côté → ÉCHEC dur ;
 * calc non intercepté → ÉCHEC dur ; le stub backend REFUSE le calcul (405) pour
 * garantir que la sortie comparée vient bien de l'interception, jamais du stub.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE + AFFICHAGE, PAS la justesse
 * scientifique (responsabilité STARFIRE — split contractuel ; l'équivalence
 * module↔origine est prouvée par les unitaires du paquet).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Frame, type Page, type Route } from '@playwright/test';

// --------------------------------------------------------------------------
// Constantes & identité forgée
// --------------------------------------------------------------------------
const SECRET = 'fidelite-pressiopro-e2e-secret-32bytes-min-xxxx'; // = webServer.env.JWT_SECRET
const ORG_SLUG = 'etude-fid-pressiopro';
const ORG_ID = 'org_ppf';
const REF_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/pressiometre__1_.html',
);
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/pressiopro.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAP_DIR = path.join(OUT_DIR, 'captures');

/**
 * Cas de validation — profondeur « 2.0 m » de `loadExempleFictif()` (depths[0],
 * pf_idx=2/plm_idx=5), sous la forme EXACTE que `buildEssaiInput(0)` poste au
 * serveur après « 🧪 Exemple » : `getParams()` divise `a` par 10 (5 cm³/MPa saisi
 * → 0,5 cm³/bar interne), gamma défaut 19, nappe 3.0. Figé ici ; vérifié contre la
 * réf par le probe headless de mise au point (valeurs identiques au bit près).
 */
const EXAMPLE_INPUT = {
  projet: 'Exemple fictif — sondage de démonstration',
  label: '2.0 m',
  params: { a: 0.5, Ph: 0.5, Pe: 1.0, V0: 535, k0: 0.5 },
  gamma: 19,
  nappe: 3.0,
  rows: [
    { p: 0.8, v15: 21, v30: 22, v60: 24 },
    { p: 1.2, v15: 44, v30: 45, v60: 47 },
    { p: 1.6, v15: 68, v30: 69, v60: 70 },
    { p: 2, v15: 88, v30: 89, v60: 90 },
    { p: 2.4, v15: 108, v30: 109, v60: 110 },
    { p: 2.8, v15: 127, v30: 128, v60: 130 },
    { p: 3.2, v15: 144, v30: 148, v60: 154 },
    { p: 3.6, v15: 171, v30: 177, v60: 188 },
    { p: 4, v15: 219, v30: 227, v60: 242 },
    { p: 4.4, v15: 310, v30: 321, v60: 340 },
  ],
  pf_idx: 2,
  plm_idx: 5,
};

function ensureDirs(): void {
  mkdirSync(CAP_DIR, { recursive: true });
}
function dumpJson(name: string, data: unknown): void {
  ensureDirs();
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// --------------------------------------------------------------------------
// JWT HS256 forgé (node:crypto, aucune dépendance) — mêmes claims que le middleware.
// --------------------------------------------------------------------------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function forgeJwt(): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: 'user_ppf',
      orgs: [{ id: ORG_ID, slug: ORG_SLUG, role: 'OWNER' }],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = b64url(
    createHmac('sha256', SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

// --------------------------------------------------------------------------
// Extraction DOM — fonction SÉRIALISÉE (navigateur). MÊME code pour la référence
// (page) et pour le clone (frame) : la structure DOM du clone est celle de la
// référence (clonage), donc les mêmes sélecteurs valent des deux côtés. On lit le
// panneau Résultats (#resCont) — ce que `renderResults` met sous les yeux de
// l'opérateur (identique dans le HTML client et le clone).
// --------------------------------------------------------------------------
interface Kpi {
  k: string; // libellé (E_M, pL (limite), Pf, E/PLM, P*LM, P*f, α Ménard, Ey=E/α)
  v: string; // valeur
  u: string; // unité
  b: string; // badge de verdict (Remanié / N.C. / Précons.) — vide si absent
}
interface UiModel {
  kpis: Kpi[];
  catName: string; // catégorie de sol (libellé) — .catb .catnm
  catDesc: string; // description — .catb .catds
  catClass: string; // classe A..E de la carte catégorie
  paramRows: string[][]; // tables « Paramètres normalisés » + « Volume » : [label, val, unit]
  extRows: string[][]; // encart extrapolation courbe inverse : [label, valeur]
  extErr: string; // ligne « Ajustement moyen : … cm³ »
  synthese: string; // bandeau « Synthèse » (texte normalisé, valeurs incluses)
  recTable: string[][]; // « Tableau des mesures corrigées » : [#, Pbrut, Pcorr, V60, Δ60/30, Phase]
  tabs: string[]; // onglets du bas (nav .nb) — structure de navigation
  hasChart: boolean; // courbe P–V (canvas #chartPV) présente à l'écran
  resLen: number; // longueur du innerHTML de #resCont (garde non-vide)
}

function extractModel(): UiModel {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const rc = document.getElementById('resCont');
  const kpis: Kpi[] = Array.from(rc?.querySelectorAll('.kg4 .kp') ?? []).map((k) => ({
    k: norm(k.querySelector('.kl')?.textContent),
    v: norm(k.querySelector('.kv.sm')?.textContent),
    u: norm(k.querySelector('.ku')?.textContent),
    b: norm(k.querySelector('.kb')?.textContent),
  }));
  const catb = rc?.querySelector('.catb');
  const catName = norm(catb?.querySelector('.catnm')?.textContent);
  const catDesc = norm(catb?.querySelector('.catds')?.textContent);
  const catClass = (catb?.className ?? '')
    .replace('catb', '')
    .replace(/\s+/g, ' ')
    .trim();
  const paramRows: string[][] = Array.from(
    rc?.querySelectorAll('.ptbl tbody tr') ?? [],
  ).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent)));
  const extRows: string[][] = Array.from(rc?.querySelectorAll('.ep-row') ?? []).map((r) =>
    Array.from(r.querySelectorAll('span')).map((s) => norm(s.textContent)),
  );
  const extErr = norm(rc?.querySelector('.ep-err')?.textContent);
  const synthese = norm(rc?.querySelector('.itp')?.textContent);
  const recTable: string[][] = Array.from(rc?.querySelectorAll('#recTb tr') ?? []).map(
    (tr) => Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent)),
  );
  const tabs = Array.from(document.querySelectorAll('.nb')).map((b) =>
    norm(b.textContent),
  );
  const hasChart = !!rc?.querySelector('canvas#chartPV');

  return {
    kpis,
    catName,
    catDesc,
    catClass,
    paramRows,
    extRows,
    extErr,
    synthese,
    recTable,
    tabs,
    hasChart,
    resLen: (rc?.innerHTML ?? '').length,
  };
}

// --------------------------------------------------------------------------
// Normalisation & comparaison numérique (Node) — patron fidelite-terzaghi.
// --------------------------------------------------------------------------
function keyOf(cardK: string): string {
  return cardK
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function parseNums(s: string): number[] {
  let t = s.replace(/[\u00a0\u202f]/g, '');
  t = t.replace(/(\d),(\d)/g, '$1.$2'); // décimales fr-FR
  const m = t.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  return m ? m.map(Number) : [];
}
function relErr(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
}
/** Compare deux chaînes affichées : mêmes nombres (tol) OU même texte normalisé. */
function displayEqual(ref: string, ours: string): { ok: boolean; why: string } {
  const rn = parseNums(ref);
  const on = parseNums(ours);
  if (rn.length === 0 && on.length === 0) {
    const a = keyOf(ref);
    const b = keyOf(ours);
    return a === b
      ? { ok: true, why: '' }
      : { ok: false, why: `texte « ${ref} » ≠ « ${ours} »` };
  }
  if (rn.length !== on.length) {
    return { ok: false, why: `#valeurs ${JSON.stringify(rn)} ≠ ${JSON.stringify(on)}` };
  }
  for (let i = 0; i < rn.length; i++) {
    // Tolérance : mêmes renderers des deux côtés → mêmes précisions fr-FR ; on
    // tolère l'arrondi d'affichage (rel 5e-3), l'égalité exacte des entiers formatés.
    const rv = rn[i] ?? Number.NaN;
    const ov = on[i] ?? Number.NaN;
    const e = relErr(rv, ov);
    if (e > 5e-3)
      return {
        ok: false,
        why: `valeur[${i}] réf=${rv} nous=${ov} rel=${e.toExponential(2)}`,
      };
  }
  return { ok: true, why: '' };
}

// --------------------------------------------------------------------------
// Sortie serveur (a) via moteur SOURCE en sous-processus (cache par body — le clone
// poste plusieurs fois le MÊME body : boot + dépouillement de la même profondeur).
// --------------------------------------------------------------------------
const _engineCache = new Map<string, unknown>();
function serverOutputForBody(bodyJson: string): unknown {
  const cached = _engineCache.get(bodyJson);
  if (cached !== undefined) return cached;
  const raw = execFileSync('npx', ['tsx', 'scripts/pressiopro-engine-run.mts'], {
    input: bodyJson,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
  expect(parsed.ok, `moteur serveur (a) a échoué : ${raw.slice(0, 400)}`).toBe(true);
  expect(parsed.output, 'sortie serveur (a) vide').toBeTruthy();
  _engineCache.set(bodyJson, parsed.output);
  return parsed.output;
}

// --------------------------------------------------------------------------
// (b) RÉFÉRENCE — file://, clic « 🧪 Exemple », extraction du panneau Résultats.
// --------------------------------------------------------------------------
async function loadReferenceModel(page: Page): Promise<UiModel> {
  page.on('pageerror', () => {
    /* Chart.js/icônes CDN absents en file:// — sans effet sur le moteur/DOM */
  });
  page.on('dialog', (d) => void d.accept());
  await page.goto(pathToFileURL(REF_HTML).href, { waitUntil: 'domcontentloaded' });
  // Le moteur de la référence doit être présent (sinon file:// cassé) — zéro faux-vert.
  await page.locator('button.ibx', { hasText: /Exemple/ }).click();
  // loadExempleFictif → goPage('resultats',4) + renderResults(depths[0]._res) à +100ms.
  await page.waitForFunction(
    () => document.querySelectorAll('#resCont .kg4 .kp').length > 0,
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(extractModel);
}

// --------------------------------------------------------------------------
// (c) NOTRE app — connexion forgée, iframe clone, interception du calcul.
// --------------------------------------------------------------------------
async function openOurClone(
  page: Page,
  token: string,
): Promise<{ calcReal: () => number }> {
  let calcReal = 0;

  await page.addInitScript((tok) => {
    try {
      window.sessionStorage.setItem('roadsen_access_token', tok);
    } catch {
      /* noop */
    }
  }, token);

  // Appels CLIENT interceptés (le route-handler serveur, lui, tape le stub).
  await page.route(/\/me\/entitlements/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orgId: ORG_ID,
        pack: 'COMPLETE',
        modules: ['pressiometre', 'pressio-etalonnage', 'pressio-calibrage'],
        expiresAt: new Date(Date.now() + 3.15e10).toISOString(),
        expired: false,
        quota: { limit: 1000, used: 1, remaining: 999 },
        serverTime: new Date().toISOString(),
      }),
    }),
  );
  await page.route(/\/projects$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'proj_ppf',
          orgId: ORG_ID,
          name: 'E2E fidélité pressiopro',
          domain: 'LB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_ppf',
        },
      ]),
    }),
  );
  // LE CŒUR : la requête de calcul est interceptée et fulfillée avec la sortie du
  // MOTEUR SOURCE sur le body RÉELLEMENT posté par le clone (buildEssaiInput), sous
  // la forme BackendPersistedCalcResult attendue par httpRunCalc/ToolFrame. Le dryRun
  // (aperçu débouncé updateSeuilPreview) est distingué par la query ?dryRun=true et ne
  // remonte AUCUN calcResultId (parité httpRunCalc).
  let calcSeq = 0;
  await page.route(/\/projects\/[^/]+\/calc\/pressiometre/, async (route: Route) => {
    const isDry = route.request().url().includes('dryRun=true');
    const bodyJson = route.request().postData() ?? '{}';
    let output: unknown;
    try {
      output = serverOutputForBody(bodyJson);
    } catch (e) {
      // Échec dur, jamais un faux-vert : on renvoie une erreur explicite.
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: `moteur source: ${String(e)}` }),
      });
      return;
    }
    if (!isDry) calcReal += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calcResultId: isDry ? undefined : `cr_ppf_${++calcSeq}`,
        ok: true,
        meta: { engineId: 'pressiometre', engineVersion: 'e2e-fidelite' },
        output,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/pressiopro`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  // Le projet (unique projet LB) doit être AUTO-sélectionné avant tout calcul :
  // tant qu'il ne l'est pas, l'indice « Sélectionnez un projet » est affiché et
  // ToolFrame BLOQUE le calcul. Attendre sa disparition garantit que la requête
  // atteindra bien la route.
  await page
    .locator('[data-testid="no-project-hint"]')
    .waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(500);
  return { calcReal: () => calcReal };
}

function cloneFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((f) => f.url().includes('srcdoc') || f !== page.mainFrame());
  if (!frame) throw new Error('frame du clone pressiopro introuvable');
  return frame;
}

// ==========================================================================
// SUITE 1 — RÉFÉRENCE (catalogue + garde-fou non-vide)
// ==========================================================================
test.describe('FIDÉLITÉ PRESSIOPRO — référence client (file://)', () => {
  test('given le HTML client, when « 🧪 Exemple » + calcul local, then l’UI de référence est catalogable et NON vide', async ({
    browser,
  }) => {
    expect(existsSync(REF_HTML), `Référence ABSENTE (${REF_HTML}) — ÉCHEC dur.`).toBe(
      true,
    );
    ensureDirs();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const REF = await loadReferenceModel(page);
    await page.screenshot({
      path: path.join(CAP_DIR, 'pressiopro-client-resultats.png'),
      fullPage: true,
    });
    dumpJson('pressiopro-fidelite-reference.json', REF);

    // Zéro faux-vert : la référence DOIT produire un vrai dépouillement.
    expect(REF.kpis.length, 'la réf doit rendre les KPIs de dépouillement').toBe(8);
    expect(REF.catName.length, 'la réf doit rendre la catégorie de sol').toBeGreaterThan(
      0,
    );
    expect(
      REF.paramRows.length,
      'la réf doit rendre les tables paramètres+volumes',
    ).toBeGreaterThanOrEqual(10);
    expect(
      REF.recTable.length,
      'la réf doit rendre le tableau des mesures corrigées',
    ).toBeGreaterThan(0);
    expect(REF.hasChart, 'la réf doit rendre la courbe P–V (canvas #chartPV)').toBe(true);
    expect(REF.tabs, 'onglets de navigation réf').toEqual([
      'Log',
      'Étalon.',
      'Calibrage',
      'Projet',
      'Mesures',
      'Résultats',
      'Profil',
      'Export',
    ]);
    await ctx.close();
  });
});

// ==========================================================================
// SUITE 2 — CLONE + COMPARAISON (classification fermée, assertions dures)
// ==========================================================================
test.describe('FIDÉLITÉ PRESSIOPRO — clone (iframe) ↔ référence', () => {
  test('given le même cas, when calcul serveur intercepté, then affichage/structure du clone FIDÈLES à la réf (classification fermée)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);

    // Modèle de référence (autonome — ne dépend pas de l'ordre des suites).
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const REF = await loadReferenceModel(await refCtx.newPage());
    expect(REF.kpis.length, 'réf sans KPIs (extraction cassée)').toBe(8);
    await refCtx.close();

    // (a) sortie serveur du cas exemple — prouve que engine-run marche + dump.
    const serverOutput = serverOutputForBody(JSON.stringify(EXAMPLE_INPUT));
    dumpJson('pressiopro-fidelite-server-output.json', serverOutput);

    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();

    const { calcReal } = await openOurClone(page, token);

    // Le clone doit être chargé et prêt.
    const frame = cloneFrame(page);
    await frame.getByRole('button', { name: /Exemple/ }).waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    // (c) même cas via « 🧪 Exemple » → onglet Mesures → « Dépouillement complet ».
    // Le flux anti-course est celui, prouvé, de pressiopro-note-scellement : après
    // Exemple, `loadExempleFictif` planifie un aperçu débouncé (updateSeuilPreview,
    // dryRun) + un calcul de boot. On attend que l'aperçu ait ABOUTI (#seuilPreview
    // affiche « … MPa ») pour qu'aucun aperçu ne soit plus en vol, puis on lance le
    // dépouillement : c'est alors le calc:request de séquence la PLUS récente
    // (ToolFrame ne superséderait pas sa réponse).
    await frame.getByRole('button', { name: /Exemple/ }).click();
    await frame.locator('button.nb[data-page="mesures"]').click();
    await expect
      .poll(async () => frame.locator('#sel_pf option').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await frame.locator('#seuilPreview').waitFor({ state: 'visible', timeout: 20_000 });
    await expect
      .poll(async () => (await frame.locator('#seuilPreview').innerText()).trim(), {
        timeout: 20_000,
      })
      .toContain('MPa');
    await page.waitForTimeout(400);
    await frame.locator('button.bp', { hasText: /Dépouillement complet/ }).click();

    // Le panneau Résultats se peuple (KPIs de dépouillement).
    await frame
      .locator('#resCont .kg4 .kp')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    // Attendre la fin d'un éventuel placeholder « Calcul en cours… ».
    await expect
      .poll(
        async () =>
          (await frame.locator('#resCont').innerHTML()).includes('Calcul en cours'),
        { timeout: 20_000 },
      )
      .toBe(false);
    await page.waitForTimeout(500);

    expect(
      calcReal(),
      'la requête de calcul DOIT avoir été interceptée (sinon comparaison invalide)',
    ).toBeGreaterThan(0);

    const OURS = await frame.evaluate(extractModel);
    await page.screenshot({
      path: path.join(CAP_DIR, 'pressiopro-nous-resultats.png'),
      fullPage: true,
    });
    dumpJson('pressiopro-fidelite-clone.json', OURS);

    // ---- Recheck EXCISION : le HTML servi ne contient aucun symbole moteur excisé ----
    const servedHtml = await page.evaluate(async (orgId: string) => {
      const res = await fetch(
        `/api/tools/pressiopro?orgId=${encodeURIComponent(orgId)}`,
        {
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem('roadsen_access_token')}`,
          },
        },
      );
      return res.text();
    }, ORG_ID);
    // Garde anti-faux-vert : on a bien récupéré le CLONE (pas une page d'erreur).
    expect(servedHtml.length, 'HTML servi trop court (fetch échoué ?)').toBeGreaterThan(
      10_000,
    );
    expect(servedHtml, 'HTML servi ≠ clone pressiopro (bridge absent)').toContain(
      '__geofamBridge',
    );
    // Symboles du MOTEUR de la référence (présents dans pressiometre__1_.html,
    // JAMAIS dans le clone) + marqueur confidentiel des modules @roadsen/engines.
    const EXCISED_MARKERS = [
      'calcDepth',
      'autoDetectPhase',
      'solve3',
      'runPressiometre',
      '__ROADSEN_ENGINE_',
    ];
    const leaks = EXCISED_MARKERS.filter((m) => servedHtml.includes(m));
    expect(
      leaks,
      `symboles moteur EXCISÉS/confidentiels présents dans le HTML servi : ${leaks.join(', ')}`,
    ).toHaveLength(0);

    // ==================================================================
    // CLASSIFICATION FERMÉE
    // ==================================================================
    const uncovered: string[] = []; // ligne réf non classée / label désaligné
    const omitted: string[] = []; // ligne réf sans équivalent côté clone (longueur)
    const valueMismatch: string[] = []; // mappée mais valeur/texte divergent
    const sec8Residual: string[] = []; // (b) §8 fail-closed — VIDE pour pressiopro (zéro écart)
    const absentClosed: string[] = []; // (c) absences documentées — VIDE pour pressiopro

    // Précondition d'INTÉGRATION : le clone doit AVOIR rendu un dépouillement.
    const integrationOk = OURS.kpis.length > 0;

    // -- (a) KPIs (comparaison par INDICE : renderResults rend le MÊME ordre des 2 côtés) --
    if (REF.kpis.length !== OURS.kpis.length) {
      omitted.push(`#KPIs réf=${REF.kpis.length} ≠ clone=${OURS.kpis.length}`);
    } else {
      for (let i = 0; i < REF.kpis.length; i++) {
        const r = REF.kpis[i]!;
        const o = OURS.kpis[i]!;
        if (keyOf(r.k) !== keyOf(o.k))
          uncovered.push(`KPI[${i}] label réf « ${r.k} » ≠ clone « ${o.k} »`);
        const cv = displayEqual(r.v, o.v);
        if (!cv.ok) valueMismatch.push(`KPI « ${r.k} » valeur : ${cv.why}`);
        if (keyOf(r.u) !== keyOf(o.u))
          valueMismatch.push(`KPI « ${r.k} » unité réf « ${r.u} » ≠ clone « ${o.u} »`);
        const cb = displayEqual(r.b, o.b);
        if (!cb.ok) valueMismatch.push(`KPI « ${r.k} » badge : ${cb.why}`);
      }
    }

    // -- (a) Catégorie de sol --
    {
      const cn = displayEqual(REF.catName, OURS.catName);
      if (!cn.ok) valueMismatch.push(`catégorie (libellé) : ${cn.why}`);
      const cd = displayEqual(REF.catDesc, OURS.catDesc);
      if (!cd.ok) valueMismatch.push(`catégorie (description) : ${cd.why}`);
      if (REF.catClass !== OURS.catClass)
        valueMismatch.push(
          `catégorie (classe) : réf « ${REF.catClass} » ≠ clone « ${OURS.catClass} »`,
        );
    }

    // -- (a) Tables « Paramètres normalisés » + « Volume » (par INDICE) --
    if (REF.paramRows.length !== OURS.paramRows.length) {
      omitted.push(
        `#lignes tables paramètres réf=${REF.paramRows.length} ≠ clone=${OURS.paramRows.length}`,
      );
    } else {
      for (let i = 0; i < REF.paramRows.length; i++) {
        const r = REF.paramRows[i]!;
        const o = OURS.paramRows[i]!;
        if (r.length !== o.length) {
          valueMismatch.push(
            `ligne paramètre[${i}] : #colonnes ${r.length} ≠ ${o.length}`,
          );
          continue;
        }
        if (keyOf(r[0] ?? '') !== keyOf(o[0] ?? ''))
          uncovered.push(`paramètre[${i}] label réf « ${r[0]} » ≠ clone « ${o[0]} »`);
        for (let j = 1; j < r.length; j++) {
          const c = displayEqual(r[j] ?? '', o[j] ?? '');
          if (!c.ok) valueMismatch.push(`paramètre « ${r[0]} » col ${j} : ${c.why}`);
        }
      }
    }

    // -- (a) Encart extrapolation (courbe inverse) --
    if (REF.extRows.length !== OURS.extRows.length) {
      omitted.push(
        `#lignes extrapolation réf=${REF.extRows.length} ≠ clone=${OURS.extRows.length}`,
      );
    } else {
      for (let i = 0; i < REF.extRows.length; i++) {
        const r = REF.extRows[i]!;
        const o = OURS.extRows[i]!;
        if (keyOf(r[0] ?? '') !== keyOf(o[0] ?? ''))
          uncovered.push(`extrapolation[${i}] label réf « ${r[0]} » ≠ clone « ${o[0]} »`);
        const c = displayEqual(r[1] ?? '', o[1] ?? '');
        if (!c.ok) valueMismatch.push(`extrapolation « ${r[0]} » : ${c.why}`);
      }
    }
    {
      const c = displayEqual(REF.extErr, OURS.extErr);
      if (!c.ok) valueMismatch.push(`extrapolation (ajustement moyen) : ${c.why}`);
    }

    // -- (a) Bandeau « Synthèse » (texte + valeurs) --
    if (REF.synthese) {
      const c = displayEqual(REF.synthese, OURS.synthese);
      if (!c.ok) valueMismatch.push(`synthèse : ${c.why}`);
    }

    // -- (a) Tableau des mesures corrigées (par INDICE, cellule à cellule) --
    if (REF.recTable.length !== OURS.recTable.length) {
      omitted.push(
        `#lignes mesures corrigées réf=${REF.recTable.length} ≠ clone=${OURS.recTable.length}`,
      );
    } else {
      for (let i = 0; i < REF.recTable.length; i++) {
        const r = REF.recTable[i]!;
        const o = OURS.recTable[i]!;
        if (r.length !== o.length) {
          valueMismatch.push(`mesure[${i}] : #colonnes ${r.length} ≠ ${o.length}`);
          continue;
        }
        for (let j = 0; j < r.length; j++) {
          const c = displayEqual(r[j] ?? '', o[j] ?? '');
          if (!c.ok) valueMismatch.push(`mesure corrigée [${i}] col ${j} : ${c.why}`);
        }
      }
    }

    // -- Structure (onglets, courbe) : fidélité par construction. --
    expect(OURS.tabs, 'onglets de navigation clone ≠ réf').toEqual(REF.tabs);
    expect(OURS.hasChart, 'la courbe P–V du clone doit être présente (#chartPV)').toBe(
      true,
    );

    const summary = {
      integrationOk,
      refKpis: REF.kpis.length,
      ourKpis: OURS.kpis.length,
      refParamRows: REF.paramRows.length,
      ourParamRows: OURS.paramRows.length,
      refRecTable: REF.recTable.length,
      ourRecTable: OURS.recTable.length,
      catRef: REF.catName,
      catNous: OURS.catName,
      classes: { uncovered, omitted, valueMismatch, sec8Residual, absentClosed },
    };
    dumpJson('pressiopro-fidelite-classification.json', summary);
    // eslint-disable-next-line no-console
    console.log('\n[FIDÉLITÉ PRESSIOPRO]\n' + JSON.stringify(summary, null, 2));

    // ==================================================================
    // ASSERTIONS DURES (zéro faux-vert)
    // ==================================================================
    expect(
      integrationOk,
      `INTÉGRATION : le clone n'a rendu AUCUN KPI de dépouillement alors que la réf en a ${REF.kpis.length}. ` +
        `Cause probable : la sortie serveur BRUTE (output.courbe/volumes/synthese/extrapolation) n'atteint pas ` +
        `l'iframe (mapEssaiOutput lit ces champs) — vérifier httpRunCalc/adaptPersistedCalcResult (whitelist BRUTE).`,
    ).toBe(true);
    expect(uncovered, 'lignes réf NON classées (labels désalignés)').toHaveLength(0);
    expect(omitted, 'lignes réf OMISES côté clone (longueurs)').toHaveLength(0);
    expect(valueMismatch, 'VALEURS divergentes clone↔réf').toHaveLength(0);

    await ctx.close();
  });
});
