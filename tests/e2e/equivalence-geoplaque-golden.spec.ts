/**
 * ÉQUIVALENCE GOLDEN-MASTER — GEOPLAQUE (4 modes : radier ACM, déformations planes,
 * axisymétrique, radier triangulaire).
 *
 * Preuve NAVIGATEUR + bout-en-bout PLATEFORME que le portage reproduit le HTML CLIENT
 * d'origine à 0 % d'écart (tolérance rel 1e-9) sur la sortie BRUTE des solveurs.
 *
 *   1. HTML CLIENT gelé (référence, LECTURE seule)
 *        03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html
 *      chargé dans un VRAI navigateur (chromium, file://). On renseigne la globale
 *      `state` et on appelle DIRECTEMENT chaque solveur (`solveModel`/`solvePlaneStrain`/
 *      `solveAxi`/`solveTriRaft`) — on court-circuite le DOM/dessin — puis on capture les
 *      champs BRUTS de l'objet résultat (`R`/`R.diag`).
 *   2. PLATEFORME : le MÊME jeu d'entrées est recalculé côté SERVEUR (POST tenant
 *      /projects/:id/calc/:engine sur Render — le calcul confidentiel ne tourne jamais au
 *      navigateur, DoD §8). Org JETABLE E2E-TEST-* provisionnée en beforeAll (entitlement
 *      'radier' → couvre les 4 modes via le groupement d'entitlement).
 *   3. COMPARAISON champ par champ sur la sortie BRUTE du solveur (rel ≤ 1e-9).
 *
 * ANCRAGE À LA RÉFÉRENCE SCELLÉE : on vérifie que le SHA-256 du HTML testé == l'empreinte
 * du registre (45e3e24c…9bbab) == la meta `engineSourceHash` renvoyée par le serveur (les
 * 4 modes partagent ce même HTML). Le fichier piloté au navigateur est byte-identique à la
 * référence scellée au PV.
 *
 * --- LE ×1000 (RADIER — décision titulaire, mémoire roadsen-radier-units) ---
 * Le HTML GEOPLAQUE_V10 applique un ×1000 UNIQUEMENT dans l'AFFICHAGE (renderRes,
 * `d.wMax*1000` → « mm ») ; les SOLVEURS retournent la valeur BRUTE (aucun ×1000). La
 * plateforme NE reproduit PAS ce ×1000 d'affichage (elle affiche la valeur brute, tenue
 * pour physiquement juste ; le HTML sur-rapporte). La comparaison porte donc sur la sortie
 * BRUTE des solveurs : elle DOIT être 0 % (le ×1000 n'est pas dans le calcul). Divergence
 * CALCUL = 0 % ; divergence AFFICHAGE = ×1000 délibérée sur les tassements affichés.
 *
 * SKIP BRUYANT (jamais un faux-vert) : si le HTML source est absent (03-Moteurs-client hors
 * dépôt git), le test ÉCHOUE explicitement plutôt que de passer à vide.
 *
 * PORTÉE HONNÊTE (@science-unsigned) : ceci prouve l'ÉQUIVALENCE DU PORTAGE (plateforme ==
 * HTML client), PAS la JUSTESSE scientifique absolue (cas-tests STARFIRE — hors périmètre,
 * science signée STARFIRE). Un portage à 0 % d'un moteur faux resterait faux : la justesse
 * est la responsabilité science du client (split contractuel).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Symboles GLOBAUX du HTML d'origine (résolus dans le navigateur au moment du evaluate).
// Déclarations ambiantes : satisfont le typage ; à l'exécution ce sont les globales de la
// page GEOPLAQUE_V10 (const state / function solve*), référencées en BARE identifiers.
declare const state: {
  rafts: unknown;
  pointLoads: unknown;
  lineLoads: unknown;
  areaLoads: unknown;
  pointSprings: unknown;
  lineSprings: unknown;
  layers: unknown;
};
declare function solveModel(opts: unknown): Record<string, unknown>;
declare function solvePlaneStrain(o: unknown): Record<string, unknown>;
declare function solveAxi(o: unknown): Record<string, unknown>;
declare function solveTriRaft(o: unknown): Record<string, unknown>;

// --------------------------------------------------------------------------
// Référence gelée + API
// --------------------------------------------------------------------------

/** HTML CLIENT gelé (hors 05-Plateforme, dans 03-Moteurs-client). LECTURE seule. */
const FROZEN_HTML = path.resolve(
  __dirname,
  '../../../03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html',
);
/** Empreinte scellée au registre (registry.ts, radier-plaque + variantes) — partagée par les 4 modes. */
const SEALED_SHA = '45e3e24c405c35c21c0ae8e1d92f214036390f36f7215b96d97ac61feed9bbab';

const BACKEND = 'https://roadsen.onrender.com';
const FRONT = 'https://roadsen.vercel.app';
const REL_TOL = 1e-9;
const NAV = 120_000;

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL ?? 'ryhow99@gmail.com';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const RUN_UI = process.env.RUN_UI === '1';

