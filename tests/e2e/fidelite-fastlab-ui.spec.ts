/**
 * FIDÉLITÉ D'INTERFACE FASTLAB — HTML client (référence gelée) ↔ NOTRE clone
 * (essais de laboratoire & classification GTR, NF P 11-300 ; « clone UI client »,
 * ADR 0015).
 * ==========================================================================
 *
 * OBJECTIF : PROUVER l'équivalence d'AFFICHAGE/FONCTIONNEMENT entre l'outil FASTLAB
 * du client (`FASTLAB7.html`, gelé) et notre logiciel web — qui, depuis ADR 0015,
 * N'EST PLUS une reconstruction React mais le CLONE fidèle de l'UI client (calcul
 * EXCISÉ), chargé en `<iframe srcdoc sandbox>` via `ToolFrame`, dont le calcul part
 * côté SERVEUR (DoD §8).
 *
 * FASTLAB est le moteur le PLUS RICHE : ~20 essais dans un seul écran à onglets, et
 * un POST de calcul BATCHÉ (un seul appel `/calc/labo` portant l'ÉTAT COMPLET du
 * formulaire `readForm()`). Contrairement à terzaghi (sortie figée) ou pressiopro
 * (input construit), le clone poste l'état du formulaire et le serveur renvoie TOUTES
 * les valeurs dérivées (`output.detail.*` par essai + agrégats `D.*` + `classe` GTR).
 *
 * DISPOSITIF (patron IDENTIQUE aux pilotes terzaghi/pressiopro — les 4 volets exigés) :
 *   (a) SORTIE SERVEUR du cas de référence — l'état « Exemple fictif » de `loadDemo()`
 *       (limon argileux → GTR « A2 h ») exécuté par le MOTEUR SOURCE `runLabo` en
 *       sous-processus (`scripts/fastlab-engine-run.mts`) : c'est numériquement la
 *       sortie qu'un serveur renverrait (équivalence module↔origine prouvée par les
 *       unitaires du paquet labo). On charge la SOURCE via tsx (jamais le moteur dans
 *       le bundle du spec/navigateur, §8).
 *   (b) RÉFÉRENCE (LECTURE seule) — `FASTLAB7.html` en file://, « 🧪 Exemple fictif »
 *       cliqué → calcul LOCAL (elle a encore ses kernels : calcW/calcGranulo/calcAtt/
 *       classify…) → extraction DOM (verdict GTR + chemin de décision, table de
 *       synthèse #recap, panneaux de résultats par essai, onglets).
 *   (c) NOTRE app en LOCAL, MODE RÉEL (port 3106), clone en iframe : même cas via
 *       « 🧪 Exemple fictif » ; la requête de calcul (`POST .../calc/labo`) est
 *       INTERCEPTÉE par page.route et fulfillée avec la sortie du MOTEUR SOURCE sur le
 *       body RÉELLEMENT posté par le clone (`readForm()` sérialisé, engineId `labo`).
 *       Extraction du MÊME jeu d'éléments dans le frame.
 *   (d) CLASSIFICATION FERMÉE par élément : (a) mappé = valeurs identiques (tol rel
 *       5e-3, décimales fr-FR), (b) §8 fail-closed = liste fermée (VIDE pour fastlab :
 *       le résultat de labo + la classe GTR sont le LIVRABLE public — NF P 11-300 —
 *       aucun masquage ; cf. contrat labo §8-public), (c) absent = essais NON déclenchés
 *       par l'exemple (liste fermée DOCUMENTÉE). Toute ligne non classée = ÉCHEC.
 *       Assertions dures finales : uncovered/omitted/valueMismatch vides.
 *
 * PÉRIMÈTRE DE COMPARAISON STRICTE : ce que le cas « Exemple fictif » RENSEIGNE
 * réellement (essais déclenchés au sens de la carte de complétude `updateDots` du HTML)
 * — teneur en eau, granulométrie, Atterberg, VBS, Proctor, cisaillement, œdomètre —
 * PLUS le verdict GTR, la table de synthèse #recap (34 lignes, TOUS les agrégats, y
 * compris « — » pour les essais non renseignés) et les onglets. Les panneaux d'essais
 * NON déclenchés par l'exemple sont EXTRAITS et DOCUMENTÉS en (c) absentClosed (ils
 * n'entrent pas dans la comparaison stricte : ils affichent des pré-remplissages/valeurs
 * dérivées par défaut hors du geste opérateur). La table #recap couvre néanmoins la
 * valeur d'agrégat de CHAQUE essai — c'est le contrôle numérique exhaustif.
 *
 * ZÉRO FAUX-VERT : réf absente → ÉCHEC dur ; « 0 élément » extrait d'un côté → ÉCHEC
 * dur ; calc non intercepté → ÉCHEC dur ; le stub backend REFUSE le calcul (405) pour
 * garantir que la sortie comparée vient bien de l'interception, jamais du stub.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE + AFFICHAGE, PAS la justesse
 * scientifique (responsabilité STARFIRE — split contractuel ; l'équivalence
 * module↔origine est prouvée par les unitaires du paquet labo).
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
const SECRET = 'fidelite-fastlab-e2e-secret-32bytes-min-xxxxxx'; // = webServer.env.JWT_SECRET
const ORG_SLUG = 'etude-fid-fastlab';
const ORG_ID = 'org_flf';
const REF_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/FASTLAB7.html',
);
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/fastlab.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAP_DIR = path.join(OUT_DIR, 'captures');

/**
 * Panneaux d'essais DÉCLENCHÉS par le cas « Exemple fictif » (champ primaire renseigné
 * au sens de la carte `updateDots` du HTML : w→w_s1, gran→gr_M, att→ll_s1, vbs→v_V1,
 * proctor→pr_mh1, cisail→ci_N1, oedo→oe_H0). Comparaison STRICTE (chips, par indice).
 * `out_ll` + `out_att` proviennent tous deux de l'essai Atterberg (deux encarts).
 */
