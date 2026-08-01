/**
 * FIDÉLITÉ D'INTERFACE CASAGRANDE — HTML client (référence gelée) ↔ NOTRE clone
 * (fondations profondes / pieux, NF P 94-262 / Eurocode 7 ; « clone UI client », ADR 0015).
 * ==========================================================================
 *
 * OBJECTIF : PROUVER l'équivalence d'AFFICHAGE/FONCTIONNEMENT entre l'outil
 * CASAGRANDE du client (`casagrande_V5.html`, gelé) et notre logiciel web — qui,
 * depuis ADR 0015, N'EST PLUS une reconstruction React mais le CLONE fidèle de l'UI
 * client (calcul EXCISÉ), chargé en `<iframe srcdoc sandbox>` via `ToolFrame`, dont
 * le calcul part côté SERVEUR (DoD §8).
 *
 * DISPOSITIF (patron IDENTIQUE au pilote terzaghi/pressiopro — les 4 volets exigés) :
 *   (a) SORTIE SERVEUR du cas de référence — l'état « Remplir la fiche fictivement »
 *       (`fillFictitious()` : pieu foré Ø0,60 m, D=15 m, profil argile/sable/argile/
 *       marne, PMT, DA2, compression) exécuté par le MOTEUR SOURCE `runPieux` en
 *       sous-processus (`scripts/casagrande-engine-run.mts`) : c'est numériquement la
 *       sortie qu'un serveur renverrait (équivalence module↔origine prouvée par les
 *       unitaires du paquet pieux). On charge la SOURCE via tsx (jamais le moteur dans
 *       le bundle du spec/navigateur, §8).
 *   (b) RÉFÉRENCE (LECTURE seule) — `casagrande_V5.html` en file://, « Remplir la fiche
 *       fictivement » puis « Calculer la portance → » → calcul LOCAL (elle a encore son
 *       moteur : portanceCore/settlement/betonCheck/computeQce) → extraction DOM
 *       (verdict, KPIs R_b/R_s/R_c;d/tassement, tables Résistances/Vérifications/
 *       Frottement/Synthèse/Béton, encarts hint ξ₃-ξ₄/charges/E_M, courbe, onglets).
 *   (c) NOTRE app en LOCAL, MODE RÉEL (port 3105), clone en iframe : même cas via
 *       « Remplir la fiche fictivement » puis « Calculer la portance → » ; la requête de
 *       calcul (`POST .../calc/pieux`) est INTERCEPTÉE par page.route et fulfillée avec
 *       la sortie du MOTEUR SOURCE sur le body RÉELLEMENT posté par le clone
 *       (`buildPieuxInput`, engineId `pieux`). Extraction du MÊME jeu d'éléments dans
 *       le frame.
 *   (d) CLASSIFICATION FERMÉE par élément : (a) mappé = valeurs identiques (tol rel
 *       1e-9 — même renderer `fmt` des deux côtés, sciences équivalentes : on vise
 *       l'égalité de chaîne, cf. finding m1) ; (b) §8 fail-closed = liste fermée (VIDE
 *       pour casagrande) ; (c) absent = liste fermée DOCUMENTÉE, DÉSORMAIS VIDE : depuis
 *       l'ouverture B1, le contrat pieux transporte le libellé de combinaison EC7 `comb`
 *       par vérification ET le module E_M de la couche porteuse (encart tassement), tous
 *       deux rendus par le clone → comparés en (a). Toute ligne non classée = ÉCHEC.
 *       Assertions dures finales : uncovered/omitted/valueMismatch ET absentClosed vides.
 *
 * ZÉRO FAUX-VERT : réf absente → ÉCHEC dur ; « 0 KPI » extrait d'un côté → ÉCHEC dur ;
 * calc non intercepté → ÉCHEC dur ; le stub backend REFUSE le calcul (405) pour
 * garantir que la sortie comparée vient bien de l'interception, jamais du stub. Plus
 * aucune absence tolérée (c) : la moindre divergence de valeur (comb/E_M compris) tombe
 * en valueMismatch (échec dur) — ZÉRO ÉCART (ADR 0014).
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
const SECRET = 'fidelite-casagrande-e2e-secret-32bytes-min-xx'; // = webServer.env.JWT_SECRET
const ORG_SLUG = 'etude-fid-casagrande';
const ORG_ID = 'org_cgf';
const REF_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/casagrande_V5.html',
);
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/casagrande.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAP_DIR = path.join(OUT_DIR, 'captures');

/**
 * Cas de validation — l'exemple « Remplir la fiche fictivement » (`fillFictitious()`)
 * sous la forme EXACTE que `buildPieuxInput(false)` poste au serveur : pieu foré simple
 * (cat. 1) Ø0,60 m, D=15 m, z0=0, G=800/Q=350 kN, nappe 3 m, profil 4 couches
 * (argile/sable/argile/marne), méthode PMT, DA2, compression, β25. `coeffs` = constante
 * normative `CASAGRANDE_COEFFS` (non éditable). `cpt.pts` VIDE : le pénétrogramme n'est
 * consommé QUE par la branche CPT — la branche PMT de l'exemple l'ignore (le vrai clone
 * poste le pénétrogramme complet ; la comparaison de fidélité passe, elle, par le body
 * RÉELLEMENT posté et intercepté). Figé ici ; vérifié par le probe headless de mise au
 * point (sortie serveur identique à la réf, valeurs affichées identiques au bit près).
 */