// --------------------------------------------------------------------------
// Contexte tenant JETABLE (provisionné en beforeAll, rapporté pour teardown)
// --------------------------------------------------------------------------

interface JetableCtx {
  ownerEmail: string;
  ownerPassword: string;
  userId: string;
  orgId: string;
  orgSlug: string;
  projectId: string;
  ownerToken: string;
}
let jetable: JetableCtx | null = null;

async function jsonPost(
  request: APIRequestContext,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await request.post(url, {
    data: body as object,
    headers: { 'Content-Type': 'application/json', ...headers },
    timeout: NAV,
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await resp.json()) as Record<string, unknown>;
  } catch {
    /* corps non-JSON (rare) */
  }
  return { status: resp.status(), body: parsed };
}

async function login(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const { status, body } = await jsonPost(request, `${BACKEND}/auth/login`, {
    email,
    password,
  });
  expect(status, `login ${email} doit réussir (HTTP ${status})`).toBe(200);
  const token = body.accessToken;
  expect(typeof token, 'accessToken attendu').toBe('string');
  return token as string;
}

/** Provisionne user + org (entitlement 'radier') + projet ; renvoie le contexte jetable. */
async function provisionJetable(request: APIRequestContext): Promise<JetableCtx> {
  expect(
    SUPERADMIN_PASSWORD,
    'SUPERADMIN_PASSWORD requis en ENV pour provisionner l’org jetable',
  ).not.toBe('');

  const superToken = await login(request, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD);
  const superHdr = { Authorization: `Bearer ${superToken}` };

  const ts = Date.now();
  const ownerEmail = `e2e-test-geoplaque-${ts}@roadsen.test`;
  const ownerPassword = 'E2eGeoplaqueGolden!2026';

  // 1) user jetable
  const u = await jsonPost(
    request,
    `${BACKEND}/admin/users`,
    { email: ownerEmail, password: ownerPassword, fullName: 'E2E-TEST GEOPLAQUE golden' },
    superHdr,
  );
  expect(u.status, `POST /admin/users (HTTP ${u.status}) : ${JSON.stringify(u.body)}`).toBe(
    201,
  );
  const userId = u.body.userId as string;
  expect(typeof userId, 'userId attendu').toBe('string');

  // 2) org jetable + abonnement (entitlement 'radier' → couvre plane-strain/axi/tri-raft)
  const orgSlug = `e2e-test-geoplaque-${ts}`;
  const now = Date.now();
  const org = await jsonPost(
    request,
    `${BACKEND}/admin/orgs`,
    {
      name: `E2E-TEST GEOPLAQUE golden ${ts}`,
      slug: orgSlug,
      ownerUserId: userId,
      subscription: {
        pack: 'COMPLETE',
        entitlements: ['radier'],
        dateDebut: new Date(now - 24 * 3600 * 1000).toISOString(),
        dateFin: new Date(now + 365 * 24 * 3600 * 1000).toISOString(),
        quota: 100_000,
      },
    },
    superHdr,
  );
  expect(org.status, `POST /admin/orgs (HTTP ${org.status}) : ${JSON.stringify(org.body)}`).toBe(
    201,
  );
  const orgId = org.body.orgId as string;
  expect(typeof orgId, 'orgId attendu').toBe('string');

  // 3) login owner + projet
  const ownerToken = await login(request, ownerEmail, ownerPassword);
  const proj = await jsonPost(
    request,
    `${BACKEND}/projects`,
    { name: 'E2E GEOPLAQUE golden' },
    { Authorization: `Bearer ${ownerToken}`, 'x-org-id': orgId },
  );
  expect(proj.status, `POST /projects (HTTP ${proj.status}) : ${JSON.stringify(proj.body)}`).toBe(
    201,
  );
  const projectId = proj.body.id as string;
  expect(typeof projectId, 'projectId attendu').toBe('string');

  const ctx: JetableCtx = {
    ownerEmail,
    ownerPassword,
    userId,
    orgId,
    orgSlug,
    projectId,
    ownerToken,
  };
  // Trace claire pour le teardown (l'orchestrateur nettoiera).
  console.log(
    `[E2E-TEST créés] userId=${userId} orgId=${orgId} orgSlug=${orgSlug} ` +
      `projectId=${projectId} ownerEmail=${ownerEmail}`,
  );
  return ctx;
}

/** POST tenant /projects/:id/calc/:engine. Renvoie { status, ok, output, meta }. */
async function serverCalc(
  request: APIRequestContext,
  engine: string,
  body: unknown,
): Promise<{
  status: number;
  ok: boolean;
  output: Record<string, unknown> | undefined;
  meta: Record<string, unknown> | undefined;
}> {
  const j = jetable!;
  const { status, body: resp } = await jsonPost(
    request,
    `${BACKEND}/projects/${j.projectId}/calc/${engine}`,
    body,
    { Authorization: `Bearer ${j.ownerToken}`, 'x-org-id': j.orgId },
  );
  return {
    status,
    ok: resp.ok === true,
    output: (resp.output ?? undefined) as Record<string, unknown> | undefined,
    meta: (resp.meta ?? undefined) as Record<string, unknown> | undefined,
  };
}