const FILLED_PANELS = [
  'out_w',
  'out_gran',
  'out_ll',
  'out_att',
  'out_vbs',
  'out_proctor',
  'out_cisail',
  'out_oedo',
] as const;

/**
 * Panneaux d'essais NON déclenchés par l'exemple (champ primaire vide). EXTRAITS et
 * DOCUMENTÉS en (c) absentClosed — hors comparaison stricte : la référence y affiche
 * des pré-remplissages/valeurs dérivées par défaut (ex. « ρd du CBR » dérivé du Proctor,
 * « ρL utilisée » par défaut) qui ne relèvent pas d'un geste opérateur sur ces essais.
 */
const OTHER_PANELS = [
  'out_rhos',
  'out_dens',
  'out_cbr',
  'out_ucs',
  'out_triuu',
  'out_tricu',
  'out_perm',
  'out_es',
  'out_la',
  'out_sz',
  'out_mde',
  'out_mdecamp',
  'out_rho',
  'out_sulf',
] as const;

/**
 * Cas de validation — état « Exemple fictif » (`DEMO`) tel que le clone le POSTE après
 * `loadDemo()` → `writeForm(DEMO)` : DEMO + défauts de toggle sérialisés par `readForm`
 * + défauts `DEF`/`applyLaVar`/`setMould` + `cfg` (seuils GTR par défaut). NB : c'est une
 * APPROXIMATION fidèle destinée au dump (a) et à la preuve que l'engine-run tourne ; la
 * comparaison (c) N'utilise PAS cette constante mais le body RÉELLEMENT posté par le
 * clone (`route.request().postData()`), donc toute dérive de défaut y est neutralisée.
 * Vérifié : `runLabo(EXAMPLE_INPUT)` → classe GTR « A2 h » (conforme à la DEMO du HTML).
 */