const EXAMPLE_INPUT = {
  geom: { section: 'circ', g_B: 0.6, g_b2: 0.5 },
  g_z0: 0.0,
  g_D: 15.0,
  cat: 1,
  meth: 'pmt',
  da: 'da2',
  sens: 'comp',
  essais: 'non',
  c_G: 800,
  c_Q: 350,
  o_nappe: 3.0,
  o_nprofil: 1,
  o_surf: 2500,
  o_redis: 'non',
  grp: { grp_n: 1, grp_m: 1, grp_s: 0 },
  coeffs: {
    k_gG: 1.35,
    k_gQ: 1.5,
    k_gb: 1.1,
    k_gs: 1.1,
    k_gst: 1.15,
    k_psi2: 0.3,
    cr_b_b: 0.7,
    cr_b_s: 0.7,
    cr_f_b: 0.5,
    cr_f_s: 0.7,
    cr_car: 0.9,
    cr_qp: 1.1,
    cr_car_t: 1.1,
    cr_qp_t: 1.5,
  },
  layers: [
    { soil: 'argile', th: 4, pl: 0.6, em: 6, qc: 1.5, c: 15, phi: 22, gamma: 18 },
    { soil: 'sable', th: 5, pl: 1.4, em: 14, qc: 8, c: 0, phi: 32, gamma: 19 },
    { soil: 'argile', th: 3, pl: 1.0, em: 10, qc: 3, c: 30, phi: 24, gamma: 19 },
    { soil: 'marne', th: 8, pl: 3.2, em: 45, qc: 15, c: 60, phi: 28, gamma: 21 },
  ],
  cpt: { step: 0.2, pts: [] },
  beton: { arm: 'arme', k3: '1.0', b_fck: 25 },
  projet: 'Projet exemple — Dakar',
  pieu: 'P1',
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
      sub: 'user_cgf',
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
// panneau Résultats (#res-content) — ce que `renderResults` met sous les yeux de
// l'opérateur (identique dans le HTML client et le clone, seule la SOURCE des nombres
// diffère : science locale côté réf, sortie serveur côté clone).
// --------------------------------------------------------------------------
interface Kpi {
  lab: string; // libellé (R_b — pointe, R_s — frottement, R_c;d — calcul ELU, Tassement)
  val: string; // valeur + unité (ex. « 1,31 MN »)
  sub: string; // sous-texte (qbDetail, « sur 15,0 m de fût », « après γ_b… », « Frank & Zhao »)
}
interface Verif {
  nom: string; // état-limite (ELU portance — DA2, ELS caractéristique, ELS quasi-permanent)
  comb: string; // libellé de combinaison EC7 (sous-span) — RENDU côté clone (ouverture B1), comparé en (a)
  Fd: string; // sollicitation pondérée
  Rd: string; // résistance de calcul
  taux: string; // Fd/Rd (%)
  ok: string; // ✓ / ✗
}
interface UiModel {
  verdict: string; // « Portance vérifiée » / « … NON vérifiée »
  verdictSub: string; // « Taux … % · pieu … · approche DA … »
  kpis: Kpi[];
  tables: string[][][]; // toutes les table.res : [table][ligne][cellule] (Résistances/Vérif/Frottement/Synthèse/Béton)
  verifs: Verif[]; // vue structurée de la table Vérifications (nom/comb séparés)
  hints: string[]; // encarts .hint (ξ₃/ξ₄, charges G/Q, E_M couche porteuse)
  hasSettle: boolean; // courbe charge-tassement (#settle-svg avec <path>) présente
  tabs: string[]; // onglets de navigation (nav.tabs button[data-tab])
  resLen: number; // longueur du innerHTML de #res-content (garde non-vide)
}

function extractModel(): UiModel {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const rc = document.getElementById('res-content');
  const verdict = norm(rc?.querySelector('.verdict .txt b')?.textContent);
  const verdictSub = norm(rc?.querySelector('.verdict .txt div')?.textContent);
  const kpis: Kpi[] = Array.from(rc?.querySelectorAll('.kpi-grid .kpi') ?? []).map(
    (k) => ({
      lab: norm(k.querySelector('.lab')?.textContent),
      val: norm(k.querySelector('.val')?.textContent),
      sub: norm(k.querySelector('.sub')?.textContent),
    }),
  );
  const tableEls = Array.from(rc?.querySelectorAll('table.res') ?? []);
  const tables: string[][][] = tableEls.map((t) =>
    Array.from(t.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) => norm(c.textContent)),
    ),
  );
  // Table Vérifications = 2e table.res : on sépare le libellé d'état-limite (nom) du
  // sous-span de combinaison EC7 (comb) pour pouvoir classer ce dernier séparément.
  const verifTbl = tableEls[1];
  const verifs: Verif[] = verifTbl
    ? Array.from(verifTbl.querySelectorAll('tr'))
        .slice(1) // saute l'en-tête
        .map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td'));
          const lbl = cells[0];
          const span = lbl?.querySelector('span');
          const comb = norm(span?.textContent);
          const full = norm(lbl?.textContent);
          // nom = texte du libellé MOINS le sous-span de combinaison.
          const nom = comb ? norm(full.replace(comb, '')) : full;
          return {
            nom,
            comb,
            Fd: norm(cells[1]?.textContent),
            Rd: norm(cells[2]?.textContent),
            taux: norm(cells[3]?.textContent),
            ok: norm(cells[4]?.textContent),
          };
        })
    : [];
  const hints = Array.from(rc?.querySelectorAll('.hint') ?? []).map((h) =>
    norm(h.textContent),
  );
  const hasSettle = !!rc?.querySelector('#settle-svg path');
  const tabs = Array.from(document.querySelectorAll('nav.tabs button[data-tab]')).map(
    (b) => norm(b.textContent),
  );

  return {
    verdict,
    verdictSub,
    kpis,
    tables,
    verifs,
    hints,
    hasSettle,
    tabs,
    resLen: (rc?.innerHTML ?? '').length,
  };
}