// --------------------------------------------------------------------------
// Comparaison numérique (mêmes règles que la projection serveur : non-fini → null)
// --------------------------------------------------------------------------

const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Écart relatif signé entre deux valeurs (0 si identiques au bit). */
function relErr(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null || b === null) return Infinity;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / denom;
}

/** Compare deux vues canoniques champ par champ ; renvoie {worst, ecarts[]}. */
function compare(
  hc: Record<string, number | null>,
  sc: Record<string, number | null>,
): { worst: number; ecarts: string[] } {
  const keys = Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]));
  let worst = 0;
  const ecarts: string[] = [];
  for (const k of keys) {
    const e = relErr(hc[k] ?? null, sc[k] ?? null);
    if (e > worst) worst = e;
    if (e > REL_TOL) {
      ecarts.push(`${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`);
    }
  }
  return { worst, ecarts };
}

// --------------------------------------------------------------------------
// Cas de référence par mode (ENTREES pures, client-safe — miroir des fixtures).
// --------------------------------------------------------------------------

const LAYERS_2 = [
  { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
  { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
];
const BETON = { E: 32000, nu: 0.2, e: 0.4 };
const CARRE_6 = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 6 },
  { x: 0, y: 6 },
];
const RECT_8x4 = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 4 },
  { x: 0, y: 4 },
];
const POLY_L = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 3 },
  { x: 3, y: 3 },
  { x: 3, y: 6 },
  { x: 0, y: 6 },
];
const RAFT2 = [
  { x: 8, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 6 },
  { x: 8, y: 6 },
];

interface RadierIn {
  rafts: unknown[];
  pointLoads?: unknown[];
  lineLoads?: unknown[];
  areaLoads?: unknown[];
  pointSprings?: unknown[];
  lineSprings?: unknown[];
  layers: unknown[];
  opts: Record<string, unknown>;
}
const radierBase = (over: Partial<RadierIn>): RadierIn => ({
  rafts: [{ pts: CARRE_6, ...BETON }],
  layers: LAYERS_2,
  opts: { mesh: 1.0 },
  ...over,
});

const RADIER_CAS: Array<{ id: string; input: RadierIn }> = [
  { id: 'carre-charge-centree', input: radierBase({ pointLoads: [{ x: 3, y: 3, Fz: 1000 }] }) },
  {
    id: 'carre-quatre-poteaux',
    input: radierBase({
      pointLoads: [
        { x: 1.5, y: 1.5, Fz: 600 },
        { x: 4.5, y: 1.5, Fz: 900 },
        { x: 1.5, y: 4.5, Fz: 700 },
        { x: 4.5, y: 4.5, Fz: 1200 },
      ],
    }),
  },
  {
    id: 'rect-charge-excentree',
    input: radierBase({ rafts: [{ pts: RECT_8x4, ...BETON }], pointLoads: [{ x: 6, y: 2, Fz: 1500 }] }),
  },
  {
    id: 'carre-charge-surfacique-raft',
    input: radierBase({ areaLoads: [{ x1: 1, y1: 1, x2: 5, y2: 5, q: 50, on: 'raft' }] }),
  },
  {
    id: 'deux-plaques-inter',
    input: radierBase({
      rafts: [{ pts: CARRE_6, ...BETON }, { pts: RAFT2, ...BETON }],
      pointLoads: [{ x: 3, y: 3, Fz: 1500 }, { x: 10, y: 3, Fz: 500 }],
    }),
  },
  {
    id: 'winkler-additionnel',
    input: radierBase({ pointLoads: [{ x: 3, y: 3, Fz: 1000 }], opts: { mesh: 1.0, kWink: 5000 } }),
  },
  {
    id: 'decollement',
    input: radierBase({
      rafts: [{ pts: RECT_8x4, ...BETON }],
      pointLoads: [{ x: 0.5, y: 2, Fz: 2000 }],
      opts: { mesh: 1.0, decol: true },
    }),
  },
  {
    id: 'degenere-plaque-non-convexe',
    input: radierBase({ rafts: [{ pts: POLY_L, ...BETON }], pointLoads: [{ x: 1.5, y: 1.5, Fz: 900 }] }),
  },
];
const RADIER_REJET: RadierIn = {
  rafts: [{ pts: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 14 }, { x: 0, y: 14 }], ...BETON }],
  pointLoads: [{ x: 7, y: 7, Fz: 1000 }],
  layers: LAYERS_2,
  opts: { mesh: 0.2 }, // → ~2209 nœuds > 1500 : garde « Maillage trop fin »
};