const EXAMPLE_INPUT: Record<string, unknown> = {
  forcedState: '',
  permMode: 'const',
  laVar: 'std',
  mdeVar: 'std',
  mdeWet: 'h',
  mdeMode: 'norme',
  prType: 'n',
  rsMethod: 'A',
  cbType: 'cbr',
  ciMethod: 'box',
  densMethod: 'lin',
  densShape: 'prism',
  m_ref: 'SC2 — 1,20 m',
  m_chantier: 'Aménagement RN1 — Lot 3',
  m_client: 'DGTP / SAPCO',
  m_dossier: '2026-014',
  m_pk: 'PK 12+300',
  m_prof: '1,20 m',
  m_date: '2026-03-10',
  m_dessai: '2026-03-18',
  m_op: 'A. Diop',
  m_ing: 'M. NDIAYE',
  m_labo: 'GEOTEST LABO',
  m_nature: 'Limon argileux brun',
  m_obs: 'Exemple fictif de démonstration — données simulées.',
  w_t1: '20.00',
  w_h1: '138.00',
  w_s1: '120.00',
  w_t2: '21.50',
  w_h2: '149.50',
  w_s2: '130.00',
  w_t3: '19.80',
  w_h3: '126.60',
  w_s3: '110.30',
  gr_M: '1000',
  gr_20: '5',
  gr_16: '15',
  gr_10: '30',
  gr_8: '25',
  gr_6_3: '30',
  gr_5: '35',
  gr_4: '40',
  gr_2: '90',
  gr_1: '80',
  gr_0_5: '60',
  gr_0_2: '40',
  gr_0_08: '30',
  ll_x1: '15',
  ll_t1: '15.00',
  ll_h1: '29.05',
  ll_s1: '25.00',
  ll_x2: '22',
  ll_t2: '15.00',
  ll_h2: '28.88',
  ll_s2: '25.00',
  ll_x3: '28',
  ll_t3: '15.00',
  ll_h3: '28.72',
  ll_s3: '25.00',
  ll_x4: '33',
  ll_t4: '15.00',
  ll_h4: '28.60',
  ll_s4: '25.00',
  pl_t1: '15.00',
  pl_h1: '21.00',
  pl_s1: '20.00',
  pl_t2: '14.50',
  pl_h2: '20.14',
  pl_s2: '19.20',
  v_conc: '10',
  v_prise1: '30',
  v_frac1: '100',
  v_w1: '4.0',
  v_V1: '101',
  v_prise2: '30',
  v_frac2: '100',
  v_w2: '4.0',
  v_V2: '101',
  pr_mould: 'A',
  pr_d: '10.16',
  pr_hh: '11.64',
  pr_mh1: '1836.6',
  pr_t1: '18.0',
  pr_h1: '74.0',
  pr_s1: '68.0',
  pr_mh2: '1944.8',
  pr_t2: '18.0',
  pr_h2: '75.0',
  pr_s2: '68.0',
  pr_mh3: '2022.6',
  pr_t3: '18.0',
  pr_h3: '76.0',
  pr_s3: '68.0',
  pr_mh4: '2024.1',
  pr_t4: '18.0',
  pr_h4: '77.0',
  pr_s4: '68.0',
  pr_mh5: '1990.6',
  pr_t5: '18.0',
  pr_h5: '78.0',
  pr_s5: '68.0',
  ci_shape: 'sq',
  ci_dim: '60',
  ci_N1: '0.36',
  ci_P1: '0.197',
  ci_N2: '0.72',
  ci_P2: '0.365',
  ci_N3: '1.08',
  ci_P3: '0.533',
  ci_N4: '1.44',
  ci_P4: '0.700',
  ci_rs: '2.65',
  ci_rho1: '1950',
  ci_w1: '18.5',
  ci_nat1: 'Limon argileux brun',
  ci_rho2: '1965',
  ci_w2: '18.0',
  ci_nat2: 'Limon argileux brun',
  ci_rho3: '1940',
  ci_w3: '18.8',
  ci_nat3: 'Limon argileux brun',
  ci_rho4: '1970',
  ci_w4: '17.6',
  ci_nat4: 'Limon argileux brun',
  oe_H0: '20.0',
  oe_D: '70.0',
  oe_md: '119.3',
  oe_rs: '2.70',
  oe_s1: '10',
  oe_dh1: '0.05',
  oe_s2: '20',
  oe_dh2: '0.12',
  oe_s3: '40',
  oe_dh3: '0.24',
  oe_s4: '80',
  oe_dh4: '0.45',
  oe_s5: '160',
  oe_dh5: '0.78',
  oe_s6: '320',
  oe_dh6: '1.18',
  oe_s7: '640',
  oe_dh7: '1.60',
  oe_s8: '160',
  oe_dh8: '1.52',
  oe_s9: '40',
  oe_dh9: '1.40',
  // Défauts prégarnis par writeForm/applyLaVar (sérialisés par readForm → postés) :
  la_M: '5000',
  la_nb: '11',
  la_ti: '12.5',
  rs_T: '20',
  ra_rw: '0.998',
  cb_s25: '13.35',
  cb_s5: '20',
  cb_cible: '95',
  cb_K: '1',
  su_f: '0.343',
  di_rfl: '0.998',
  di_rp: '0.9',
  dd_rfl: '0.998',
  dd_rp: '0.9',
  cfg: {
    routeD: true,
    A_fines: 35,
    A_ip: [12, 25, 40],
    A_vbs: [2.5, 6, 8],
    B_p2: 70,
    B_fines: 12,
    B_vbs01: 0.1,
    B_vbs56: 1.5,
    C_dmax: 50,
    D_fines: 12,
    D_vbs: 0.1,
    st: [0.7, 0.9, 1.1, 1.3],
    FR: 7,
    DG: 5,
  },
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
      sub: 'user_flf',
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
// verdict GTR (#result), la table de synthèse (#recap), les panneaux d'essais (out_*)
// et la navigation (#side a) — ce que l'outil met sous les yeux de l'opérateur.
// --------------------------------------------------------------------------
interface Chip {
  k: string; // libellé de la puce (.chip .k)
  v: string; // valeur + unité (.chip .v, unité en <small>)
}
interface UiModel {
  classFull: string; // .classbadge (code + état, ex. « A2 h »)
  classHeading: string; // .desc h3 (« Famille A — A2 »)
  classDesc: string; // .desc p
  classEtat: string; // .desc .sub (« État hydrique : h »)
  pathSteps: string[]; // .pathbox ol li (chemin de décision GTR)
  caveats: string; // .alert.warn (« Points à vérifier ») — texte normalisé
  rNote: string; // .alert.info (assistant famille R) — texte normalisé (vide si absent)
  recapRows: string[][]; // #recap tr : [Paramètre, Valeur]
  panels: Record<string, Chip[]>; // out_* : puces par essai
  navTabs: string[]; // #side a (onglets)
  resultLen: number; // longueur innerHTML de #result (garde non-vide)
}

/**
 * Extraction DOM — fonction PURE et SÉRIALISABLE (aucune closure : `page.evaluate`
 * sérialise le corps de la fonction et l'exécute dans le navigateur, où le scope Node
 * n'existe pas). La liste des panneaux à lire est passée en ARGUMENT (`panelIds`),
 * jamais capturée par fermeture.
 */
function extractModel(panelIds: string[]): UiModel {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const rc = document.getElementById('result');
  const q = (sel: string) => norm(rc?.querySelector(sel)?.textContent);
  const pathSteps = Array.from(rc?.querySelectorAll('.pathbox ol li') ?? []).map((l) =>
    norm(l.textContent),
  );
  const caveats = norm(rc?.querySelector('.alert.warn')?.textContent);
  const rNote = norm(rc?.querySelector('.alert.info')?.textContent);
  const recapRows: string[][] = Array.from(document.querySelectorAll('#recap tr')).map(
    (tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => norm(c.textContent)),
  );
  const navTabs = Array.from(document.querySelectorAll('#side a')).map((a) =>
    norm(a.textContent),
  );
  const chipsOf = (id: string): Chip[] =>
    Array.from(document.getElementById(id)?.querySelectorAll('.chip') ?? []).map((c) => ({
      k: norm(c.querySelector('.k')?.textContent),
      v: norm(c.querySelector('.v')?.textContent),
    }));
  const panels: Record<string, Chip[]> = {};
  for (const id of panelIds) panels[id] = chipsOf(id);
  return {
    classFull: q('.classbadge'),
    classHeading: q('.desc h3'),
    classDesc: q('.desc p'),
    classEtat: q('.desc .sub'),
    pathSteps,
    caveats,
    rNote,
    recapRows,
    panels,
    navTabs,
    resultLen: (rc?.innerHTML ?? '').length,
  };
}

/** Liste (Node) des panneaux à extraire, passée à `evaluate` comme argument sérialisable. */
const ALL_PANELS: string[] = [...FILLED_PANELS, ...OTHER_PANELS];

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
// peut reposter le MÊME body sur un ré-appui/recalcul de la même profondeur).
// --------------------------------------------------------------------------
const _engineCache = new Map<string, unknown>();
function serverOutputForBody(bodyJson: string): unknown {
  const cached = _engineCache.get(bodyJson);
  if (cached !== undefined) return cached;
  const raw = execFileSync('npx', ['tsx', 'scripts/fastlab-engine-run.mts'], {
    input: bodyJson,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
  expect(parsed.ok, `moteur serveur (a) a échoué : ${raw.slice(0, 400)}`).toBe(true);
  expect(parsed.output, 'sortie serveur (a) vide').toBeTruthy();
  _engineCache.set(bodyJson, parsed.output);
  return parsed.output;
}

// --------------------------------------------------------------------------
// (b) RÉFÉRENCE — file://, clic « 🧪 Exemple fictif », extraction verdict + synthèse.
// --------------------------------------------------------------------------
async function loadReferenceModel(page: Page): Promise<UiModel> {
  page.on('pageerror', () => {
    /* Chart.js/icônes CDN absents en file:// — sans effet sur les kernels/DOM */
  });
  page.on('dialog', (d) => void d.accept());
  await page.goto(pathToFileURL(REF_HTML).href, { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: /Exemple fictif/ }).click();
  // loadDemo → writeForm(DEMO) → recalc() SYNCHRONE (kernels locaux) → verdict rendu.
  await page.waitForFunction(
    () => {
      const r = document.getElementById('result');
      return !!r && /classbadge/.test(r.innerHTML);
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('#recap tr').length > 1,
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(extractModel, ALL_PANELS);
}

// --------------------------------------------------------------------------
// (c) NOTRE app — connexion forgée, iframe clone, interception du calcul batché.
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

  await page.route(/\/me\/entitlements/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orgId: ORG_ID,
        pack: 'COMPLETE',
        modules: ['fastlab', 'labo', 'labo-classification-gtr'],
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
          id: 'proj_flf',
          orgId: ORG_ID,
          name: 'E2E fidélité fastlab',
          domain: 'LB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_flf',
        },
      ]),
    }),
  );
  // LE CŒUR : la requête de calcul BATCHÉE est interceptée et fulfillée avec la sortie
  // du MOTEUR SOURCE sur le body RÉELLEMENT posté par le clone (`readForm()` sérialisé
  // à la racine, cf. httpRunCalc → body:JSON.stringify(req.params)). BODY-DRIVEN : on
  // exécute le moteur sur CE body (cache par body). engineId = 'labo'. Le clone FASTLAB
  // ne pose PAS de dryRun (bridge.calc sans flag) mais on distingue défensivement
  // ?dryRun=true (parité httpRunCalc : pas de calcResultId en aperçu).
  let calcSeq = 0;
  await page.route(/\/projects\/[^/]+\/calc\/labo/, async (route: Route) => {
    const isDry = route.request().url().includes('dryRun=true');
    const bodyJson = route.request().postData() ?? '{}';
    let output: unknown;
    try {
      output = serverOutputForBody(bodyJson);
    } catch (e) {
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
        calcResultId: isDry ? undefined : `cr_flf_${++calcSeq}`,
        ok: true,
        meta: { engineId: 'labo', engineVersion: 'e2e-fidelite' },
        output,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/fastlab`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  // Le projet (unique projet LB) doit être AUTO-sélectionné avant tout calcul : tant
  // qu'il ne l'est pas, l'indice « Sélectionnez un projet » bloque le calcul dans
  // ToolFrame. Attendre sa disparition garantit que la requête atteindra la route.
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
  if (!frame) throw new Error('frame du clone fastlab introuvable');
  return frame;
}

// ==========================================================================
// SUITE 1 — RÉFÉRENCE (catalogue + garde-fou non-vide)
// ==========================================================================
test.describe('FIDÉLITÉ FASTLAB — référence client (file://)', () => {
  test('given le HTML client, when « 🧪 Exemple fictif » + calcul local, then l’UI de référence est catalogable et NON vide', async ({
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
      path: path.join(CAP_DIR, 'fastlab-client-resultats.png'),
      fullPage: true,
    });
    dumpJson('fastlab-fidelite-reference.json', REF);

    // Zéro faux-vert : la référence DOIT produire un vrai dépouillement A2 h.
    expect(
      REF.classFull.length,
      'la réf doit rendre la classe GTR (badge)',
    ).toBeGreaterThan(0);
    expect(REF.classFull, 'classe GTR de la DEMO du HTML').toBe('A2 h');
    expect(REF.classHeading, 'entête famille/code').toBe('Famille A — A2');
    expect(
      REF.pathSteps.length,
      'la réf doit rendre le chemin de décision GTR',
    ).toBeGreaterThan(0);
    // La table de synthèse #recap = en-tête + 33 lignes d'agrégats (34 lignes).
    expect(REF.recapRows.length, 'table de synthèse #recap').toBe(34);
    // Les panneaux d'essais déclenchés par l'exemple doivent être renseignés.
    for (const id of FILLED_PANELS) {
      expect(REF.panels[id]?.length ?? 0, `panneau ${id} vide côté réf`).toBeGreaterThan(
        0,
      );
    }
    expect(REF.navTabs, 'onglets de navigation réf').toEqual([
      'Identification',
      'Teneur en eau',
      'Granulométrie',
      'Atterberg',
      'Bleu (VBS)',
      'Masse vol. grains',
      'Masse vol. apparente',
      'Proctor',
      'CBR / IPI',
      'Cisaillement direct',
      'Œdomètre',
      'Compression simple',
      'Triaxial UU',
      'Triaxial CU/CD',
      'Perméabilité',
      'Équivalent de sable',
      'Los Angeles',
      'Fragmentation SZ',
      'Micro-Deval',
      'Masse vol. & absorption',
      'Sulfates',
      '★ Classification GTR',
      'Seuils',
      'Enregistrés',
    ]);
    await ctx.close();
  });
});

// ==========================================================================
// SUITE 2 — CLONE + COMPARAISON (classification fermée, assertions dures)
// ==========================================================================
test.describe('FIDÉLITÉ FASTLAB — clone (iframe) ↔ référence', () => {
  test('given le même cas, when calcul serveur batché intercepté, then affichage/structure du clone FIDÈLES à la réf (classification fermée)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);

    // Modèle de référence (autonome — ne dépend pas de l'ordre des suites).
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const REF = await loadReferenceModel(await refCtx.newPage());
    expect(REF.classFull, 'réf sans classe GTR (extraction cassée)').toBe('A2 h');
    expect(REF.recapRows.length, 'réf sans table de synthèse').toBe(34);
    await refCtx.close();

    // (a) sortie serveur du cas exemple — prouve que engine-run marche + dump.
    const serverOutput = serverOutputForBody(JSON.stringify(EXAMPLE_INPUT));
    dumpJson('fastlab-fidelite-server-output.json', serverOutput);

    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();

    const { calcReal } = await openOurClone(page, token);

    // Le clone doit être chargé et prêt (bouton « Exemple fictif » visible dans le frame).
    const frame = cloneFrame(page);
    await frame
      .getByRole('button', { name: /Exemple fictif/ })
      .waitFor({ state: 'visible', timeout: 15_000 });

    // (c) même cas via « 🧪 Exemple fictif » → loadDemo → writeForm → recalc (débounce
    // 320 ms) → POST batché /calc/labo → renderAll. On attend que le verdict soit rendu
    // (#result .classbadge) ET que la synthèse soit peuplée (#recap > 1 ligne).
    await frame.getByRole('button', { name: /Exemple fictif/ }).click();
    await frame
      .locator('#result .classbadge')
      .first()
      .waitFor({ state: 'visible', timeout: 25_000 });
    await expect
      .poll(async () => frame.locator('#recap tr').count(), { timeout: 25_000 })
      .toBeGreaterThan(1);
    // Fin d'un éventuel placeholder d'erreur/attente : le verdict est bien un vrai code.
    await expect
      .poll(
        async () => (await frame.locator('#result').innerHTML()).includes('classbadge'),
        {
          timeout: 25_000,
        },
      )
      .toBe(true);
    await page.waitForTimeout(500);

    expect(
      calcReal(),
      'la requête de calcul batchée DOIT avoir été interceptée (sinon comparaison invalide)',
    ).toBeGreaterThan(0);

    const OURS = await frame.evaluate(extractModel, ALL_PANELS);
    await page.screenshot({
      path: path.join(CAP_DIR, 'fastlab-nous-resultats.png'),
      fullPage: true,
    });
    dumpJson('fastlab-fidelite-clone.json', OURS);

    // ---- Recheck EXCISION : le HTML servi ne contient aucun symbole moteur excisé ----
    const servedHtml = await page.evaluate(async (orgId: string) => {
      const res = await fetch(`/api/tools/fastlab?orgId=${encodeURIComponent(orgId)}`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('roadsen_access_token')}`,
        },
      });
      return res.text();
    }, ORG_ID);
    expect(servedHtml.length, 'HTML servi trop court (fetch échoué ?)').toBeGreaterThan(
      10_000,
    );
    expect(servedHtml, 'HTML servi ≠ clone fastlab (bridge absent)').toContain(
      '__geofamBridge',
    );
    // Kernels de labo du HTML de RÉFÉRENCE (présents dans FASTLAB7.html, JAMAIS dans le
    // clone) + marqueur confidentiel des modules @roadsen/engines. NB : on cible
    // « function classify » (la CHAÎNE « classify » nue subsiste dans un COMMENTAIRE
    // légitime du bridge — le kernel, lui, est bien excisé).
    const EXCISED_MARKERS = [
      'calcGranulo',
      'calcW',
      'calcAtt',
      'calcVbs',
      'calcProctor',
      'calcCbr',
      'calcOedo',
      'function classify',
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
    const sec8Residual: string[] = []; // (b) §8 fail-closed — VIDE (labo = livrable public)
    const absentClosed: string[] = []; // (c) essais NON déclenchés par l'exemple — documentés

    // Précondition d'INTÉGRATION : le clone doit AVOIR rendu un verdict + une synthèse.
    const integrationOk = OURS.classFull.length > 0 && OURS.recapRows.length > 1;

    // -- (a) Verdict GTR (badge, entête, description, état hydrique, chemin de décision) --
    {
      const cf = displayEqual(REF.classFull, OURS.classFull);
      if (!cf.ok) valueMismatch.push(`classe GTR (badge) : ${cf.why}`);
      if (keyOf(REF.classHeading) !== keyOf(OURS.classHeading))
        valueMismatch.push(
          `entête famille/code réf « ${REF.classHeading} » ≠ clone « ${OURS.classHeading} »`,
        );
      const cd = displayEqual(REF.classDesc, OURS.classDesc);
      if (!cd.ok) valueMismatch.push(`description GTR : ${cd.why}`);
      const ce = displayEqual(REF.classEtat, OURS.classEtat);
      if (!ce.ok) valueMismatch.push(`état hydrique : ${ce.why}`);
    }
    // Chemin de décision GTR (client-safe — livrable NF P 11-300 ; par INDICE).
    if (REF.pathSteps.length !== OURS.pathSteps.length) {
      omitted.push(
        `#étapes chemin GTR réf=${REF.pathSteps.length} ≠ clone=${OURS.pathSteps.length}`,
      );
    } else {
      for (let i = 0; i < REF.pathSteps.length; i++) {
        const c = displayEqual(REF.pathSteps[i] ?? '', OURS.pathSteps[i] ?? '');
        if (!c.ok) valueMismatch.push(`chemin GTR [${i}] : ${c.why}`);
      }
    }
    // Encarts « Points à vérifier » (caveats) + « Assistant famille R » (rNote).
    {
      const cc = displayEqual(REF.caveats, OURS.caveats);
      if (!cc.ok) valueMismatch.push(`points à vérifier (caveats) : ${cc.why}`);
      const cr = displayEqual(REF.rNote, OURS.rNote);
      if (!cr.ok) valueMismatch.push(`assistant famille R (rNote) : ${cr.why}`);
    }

    // -- (a) Table de synthèse #recap (par INDICE, cellule à cellule) : TOUS les agrégats,
    //        y compris « — » pour les essais non renseignés → contrôle numérique exhaustif. --
    if (REF.recapRows.length !== OURS.recapRows.length) {
      omitted.push(
        `#lignes #recap réf=${REF.recapRows.length} ≠ clone=${OURS.recapRows.length}`,
      );
    } else {
      for (let i = 0; i < REF.recapRows.length; i++) {
        const r = REF.recapRows[i]!;
        const o = OURS.recapRows[i]!;
        if (r.length !== o.length) {
          valueMismatch.push(`#recap ligne[${i}] : #colonnes ${r.length} ≠ ${o.length}`);
          continue;
        }
        if (keyOf(r[0] ?? '') !== keyOf(o[0] ?? ''))
          uncovered.push(`#recap[${i}] label réf « ${r[0]} » ≠ clone « ${o[0]} »`);
        const c = displayEqual(r[1] ?? '', o[1] ?? '');
        if (!c.ok) valueMismatch.push(`#recap « ${r[0]} » valeur : ${c.why}`);
      }
    }

    // -- (a) Panneaux d'essais DÉCLENCHÉS par l'exemple (comparaison STRICTE, par INDICE) --
    for (const id of FILLED_PANELS) {
      const rp = REF.panels[id] ?? [];
      const op = OURS.panels[id] ?? [];
      if (rp.length !== op.length) {
        omitted.push(`#puces ${id} réf=${rp.length} ≠ clone=${op.length}`);
        continue;
      }
      for (let i = 0; i < rp.length; i++) {
        const r = rp[i]!;
        const o = op[i]!;
        if (keyOf(r.k) !== keyOf(o.k))
          uncovered.push(`${id}[${i}] label réf « ${r.k} » ≠ clone « ${o.k} »`);
        const cv = displayEqual(r.v, o.v);
        if (!cv.ok) valueMismatch.push(`${id} « ${r.k} » : ${cv.why}`);
      }
    }

    // -- (c) Panneaux d'essais NON déclenchés par l'exemple (pré-remplissages/valeurs par
    //        défaut). Finding M2 (revue adverse) : sous « zéro écart » on ne DOCUMENTE plus
    //        sans contrainte — on EXIGE l'égalité d'affichage réf↔clone puce-à-puce (le clone
    //        rend les mêmes défauts que l'outil client). Toute divergence (longueur, label ou
    //        valeur) part en `valueMismatch` → ÉCHEC DUR (bucket rendu CONTRAIGNANT). L'agrégat
    //        numérique de chaque essai reste par ailleurs couvert par #recap. --
    for (const id of OTHER_PANELS) {
      const rp = REF.panels[id] ?? [];
      const op = OURS.panels[id] ?? [];
      let diverged = false;
      if (rp.length !== op.length) {
        valueMismatch.push(
          `${id} (non déclenché) : #puces réf=${rp.length} ≠ clone=${op.length}`,
        );
        diverged = true;
      } else {
        for (let i = 0; i < rp.length; i++) {
          const r = rp[i]!;
          const o = op[i]!;
          if (keyOf(r.k) !== keyOf(o.k)) {
            valueMismatch.push(
              `${id}[${i}] (non déclenché) label réf « ${r.k} » ≠ clone « ${o.k} »`,
            );
            diverged = true;
          }
          const cv = displayEqual(r.v, o.v);
          if (!cv.ok) {
            valueMismatch.push(`${id} « ${r.k} » (non déclenché) : ${cv.why}`);
            diverged = true;
          }
        }
      }
      absentClosed.push(
        `${id} (essai non déclenché par l'exemple) — réf ${rp.length} puce(s), clone ${op.length} puce(s), ${diverged ? 'DIVERGENT' : 'identique (vérifié)'}`,
      );
    }

    // -- Structure (onglets) : fidélité par construction. --
    expect(OURS.navTabs, 'onglets de navigation clone ≠ réf').toEqual(REF.navTabs);

    const summary = {
      integrationOk,
      classRef: REF.classFull,
      classNous: OURS.classFull,
      refRecapRows: REF.recapRows.length,
      ourRecapRows: OURS.recapRows.length,
      refPathSteps: REF.pathSteps.length,
      ourPathSteps: OURS.pathSteps.length,
      filledPanels: FILLED_PANELS.map((id) => ({
        id,
        ref: REF.panels[id]?.length ?? 0,
        clone: OURS.panels[id]?.length ?? 0,
      })),
      classes: { uncovered, omitted, valueMismatch, sec8Residual, absentClosed },
    };
    dumpJson('fastlab-fidelite-classification.json', summary);
    // eslint-disable-next-line no-console
    console.log('\n[FIDÉLITÉ FASTLAB]\n' + JSON.stringify(summary, null, 2));

    // ==================================================================
    // ASSERTIONS DURES (zéro faux-vert)
    // ==================================================================
    expect(
      integrationOk,
      `INTÉGRATION : le clone n'a rendu AUCUN verdict/synthèse alors que la réf en a. ` +
        `Cause probable : la sortie serveur BRUTE (output.classe/detail/agrégats) n'atteint pas ` +
        `l'iframe (renderAll lit ces champs) — vérifier httpRunCalc/adaptPersistedCalcResult (whitelist BRUTE).`,
    ).toBe(true);
    expect(uncovered, 'lignes réf NON classées (labels désalignés)').toHaveLength(0);
    expect(omitted, 'lignes réf OMISES côté clone (longueurs)').toHaveLength(0);
    expect(valueMismatch, 'VALEURS divergentes clone↔réf').toHaveLength(0);

    await ctx.close();
  });
});