// --------------------------------------------------------------------------
// Normalisation & comparaison numérique (Node) — patron fidelite-terzaghi/pressiopro.
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
    const rv = rn[i] ?? Number.NaN;
    const ov = on[i] ?? Number.NaN;
    const e = relErr(rv, ov);
    // TOLERANCE SERREE (finding m1) : la référence et le clone rendent le MÊME nombre
    // avec le MÊME renderer (`fmt`, décimales fr-FR) à partir de sciences ÉQUIVALENTES
    // (module↔origine, prouvé par les unitaires du paquet) : les chaînes affichées sont
    // byte-identiques. On vise donc l'égalité (tol résiduelle 1e-9 pour absorber un
    // éventuel bruit de sérialisation), pas un écart de 5e-3 qui masquerait une
    // régression de calcul (un comparateur laxiste = faux-vert, DoD §9).
    if (e > 1e-9)
      return {
        ok: false,
        why: `valeur[${i}] réf=${rv} nous=${ov} rel=${e.toExponential(2)}`,
      };
  }
  return { ok: true, why: '' };
}

// --------------------------------------------------------------------------
// Sortie serveur (a) via moteur SOURCE en sous-processus (cache par body — le clone
// poste une fois par calcul de portance ; le cache évite de relancer tsx à l'identique).
// --------------------------------------------------------------------------
const _engineCache = new Map<string, unknown>();
function serverOutputForBody(bodyJson: string): unknown {
  const cached = _engineCache.get(bodyJson);
  if (cached !== undefined) return cached;
  const raw = execFileSync('npx', ['tsx', 'scripts/casagrande-engine-run.mts'], {
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
// (b) RÉFÉRENCE — file://, « Remplir la fiche fictivement » + « Calculer la portance ».
// --------------------------------------------------------------------------
async function loadReferenceModel(page: Page): Promise<UiModel> {
  page.on('pageerror', () => {
    /* icônes/CDN absents en file:// — sans effet sur le moteur/DOM */
  });
  page.on('dialog', (d) => void d.accept());
  await page.goto(pathToFileURL(REF_HTML).href, { waitUntil: 'domcontentloaded' });
  // Deux boutons « Remplir la fiche fictivement » (bandeau + onglet sol) : le 1er suffit.
  await page
    .locator('button', { hasText: /Remplir la fiche fictivement/ })
    .first()
    .click();
  await page.locator('button', { hasText: /Calculer la portance/ }).click();
  // compute() (science locale, synchrone) rend #res-content avec la grille de KPIs.
  await page.waitForFunction(
    () => document.querySelectorAll('#res-content .kpi-grid .kpi').length > 0,
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
        // gate évalué sur ENGINE_ID='pieux' (cf. page casagrande) → doit y figurer.
        modules: ['pieux', 'casagrande', 'fondation-profonde-pieux'],
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
          id: 'proj_cgf',
          orgId: ORG_ID,
          name: 'E2E fidélité casagrande',
          domain: 'FD', // la page casagrande filtre matchesDomain(p,'FD')
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_cgf',
        },
      ]),
    }),
  );
  // LE CŒUR : la requête de calcul est interceptée et fulfillée avec la sortie du
  // MOTEUR SOURCE sur le body RÉELLEMENT posté par le clone (buildPieuxInput), sous
  // la forme BackendPersistedCalcResult attendue par httpRunCalc/ToolFrame. Le clone
  // casagrande n'émet PAS de dryRun ; on reste néanmoins défensif (?dryRun=true → pas
  // de calcResultId, non compté) par parité avec le patron pressiopro.
  let calcSeq = 0;
  await page.route(/\/projects\/[^/]+\/calc\/pieux/, async (route: Route) => {
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
        calcResultId: isDry ? undefined : `cr_cgf_${++calcSeq}`,
        ok: true,
        meta: { engineId: 'pieux', engineVersion: 'e2e-fidelite' },
        output,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/casagrande`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  // Le projet (unique projet FD) doit être AUTO-sélectionné avant tout calcul :
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
  if (!frame) throw new Error('frame du clone casagrande introuvable');
  return frame;
}

// ==========================================================================
// SUITE 1 — RÉFÉRENCE (catalogue + garde-fou non-vide)
// ==========================================================================
test.describe('FIDÉLITÉ CASAGRANDE — référence client (file://)', () => {
  test('given le HTML client, when « Remplir » + « Calculer la portance », then l’UI de référence est catalogable et NON vide', async ({
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
      path: path.join(CAP_DIR, 'casagrande-client-resultats.png'),
      fullPage: true,
    });
    dumpJson('casagrande-fidelite-reference.json', REF);

    // Zéro faux-vert : la référence DOIT produire un vrai dépouillement.
    expect(REF.verdict, 'la réf doit rendre un verdict de portance').toMatch(/Portance/);
    expect(REF.kpis.length, 'la réf doit rendre les 4 KPIs de portance').toBe(4);
    expect(
      REF.tables.length,
      'la réf doit rendre les 5 tables (Résistances/Vérif/Frottement/Synthèse/Béton)',
    ).toBe(5);
    expect(REF.verifs.length, 'la réf doit rendre les vérifications ELU/ELS').toBe(3);
    expect(REF.hints.length, 'la réf doit rendre les encarts (ξ₃/ξ₄, charges, E_M)').toBe(
      3,
    );
    expect(REF.hasSettle, 'la réf doit rendre la courbe charge-tassement').toBe(true);
    expect(REF.tabs, 'onglets de navigation réf').toEqual([
      '01Projet & pieu',
      '02Frottement négatif',
      '03Profil de sol',
      '04Coefficients',
      '05Résultats & vérifs',
    ]);
    await ctx.close();
  });
});

// ==========================================================================
// SUITE 2 — CLONE + COMPARAISON (classification fermée, assertions dures)
// ==========================================================================
test.describe('FIDÉLITÉ CASAGRANDE — clone (iframe) ↔ référence', () => {
  test('given le même cas, when calcul serveur intercepté, then affichage/structure du clone FIDÈLES à la réf (classification fermée)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);

    // Modèle de référence (autonome — ne dépend pas de l'ordre des suites).
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const REF = await loadReferenceModel(await refCtx.newPage());
    expect(REF.kpis.length, 'réf sans KPIs (extraction cassée)').toBe(4);
    expect(REF.tables.length, 'réf sans tables (extraction cassée)').toBe(5);
    await refCtx.close();

    // (a) sortie serveur du cas exemple — prouve que engine-run marche + dump.
    const serverOutput = serverOutputForBody(JSON.stringify(EXAMPLE_INPUT));
    dumpJson('casagrande-fidelite-server-output.json', serverOutput);

    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();

    const { calcReal } = await openOurClone(page, token);

    // Le clone doit être chargé et prêt.
    const frame = cloneFrame(page);
    await frame
      .locator('button', { hasText: /Remplir la fiche fictivement/ })
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });

    // (c) même cas via « Remplir la fiche fictivement » → « Calculer la portance → ».
    // Pas de course : le clone ne planifie NI aperçu débouncé NI calcul de boot (init()
    // démarre à vide, aucun listener ne déclenche compute) — un seul calc:request est
    // émis, au clic sur « Calculer la portance → » (goTab('res') → compute()).
    await frame
      .locator('button', { hasText: /Remplir la fiche fictivement/ })
      .first()
      .click();
    await frame.locator('button', { hasText: /Calculer la portance/ }).click();

    // Le panneau Résultats se peuple (grille de KPIs de portance).
    await frame
      .locator('#res-content .kpi-grid .kpi')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    // Attendre la fin d'un éventuel placeholder « Calcul en cours… ».
    await expect
      .poll(
        async () =>
          (await frame.locator('#res-content').innerHTML()).includes('Calcul en cours'),
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
      path: path.join(CAP_DIR, 'casagrande-nous-resultats.png'),
      fullPage: true,
    });
    dumpJson('casagrande-fidelite-clone.json', OURS);

    // ---- Recheck EXCISION : le HTML servi ne contient aucun symbole moteur excisé ----
    const servedHtml = await page.evaluate(async (orgId: string) => {
      const res = await fetch(
        `/api/tools/casagrande?orgId=${encodeURIComponent(orgId)}`,
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
    expect(servedHtml, 'HTML servi ≠ clone casagrande (bridge absent)').toContain(
      '__geofamBridge',
    );
    // Symboles de SCIENCE NF P 94-262 (présents dans casagrande_V5.html, JAMAIS dans le
    // clone) + marqueur confidentiel des modules @roadsen/engines. On teste la forme
    // APPEL/DÉFINITION `sym(` (pas la sous-chaîne nue) pour éviter tout faux positif.
    // NB : `compute`/`computeDowndrag` sont les orchestrateurs UI du clone (ils appellent
    // le pont) — LÉGITIMEMENT présents des deux côtés, donc EXCLUS de cette liste ; la
    // science qu'ils invoquaient (portanceCore/settlement/betonCheck/computeQce/…) est,
    // elle, entièrement excisée. `__ROADSEN_ENGINE_` couvre computeDowndrag côté moteur.
    const EXCISED_MARKERS = [
      'portanceCore',
      'portanceCaps',
      'settlement',
      'betonCheck',
      'computeQce',
      'xiFactors',
      'qsCPT',
      'kpMax',
      'kcMax',
      'alphaPMT',
      'alphaCPT',
    ];
    const leaksCalls = EXCISED_MARKERS.filter((m) =>
      new RegExp(`(?<![\\w.$])${m}\\s*\\(`).test(servedHtml),
    );
    expect(
      leaksCalls,
      `symboles moteur EXCISÉS présents (forme appel/déf) dans le HTML servi : ${leaksCalls.join(', ')}`,
    ).toHaveLength(0);
    // Marqueur confidentiel des modules @roadsen/engines — jamais servi au navigateur.
    for (const marker of [
      '__ROADSEN_ENGINE_',
      '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__',
    ]) {
      expect(
        servedHtml.includes(marker),
        `marqueur confidentiel « ${marker} » présent dans le HTML servi`,
      ).toBe(false);
    }

    // ==================================================================
    // CLASSIFICATION FERMÉE
    // ==================================================================
    const uncovered: string[] = []; // ligne réf non classée / label désaligné
    const omitted: string[] = []; // ligne réf sans équivalent côté clone (longueur)
    const valueMismatch: string[] = []; // mappée mais valeur/texte divergent
    const sec8Residual: string[] = []; // (b) §8 fail-closed — VIDE pour casagrande
    const absentClosed: string[] = []; // (c) absences DOCUMENTÉES — VIDE depuis l'ouverture B1 (comb + E_M rendus)

    // Précondition d'INTÉGRATION : le clone doit AVOIR rendu un dépouillement.
    const integrationOk = OURS.kpis.length > 0 && OURS.tables.length > 0;

    // -- (a) Verdict + sous-titre --
    {
      const cv = displayEqual(REF.verdict, OURS.verdict);
      if (!cv.ok) valueMismatch.push(`verdict : ${cv.why}`);
      const cs = displayEqual(REF.verdictSub, OURS.verdictSub);
      if (!cs.ok) valueMismatch.push(`verdict (sous-titre) : ${cs.why}`);
    }

    // -- (a) KPIs (comparaison par INDICE : renderResults rend le MÊME ordre des 2 côtés) --
    if (REF.kpis.length !== OURS.kpis.length) {
      omitted.push(`#KPIs réf=${REF.kpis.length} ≠ clone=${OURS.kpis.length}`);
    } else {
      for (let i = 0; i < REF.kpis.length; i++) {
        const r = REF.kpis[i]!;
        const o = OURS.kpis[i]!;
        if (keyOf(r.lab) !== keyOf(o.lab))
          uncovered.push(`KPI[${i}] libellé réf « ${r.lab} » ≠ clone « ${o.lab} »`);
        const cv = displayEqual(r.val, o.val);
        if (!cv.ok) valueMismatch.push(`KPI « ${r.lab} » valeur : ${cv.why}`);
        const cs = displayEqual(r.sub, o.sub);
        if (!cs.ok) valueMismatch.push(`KPI « ${r.lab} » sous-texte : ${cs.why}`);
      }
    }

    // -- (a) Tables générales (Résistances[0], Frottement[2], Synthèse[3], Béton[4]) --
    // La table Vérifications (index 1) est traitée à part (colonne comb, cf. (c)).
    if (REF.tables.length !== OURS.tables.length) {
      omitted.push(`#tables réf=${REF.tables.length} ≠ clone=${OURS.tables.length}`);
    } else {
      for (let ti = 0; ti < REF.tables.length; ti++) {
        if (ti === 1) continue; // Vérifications → bloc dédié ci-dessous
        const rt = REF.tables[ti]!;
        const ot = OURS.tables[ti]!;
        if (rt.length !== ot.length) {
          omitted.push(`table[${ti}] #lignes réf=${rt.length} ≠ clone=${ot.length}`);
          continue;
        }
        for (let ri = 0; ri < rt.length; ri++) {
          const rr = rt[ri]!;
          const orow = ot[ri]!;
          if (rr.length !== orow.length) {
            valueMismatch.push(
              `table[${ti}] ligne[${ri}] #colonnes ${rr.length} ≠ ${orow.length}`,
            );
            continue;
          }
          for (let ci = 0; ci < rr.length; ci++) {
            const c = displayEqual(rr[ci] ?? '', orow[ci] ?? '');
            if (!c.ok) valueMismatch.push(`table[${ti}] [${ri}][${ci}] : ${c.why}`);
          }
        }
      }
    }

    // -- (a) Vérifications (nom/Fd/Rd/taux/ok strict ; comb rendu, comparé en (a) — B1) --
    if (REF.verifs.length !== OURS.verifs.length) {
      omitted.push(
        `#vérifications réf=${REF.verifs.length} ≠ clone=${OURS.verifs.length}`,
      );
    } else {
      for (let i = 0; i < REF.verifs.length; i++) {
        const r = REF.verifs[i]!;
        const o = OURS.verifs[i]!;
        if (keyOf(r.nom) !== keyOf(o.nom))
          uncovered.push(`vérif[${i}] état-limite réf « ${r.nom} » ≠ clone « ${o.nom} »`);
        for (const col of ['Fd', 'Rd', 'taux', 'ok'] as const) {
          const c = displayEqual(r[col], o[col]);
          if (!c.ok) valueMismatch.push(`vérif « ${r.nom} » ${col} : ${c.why}`);
        }
        // comb : OUVERTURE B1 — le contrat pieux transporte DÉSORMAIS le libellé de
        // combinaison EC7 (`verifications[].comb`, nomenclature normative publique) et
        // mapPieuxOutput le rend sous chaque vérification. La VALEUR est donc comparée
        // en (a), à l'identique de la référence : toute divergence = valueMismatch
        // (échec dur). Plus AUCUNE absence documentée pour comb.
        const cComb = displayEqual(r.comb, o.comb);
        if (!cComb.ok)
          valueMismatch.push(`vérif « ${r.nom} » combinaison : ${cComb.why}`);
      }
    }

    // -- (a) Encarts hint : ξ₃/ξ₄, charges ET E_M couche porteuse (rendu — B1) STRICTS --
    if (REF.hints.length !== OURS.hints.length) {
      omitted.push(`#encarts hint réf=${REF.hints.length} ≠ clone=${OURS.hints.length}`);
    } else {
      const EM_RE = /EM couche porteuse\s*=\s*[^·]*?\s*MPa/i;
      for (let i = 0; i < REF.hints.length; i++) {
        const rh = REF.hints[i]!;
        const oh = OURS.hints[i]!;
        if (EM_RE.test(rh)) {
          // Encart tassement : OUVERTURE B1 — le contrat pieux transporte DÉSORMAIS le
          // module E_M de la couche porteuse (`EMbaseLayer`, écho de la saisie utilisateur)
          // et le clone le rend. On compare EXPLICITEMENT la VALEUR E_M (réf↔clone) ET le
          // reste de l'encart, tout deux en (a) : toute divergence = valueMismatch (échec
          // dur). Plus AUCUNE absence documentée pour E_M.
          const refEmM = rh.match(EM_RE)?.[0] ?? '';
          const ourEmM = oh.match(EM_RE)?.[0] ?? '';
          const refRest = rh.replace(EM_RE, '⟦EM⟧');
          const ourRest = oh.replace(EM_RE, '⟦EM⟧');
          const cRest = displayEqual(refRest, ourRest);
          if (!cRest.ok) valueMismatch.push(`encart tassement (hors E_M) : ${cRest.why}`);
          const cEm = displayEqual(refEmM, ourEmM);
          if (!cEm.ok) valueMismatch.push(`encart tassement (E_M) : ${cEm.why}`);
        } else {
          const c = displayEqual(rh, oh);
          if (!c.ok) valueMismatch.push(`encart hint[${i}] : ${c.why}`);
        }
      }
    }

    // -- Structure (onglets, courbe) : fidélité par construction. --
    expect(OURS.tabs, 'onglets de navigation clone ≠ réf').toEqual(REF.tabs);
    expect(OURS.hasSettle, 'la courbe charge-tassement du clone doit être présente').toBe(
      true,
    );

    const summary = {
      integrationOk,
      verdictRef: REF.verdict,
      verdictNous: OURS.verdict,
      refKpis: REF.kpis.length,
      ourKpis: OURS.kpis.length,
      refTables: REF.tables.map((t) => t.length),
      ourTables: OURS.tables.map((t) => t.length),
      refVerifs: REF.verifs.length,
      ourVerifs: OURS.verifs.length,
      classes: { uncovered, omitted, valueMismatch, sec8Residual, absentClosed },
    };
    dumpJson('casagrande-fidelite-classification.json', summary);
    // eslint-disable-next-line no-console
    console.log('\n[FIDÉLITÉ CASAGRANDE]\n' + JSON.stringify(summary, null, 2));

    // ==================================================================
    // ASSERTIONS DURES (zéro faux-vert)
    // ==================================================================
    expect(
      integrationOk,
      `INTÉGRATION : le clone n'a rendu AUCUN dépouillement alors que la réf a ${REF.kpis.length} KPIs / ` +
        `${REF.tables.length} tables. Cause probable : la sortie serveur BRUTE (Rb/Rs/RcD/verifications/` +
        `fric/courbeTassement) n'atteint pas l'iframe (mapPieuxOutput lit ces champs) — vérifier ` +
        `httpRunCalc/adaptPersistedCalcResult (whitelist BRUTE).`,
    ).toBe(true);
    // ZÉRO ÉCART (ADR 0014) : après l'ouverture B1 (comb EC7 + E_M couche porteuse
    // désormais transportés et rendus), le clone n'affiche PLUS RIEN de moins que
    // l'outil client. La liste des absences documentées doit donc être VIDE — toute
    // entrée résiduelle = régression de fidélité (comb/E_M non rendus) à investiguer.
    expect(
      absentClosed.length,
      `absences documentées résiduelles (attendu : AUCUNE — zéro écart) :\n${absentClosed.join('\n')}`,
    ).toBe(0);
    expect(sec8Residual, '(b) §8 résiduel — VIDE attendu pour casagrande').toHaveLength(
      0,
    );
    expect(uncovered, 'lignes réf NON classées (labels désalignés)').toHaveLength(0);
    expect(omitted, 'lignes réf OMISES côté clone (longueurs)').toHaveLength(0);
    expect(valueMismatch, 'VALEURS divergentes clone↔réf').toHaveLength(0);

    await ctx.close();
  });
});