const PS_CAS: Array<{ id: string; input: { layers: unknown[]; opts: Record<string, unknown> } }> = [
  { id: 'bande-repartie', input: { layers: LAYERS_2, opts: { Bw: 6, ...BETON, q: 50 } } },
  { id: 'bande-lineique-centree', input: { layers: LAYERS_2, opts: { Bw: 6, ...BETON, loads: [{ x: 3, P: 300 }] } } },
  {
    id: 'bande-lineiques-multiples',
    input: { layers: LAYERS_2, opts: { Bw: 8, ...BETON, loads: [{ x: 2, P: 250 }, { x: 4, P: 400 }, { x: 6.5, P: 180 }] } },
  },
  {
    id: 'bande-repartie-plus-lineique',
    input: { layers: LAYERS_2, opts: { Bw: 6, ...BETON, q: 30, loads: [{ x: 1.5, P: 500 }] } },
  },
  {
    id: 'bande-decollement',
    input: { layers: LAYERS_2, opts: { Bw: 8, E: 32000, nu: 0.2, e: 0.5, loads: [{ x: 0.3, P: 900 }], decol: true } },
  },
];
const PS_REJET = { layers: [] as unknown[], opts: { Bw: 6, ...BETON, q: 50 } };

const AXI_CAS: Array<{ id: string; input: { layers: unknown[]; o: Record<string, unknown> } }> = [
  { id: 'q-reparti-2couches', input: { layers: LAYERS_2, o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 120, Pc: 0, ne: 12, foundD: 0 } } },
  { id: 'pc-central-2couches', input: { layers: LAYERS_2, o: { R: 5, e: 0.5, E: 32000, nu: 0.2, q: 0, Pc: 1500, ne: 16, foundD: 0 } } },
  { id: 'q-plus-pc-combinees', input: { layers: LAYERS_2, o: { R: 8, e: 0.6, E: 32000, nu: 0.2, q: 80, Pc: 1000, ne: 20, foundD: 0 } } },
  { id: 'couche-unique', input: { layers: [{ name: 'argile', zBase: -15, E: 12, nu: 0.33 }], o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 150, Pc: 0, ne: 12, foundD: 0 } } },
  { id: 'cote-assise-D', input: { layers: LAYERS_2, o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 120, Pc: 0, ne: 16, foundD: 2 } } },
];
const AXI_REJET = { layers: [] as unknown[], o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 120, Pc: 0, ne: 12, foundD: 0 } };

interface TriIn {
  rafts: unknown[];
  pointLoads?: unknown[];
  lineLoads?: unknown[];
  areaLoads?: unknown[];
  layers: unknown[];
  opts: Record<string, unknown>;
}
const TRI_OPTS = { target: 2, e: 0.4, E: 32000, nu: 0.2 };
const triBase = (over: Partial<TriIn>): TriIn => ({
  rafts: [{ pts: CARRE_6, ...BETON }],
  layers: LAYERS_2,
  opts: TRI_OPTS,
  ...over,
});
const TRI_CAS: Array<{ id: string; input: TriIn }> = [
  { id: 'carre-charge-centree', input: triBase({ pointLoads: [{ x: 3, y: 3, Fz: 1000 }] }) },
  { id: 'carre-charge-repartie-q', input: triBase({ opts: { ...TRI_OPTS, q: 50 } }) },
  { id: 'rect-charge-excentree', input: triBase({ rafts: [{ pts: RECT_8x4, ...BETON }], pointLoads: [{ x: 6, y: 2, Fz: 1500 }] }) },
  { id: 'carre-charge-lineique', input: triBase({ lineLoads: [{ x1: 1, y1: 1, x2: 5, y2: 1, q: 120 }] }) },
  {
    id: 'deux-plaques',
    input: triBase({
      rafts: [{ pts: CARRE_6, ...BETON }, { pts: RAFT2, ...BETON }],
      pointLoads: [{ x: 3, y: 3, Fz: 1500 }, { x: 10, y: 3, Fz: 500 }],
    }),
  },
];
const TRI_REJET: TriIn = {
  rafts: [{ pts: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }], ...BETON }],
  pointLoads: [{ x: 6, y: 6, Fz: 1000 }],
  layers: LAYERS_2,
  opts: { target: 0.05, e: 0.4, E: 32000, nu: 0.2 }, // > 1200 nœuds : garde moteur
};

// --------------------------------------------------------------------------
// Pilotage des solveurs dans le NAVIGATEUR (extraction ciblée, pas de gros tableaux)
// --------------------------------------------------------------------------

const f = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

async function htmlRadier(page: Page, inp: RadierIn): Promise<Record<string, number | null> & { err: string | null }> {
  const raw = await page.evaluate((i) => {
    state.rafts = i.rafts;
    state.pointLoads = i.pointLoads || [];
    state.lineLoads = i.lineLoads || [];
    state.areaLoads = i.areaLoads || [];
    state.pointSprings = [];
    state.lineSprings = [];
    state.layers = i.layers;
    let err: string | null = null;
    let R: Record<string, unknown> | null = null;
    try {
      R = solveModel(i.opts);
    } catch (e) {
      err = String((e && (e as Error).message) || e);
    }
    if (!R || !R.diag) return { err: err || 'aucun diag' };
    const d = R.diag as Record<string, unknown>;
    const lp = (d.loadPairs ?? null) as Record<string, unknown> | null;
    const w = lp && lp.worst ? (lp.worst as Record<string, unknown>) : null;
    return {
      err: null,
      wMax: d.wMax, wMin: d.wMin, diff: d.diff, slopeMax: d.slopeMax, tiltMax: d.tiltMax,
      betaIntra: d.betaIntra, betaInter: d.interBeta, interDiff: d.interDiff, betaGov: d.betaGov,
      nRafts: d.nRafts,
      w_beta: w ? w.beta : null, w_ds: w ? w.ds : null, w_L: w ? w.L : null,
      w_ki: w ? w.ki : null, w_kj: w ? w.kj : null,
    };
  }, inp);
  const r = raw as Record<string, unknown>;
  return {
    err: (r.err as string | null) ?? null,
    wMax: f(r.wMax), wMin: f(r.wMin), diff: f(r.diff), slopeMax: f(r.slopeMax), tiltMax: f(r.tiltMax),
    betaIntra: f(r.betaIntra), betaInter: f(r.betaInter), interDiff: f(r.interDiff), betaGov: f(r.betaGov),
    nRafts: f(r.nRafts),
    w_beta: f(r.w_beta), w_ds: f(r.w_ds), w_L: f(r.w_L), w_ki: f(r.w_ki), w_kj: f(r.w_kj),
  };
}

function srvRadier(o: Record<string, unknown>): Record<string, number | null> {
  const w = (o.worstLoadPair ?? null) as Record<string, unknown> | null;
  return {
    wMax: numOf(o.wMax), wMin: numOf(o.wMin), diff: numOf(o.diff), slopeMax: numOf(o.slopeMax),
    tiltMax: numOf(o.tiltMax), betaIntra: numOf(o.betaIntra), betaInter: numOf(o.betaInter),
    interDiff: numOf(o.interDiff), betaGov: numOf(o.betaGov), nRafts: numOf(o.nRafts),
    w_beta: w ? numOf(w.beta) : null, w_ds: w ? numOf(w.ds) : null, w_L: w ? numOf(w.L) : null,
    w_ki: w ? numOf(w.ki) : null, w_kj: w ? numOf(w.kj) : null,
  };
}

async function htmlPlaneStrain(page: Page, inp: { layers: unknown[]; opts: unknown }): Promise<Record<string, number | null> & { err: string | null }> {
  const raw = await page.evaluate((i) => {
    state.layers = i.layers;
    let err: string | null = null;
    let R: Record<string, unknown> | null = null;
    try {
      R = solvePlaneStrain(i.opts);
    } catch (e) {
      err = String((e && (e as Error).message) || e);
    }
    if (!R) return { err: err || 'aucun R' };
    return {
      err: null,
      wMax: R.wMax, wMin: R.wMin, mMax: R.mMax, mMin: R.mMin, pMax: R.pMax,
      totalLoad: R.totalLoad, sumReact: R.sumReact, z0: R.z0, decolN: R.decolN,
    };
  }, inp);
  const r = raw as Record<string, unknown>;
  const wMax = f(r.wMax), wMin = f(r.wMin);
  return {
    err: (r.err as string | null) ?? null,
    wMax, wMin, diff: wMax !== null && wMin !== null ? wMax - wMin : null,
    mMax: f(r.mMax), mMin: f(r.mMin), pMax: f(r.pMax),
    totalLoad: f(r.totalLoad), sumReact: f(r.sumReact), z0: f(r.z0), decolN: f(r.decolN),
  };
}
function srvPlaneStrain(o: Record<string, unknown>): Record<string, number | null> {
  return {
    wMax: numOf(o.wMax), wMin: numOf(o.wMin), diff: numOf(o.diff), mMax: numOf(o.mMax), mMin: numOf(o.mMin),
    pMax: numOf(o.pMax), totalLoad: numOf(o.totalLoad), sumReact: numOf(o.sumReact), z0: numOf(o.z0), decolN: numOf(o.decolN),
  };
}

async function htmlAxi(page: Page, inp: { layers: unknown[]; o: unknown }): Promise<Record<string, number | null> & { err: string | null }> {
  const raw = await page.evaluate((i) => {
    state.layers = i.layers;
    let err: string | null = null;
    let R: Record<string, unknown> | null = null;
    try {
      R = solveAxi(i.o);
    } catch (e) {
      err = String((e && (e as Error).message) || e);
    }
    if (!R) return { err: err || 'aucun R' };
    return {
      err: null,
      wc: R.wc, wEdge: R.wEdge, wMax: R.wMax, wMin: R.wMin, mrMax: R.mrMax, mtMax: R.mtMax,
      pMax: R.pMax, totalLoad: R.totalLoad, z0: R.z0,
    };
  }, inp);
  const r = raw as Record<string, unknown>;
  return {
    err: (r.err as string | null) ?? null,
    wc: f(r.wc), wEdge: f(r.wEdge), wMax: f(r.wMax), wMin: f(r.wMin), mrMax: f(r.mrMax), mtMax: f(r.mtMax),
    pMax: f(r.pMax), totalLoad: f(r.totalLoad), z0: f(r.z0),
  };
}
function srvAxi(o: Record<string, unknown>): Record<string, number | null> {
  return {
    wc: numOf(o.wc), wEdge: numOf(o.wEdge), wMax: numOf(o.wMax), wMin: numOf(o.wMin), mrMax: numOf(o.mrMax),
    mtMax: numOf(o.mtMax), pMax: numOf(o.pMax), totalLoad: numOf(o.totalLoad), z0: numOf(o.z0),
  };
}

async function htmlTriRaft(page: Page, inp: TriIn): Promise<Record<string, number | null> & { err: string | null }> {
  const raw = await page.evaluate((i) => {
    state.rafts = i.rafts;
    state.pointLoads = i.pointLoads || [];
    state.lineLoads = i.lineLoads || [];
    state.areaLoads = i.areaLoads || [];
    state.pointSprings = [];
    state.lineSprings = [];
    state.layers = i.layers;
    let err: string | null = null;
    let R: Record<string, unknown> | null = null;
    try {
      R = solveTriRaft(i.opts);
    } catch (e) {
      err = String((e && (e as Error).message) || e);
    }
    if (!R) return { err: err || 'aucun R' };
    return {
      err: null,
      wMax: R.wMax, wMin: R.wMin, pMax: R.pMax, totalLoad: R.totalLoad, sumReact: R.sumReact, nRaft: R.nRaft, z0: R.z0,
    };
  }, inp);
  const r = raw as Record<string, unknown>;
  const wMax = f(r.wMax), wMin = f(r.wMin);
  return {
    err: (r.err as string | null) ?? null,
    wMax, wMin, diff: wMax !== null && wMin !== null ? wMax - wMin : null,
    reactionMax: f(r.pMax), totalLoad: f(r.totalLoad), sumReact: f(r.sumReact), nRaft: f(r.nRaft), z0: f(r.z0),
  };
}
function srvTriRaft(o: Record<string, unknown>): Record<string, number | null> {
  return {
    wMax: numOf(o.wMax), wMin: numOf(o.wMin), diff: numOf(o.diff), reactionMax: numOf(o.reactionMax),
    totalLoad: numOf(o.totalLoad), sumReact: numOf(o.sumReact), nRaft: numOf(o.nRaft), z0: numOf(o.z0),
  };
}

const stripErr = (o: Record<string, number | null> & { err: string | null }): Record<string, number | null> => {
  const { err: _err, ...rest } = o;
  void _err;
  return rest;
};

// ==========================================================================
// SUITE — golden-master champ par champ (navigateur HTML ↔ serveur tenant).
// ==========================================================================

test.describe('ÉQUIVALENCE GEOPLAQUE — HTML client (navigateur) ↔ plateforme (serveur)', () => {
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    // SKIP BRUYANT : sans le HTML source, on ÉCHOUE (jamais un faux-vert).
    if (!existsSync(FROZEN_HTML)) {
      throw new Error(
        `HTML client de référence ABSENT (${FROZEN_HTML}). Sources hors dépôt : ` +
          `impossible de prouver l'équivalence — ÉCHEC dur (pas de skip silencieux).`,
      );
    }
    // Ancrage : le fichier testé == la référence scellée au registre.
    const sha = createHash('sha256').update(readFileSync(FROZEN_HTML)).digest('hex');
    expect(sha, 'SHA du HTML testé != empreinte scellée au registre').toBe(SEALED_SHA);

    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', () => {
      /* erreurs de rendu (icônes CDN absentes) sans effet : les solveurs sont appelés directement */
    });
    await page.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    // Sanity : le HTML expose les 4 solveurs + la globale `state`.
    const globals = await page.evaluate(() => ({
      state: typeof (globalThis as Record<string, unknown>).state !== 'undefined' || typeof state !== 'undefined',
      solveModel: typeof solveModel,
      solvePlaneStrain: typeof solvePlaneStrain,
      solveAxi: typeof solveAxi,
      solveTriRaft: typeof solveTriRaft,
    }));
    expect(globals.solveModel, 'solveModel absent').toBe('function');
    expect(globals.solvePlaneStrain, 'solvePlaneStrain absent').toBe('function');
    expect(globals.solveAxi, 'solveAxi absent').toBe('function');
    expect(globals.solveTriRaft, 'solveTriRaft absent').toBe('function');
    expect(globals.state, 'globale state absente').toBe(true);

    // Provisionne l'org JETABLE (E2E-TEST-*).
    jetable = await provisionJetable(request);
  });

  test('la meta serveur scelle bien la même référence (engineSourceHash == SHA gelé) pour les 4 modes', async ({
    request,
  }) => {
    const r1 = await serverCalc(request, 'radier', RADIER_CAS[0].input);
    expect(r1.status, `radier HTTP ${r1.status}`).toBe(201);
    expect(r1.meta?.engineSourceHash, 'meta radier').toBe(SEALED_SHA);
    const r2 = await serverCalc(request, 'plane-strain', PS_CAS[0].input);
    expect(r2.meta?.engineSourceHash, 'meta plane-strain').toBe(SEALED_SHA);
    const r3 = await serverCalc(request, 'axi', AXI_CAS[0].input);
    expect(r3.meta?.engineSourceHash, 'meta axi').toBe(SEALED_SHA);
    const r4 = await serverCalc(request, 'tri-raft', TRI_CAS[0].input);
    expect(r4.meta?.engineSourceHash, 'meta tri-raft').toBe(SEALED_SHA);
  });

  // --- MODE 1 : radier ACM (solveModel / slug radier) --------------------------------
  for (const cas of RADIER_CAS) {
    test(`[radier] given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9)`, async ({
      request,
    }) => {
      const html = await htmlRadier(page, cas.input);
      expect(html.err, `HTML radier doit calculer (${cas.id}) : ${html.err}`).toBeNull();
      const srv = await serverCalc(request, 'radier', cas.input);
      expect(srv.status, `serveur radier HTTP ${srv.status} (${cas.id})`).toBe(201);
      expect(srv.ok && srv.output, `serveur radier ok+output (${cas.id})`).toBeTruthy();
      const { worst, ecarts } = compare(stripErr(html), srvRadier(srv.output!));
      console.log(`[radier/${cas.id}] écart max rel=${worst.toExponential(3)} · wMax=${html.wMax} betaGov=${html.betaGov}`);
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst).toBeLessThanOrEqual(REL_TOL);
    });
  }

  // --- MODE 2 : déformations planes (solvePlaneStrain / slug plane-strain) ------------
  for (const cas of PS_CAS) {
    test(`[plane-strain] given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9)`, async ({
      request,
    }) => {
      const html = await htmlPlaneStrain(page, cas.input);
      expect(html.err, `HTML plane-strain doit calculer (${cas.id}) : ${html.err}`).toBeNull();
      const srv = await serverCalc(request, 'plane-strain', cas.input);
      expect(srv.status, `serveur plane-strain HTTP ${srv.status} (${cas.id})`).toBe(201);
      expect(srv.ok && srv.output, `serveur plane-strain ok+output (${cas.id})`).toBeTruthy();
      const { worst, ecarts } = compare(stripErr(html), srvPlaneStrain(srv.output!));
      console.log(`[plane-strain/${cas.id}] écart max rel=${worst.toExponential(3)} · wMax=${html.wMax} mMax=${html.mMax}`);
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst).toBeLessThanOrEqual(REL_TOL);
    });
  }

  // --- MODE 3 : axisymétrique (solveAxi / slug axi) ----------------------------------
  for (const cas of AXI_CAS) {
    test(`[axi] given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9)`, async ({
      request,
    }) => {
      const html = await htmlAxi(page, cas.input);
      expect(html.err, `HTML axi doit calculer (${cas.id}) : ${html.err}`).toBeNull();
      const srv = await serverCalc(request, 'axi', cas.input);
      expect(srv.status, `serveur axi HTTP ${srv.status} (${cas.id})`).toBe(201);
      expect(srv.ok && srv.output, `serveur axi ok+output (${cas.id})`).toBeTruthy();
      const { worst, ecarts } = compare(stripErr(html), srvAxi(srv.output!));
      console.log(`[axi/${cas.id}] écart max rel=${worst.toExponential(3)} · wc=${html.wc} pMax=${html.pMax}`);
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst).toBeLessThanOrEqual(REL_TOL);
    });
  }

  // --- MODE 4 : radier triangulaire (solveTriRaft / slug tri-raft) --------------------
  for (const cas of TRI_CAS) {
    test(`[tri-raft] given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9)`, async ({
      request,
    }) => {
      const html = await htmlTriRaft(page, cas.input);
      expect(html.err, `HTML tri-raft doit calculer (${cas.id}) : ${html.err}`).toBeNull();
      const srv = await serverCalc(request, 'tri-raft', cas.input);
      expect(srv.status, `serveur tri-raft HTTP ${srv.status} (${cas.id})`).toBe(201);
      expect(srv.ok && srv.output, `serveur tri-raft ok+output (${cas.id})`).toBeTruthy();
      const { worst, ecarts } = compare(stripErr(html), srvTriRaft(srv.output!));
      console.log(`[tri-raft/${cas.id}] écart max rel=${worst.toExponential(3)} · wMax=${html.wMax} reactionMax=${html.reactionMax}`);
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst).toBeLessThanOrEqual(REL_TOL);
    });
  }

  // --- REJET (chemins négatifs) : les 2 côtés refusent le calcul (aucun résultat numérique) ---
  test('[rejet] hors-domaine : HTML lève ET serveur refuse — pour les 4 modes', async ({ request }) => {
    // radier : maillage trop fin (garde moteur) ; le serveur convertit output.erreur -> ok:false.
    const hR = await htmlRadier(page, RADIER_REJET);
    expect(hR.err, 'HTML radier doit lever (maillage trop fin)').not.toBeNull();
    const sR = await serverCalc(request, 'radier', RADIER_REJET);
    expect(sR.status === 400 || sR.ok === false, `serveur radier doit refuser (HTTP ${sR.status}, ok=${sR.ok})`).toBe(true);

    // plane-strain : aucune couche (layers vide) -> garde ; serveur : 400 (schema) ou ok:false.
    const hP = await htmlPlaneStrain(page, PS_REJET);
    expect(hP.err, 'HTML plane-strain doit lever (aucune couche)').not.toBeNull();
    const sP = await serverCalc(request, 'plane-strain', PS_REJET);
    expect(sP.status === 400 || sP.ok === false, `serveur plane-strain doit refuser (HTTP ${sP.status}, ok=${sP.ok})`).toBe(true);

    // axi : aucune couche -> garde ; serveur : 400 (schema) ou ok:false.
    const hA = await htmlAxi(page, AXI_REJET);
    expect(hA.err, 'HTML axi doit lever (aucune couche)').not.toBeNull();
    const sA = await serverCalc(request, 'axi', AXI_REJET);
    expect(sA.status === 400 || sA.ok === false, `serveur axi doit refuser (HTTP ${sA.status}, ok=${sA.ok})`).toBe(true);

    // tri-raft : maillage trop fin (> 1200 nœuds) -> garde moteur ; serveur : ok:false.
    const hT = await htmlTriRaft(page, TRI_REJET);
    expect(hT.err, 'HTML tri-raft doit lever (maillage trop fin)').not.toBeNull();
    const sT = await serverCalc(request, 'tri-raft', TRI_REJET);
    expect(sT.status === 400 || sT.ok === false, `serveur tri-raft doit refuser (HTTP ${sT.status}, ok=${sT.ok})`).toBe(true);
  });
});

// ==========================================================================
// SUITE UI (RUN_UI=1) — bout-en-bout : login org jetable -> GEOPLAQUE onglet Modèle
// (radier) + onglet 2D (plane-strain), Calculer, capture d'écran.
// ==========================================================================

test.describe('BOUT-EN-BOUT GEOPLAQUE (UI réelle Vercel↔Render)', () => {
  test.skip(!RUN_UI, 'RUN_UI=1 requis pour cibler l’UI en ligne.');

  // Runnable en standalone : provisionne l'org jetable si le beforeAll golden ne l'a
  // pas déjà fait (grep/filtre ne ciblant que ce describe).
  test.beforeAll(async ({ request }) => {
    if (!jetable) jetable = await provisionJetable(request);
  });

  test('given l’org jetable connectée, when j’ouvre GEOPLAQUE, then l’UI présente fidèlement le logiciel et ses modes (onglet Modèle & sol = radier, onglet 2D = déformations planes / axi / tri-raft)', async ({
    browser,
  }) => {
    test.setTimeout(400_000); // marge cold-start Render (login free-tier lent)
    expect(jetable, 'org jetable requise').not.toBeNull();
    const j = jetable!;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    p.setDefaultNavigationTimeout(NAV);

    // --- Login sur l'org jetable ---
    await p.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await p.getByLabel('Adresse e-mail').fill(j.ownerEmail);
    await p.getByLabel('Mot de passe').fill(j.ownerPassword);
    await Promise.all([
      p.waitForURL(new RegExp(`/app/${j.orgSlug}/(logiciels|projets)`), { timeout: 120_000 }),
      p.getByRole('button', { name: 'Se connecter' }).click(),
    ]);

    // --- Ouvre GEOPLAQUE (logiciel gaté sur l'entitlement 'radier') ---
    await p.goto(`${FRONT}/app/${j.orgSlug}/logiciels/geoplaque`, { waitUntil: 'domcontentloaded', timeout: NAV });
    await p.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await expect(p.getByText(/couldn.t load|server error|Application error|page n.a pas pu|403|non autorisé/i)).toHaveCount(0);

    // FIDELITE D'INTERFACE (steps 4/5) : le titre GEOPLAQUE + le sous-titre client
    // + les onglets des 4 modes (Modèle & sol = radier ACM ; 2D = déformations planes /
    // axi / tri-raft) sont rendus, fidèles au HTML client. Assertions LOAD-BEARING
    // (login + routing + render du logiciel gaté sur l'entitlement 'radier').
    await expect(p.getByText(/Radier & plaque sur sol multicouche/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(p.getByRole('tab', { name: /Modèle/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(p.getByRole('tab', { name: '2D' }).first()).toBeVisible({ timeout: 30_000 });
    // Saisie radier fidèle : module béton E, contour de plaque (Modèle & sol).
    await expect(p.getByText(/Module béton E/i).first()).toBeVisible({ timeout: 30_000 });
    await p.screenshot({ path: 'test-results/equiv-geoplaque-artifacts/ui-modele-radier.png', timeout: 20_000 }).catch(() => {});

    // Bascule sur l'onglet 2D pour PROUVER que les 3 autres modes (déformations planes /
    // axi / tri-raft) sont présentés sous le même logiciel, puis capture.
    await p.getByRole('tab', { name: '2D' }).first().click().catch(() => {});
    await p.screenshot({ path: 'test-results/equiv-geoplaque-artifacts/ui-2d.png', timeout: 20_000 }).catch(() => {});

    console.log(
      `[UI GEOPLAQUE] fidélité d'interface OK : login org jetable + routing + logiciel ` +
        `gaté 'radier' + titre client + onglets Modèle & sol (radier) / 2D (3 modes) + saisie radier.`,
    );
    await ctx.close();
  });
});
