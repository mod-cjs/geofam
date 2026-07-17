/**
 * FIDÉLITÉ D'INTERFACE ROADSENS — HTML client (référence gelée) ↔ NOTRE clone.
 * (généralisation « clone UI client », ADR 0015 — roadsens = moteur burmister).
 * ==========================================================================
 *
 * OBJECTIF : PROUVER l'équivalence d'AFFICHAGE/FONCTIONNEMENT entre l'outil
 * ROADSENS du client (`roadsens_burmister_definitive.html`, v2.0.0 scellée
 * ADR 0013) et notre logiciel web — qui, depuis ADR 0015, N'EST PLUS une
 * reconstruction React mais le CLONE fidèle de l'UI client (calcul EXCISÉ),
 * chargé en `<iframe srcdoc sandbox>` via `ToolFrame`, dont le calcul part côté
 * SERVEUR (DoD §8). Ce spec ne CORRIGE rien : il CATALOGUE + CAPTURE + COMPARE.
 *
 * DISPOSITIF (mêmes 3 volets que le pilote terzaghi) :
 *   (a) SORTIE SERVEUR du cas de référence CAS_REF — exécutée par le MOTEUR
 *       SOURCE `runBurmister` en sous-processus (`scripts/burmister-engine-run.mts`) :
 *       c'est numériquement la sortie qu'un serveur renverrait (équivalence
 *       module↔origine prouvée par `engine.equivalence.test.ts`, tol rel 1e-9).
 *       On charge la SOURCE `.ts` via tsx — jamais d'import moteur dans le spec.
 *   (b) RÉFÉRENCE (LECTURE seule) — la définitive en file://, MÊME cas piloté par
 *       réassignation des bindings `ly/pf/tr/cp` + `doCalc()` (elle a encore son
 *       moteur) → extraction du rapport #detout (9 sections) + du panneau Résultats.
 *   (c) NOTRE app en LOCAL, MODE RÉEL (port 3102), clone en iframe : MÊME cas saisi
 *       dans le CLONE (mêmes bindings — c'est l'UI de la définitive) ; la requête de
 *       calcul (`POST .../calc/burmister`) est INTERCEPTÉE par page.route et fulfillée
 *       avec la sortie (a), forme `BackendPersistedCalcResult` que consomme ToolFrame.
 *       Extraction du MÊME jeu (#detout + Résultats) dans le frame.
 *   (d) CLASSIFICATION FERMÉE par ligne du rapport #detout via `classifyRow` (la MÊME
 *       fonction des deux côtés : deux lignes équivalentes reçoivent la MÊME clé, tol
 *       rel 1e-6 / 5e-4 en notation sci). Toute ligne NON classée (clé null) = ÉCHEC.
 *       Les RÉSIDUS FERMÉS §8 (stC/stG composantes collée/glissante, axe/mid décompo
 *       ε_z) n'apparaissent QUE dans la colonne COMMENTAIRE (le clone y affiche « — ») ;
 *       la VALEUR reste whitelistée et FIDÈLE → non comparés en valeur, tracés en synthèse.
 *   (e) On compare AUSSI le panneau Résultats (verdict + KPI) réf↔clone.
 *
 * ZÉRO FAUX-VERT : réf absente → ÉCHEC dur ; « 0 ligne » extraite d'un côté → ÉCHEC
 * dur ; calc non intercepté → ÉCHEC dur ; le stub backend REFUSE le calcul (405) pour
 * garantir que la sortie comparée vient bien de l'interception, jamais du stub.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE + AFFICHAGE, PAS la justesse
 * scientifique (responsabilité STARFIRE — split contractuel).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Frame, type Page } from '@playwright/test';

// --------------------------------------------------------------------------
// Références & cibles
// --------------------------------------------------------------------------

/** Définitive du client (LECTURE SEULE — ne JAMAIS modifier ; scellée v2.0.0). */
const DEFINITIVE_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/roadsens_burmister_definitive.html',
);
/** Notre clone (artefact généré par scripts/clone-tool.mjs, calcul excisé). */
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/roadsens.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAP_DIR = path.join(OUT_DIR, 'captures');

// Identité forgée — mêmes claims que le middleware attend (cf. config JWT_SECRET).
const SECRET = 'fidelite-roadsens-e2e-secret-32bytes-min-xxxxxxxx'; // = webServer.env.JWT_SECRET
const ORG_SLUG = 'etude-roadsens';
const ORG_ID = 'org_rs';

function ensureDirs(): void {
  mkdirSync(CAP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
}
function dumpJson(name: string, data: unknown): void {
  ensureDirs();
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// --------------------------------------------------------------------------
// JWT HS256 forgé (node:crypto, aucune dépendance) — claim `orgs` = etude-roadsens.
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
      sub: 'user_rs',
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

// NB : les bindings globaux de la définitive/du clone (`ly`/`pf`/`tr`/`cp`,
// `doCalc`/`renderDetails`) sont pilotés par EVAL DE CHAÎNE (stateScript + IIFE),
// jamais comme identifiants TS nus — donc aucune `declare` n'est requise ici.

// ==========================================================================
// Cas de référence — répliqué en constante locale (on n'importe PAS @roadsen/engines
// dans un spec e2e). Cas MANUEL bitumineux (BBSG1/GB3/GL1 sur PF2, faible trafic) —
// exerce la fatigue ε_t (couche liée) ET une couche granulaire non liée (ε_z sommet,
// dont la décompo axe/mid est un résidu fermé §8 côté clone). Aucune couche traitée
// (rigL vide) : famille bitumineuse épaisse, pas de σ_t MTLH/béton.
// ==========================================================================

interface BurmisterInput {
  layers: Array<{ mat: string; h: number; E: number; nu: number }>;
  subgrade: { cls: string; E: number; nu: number };
  traffic: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
  load: { p: number; a: number; d: number; r: 'auto'; sh: 'auto'; ks: 'auto' };
}

const CAS_REF: BurmisterInput = {
  layers: [
    { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
    { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
    { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
  ],
  subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
  traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
  load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
};

/** STATE de l'UI (ly/pf/tr/cp) équivalent à CAS_REF — piloté à l'identique des 2 côtés. */
interface UiState {
  ly: Array<{ id: number; mat: string; h: number; E: number; nu: number; ifc: string }>;
  pf: { cls: string; E: number; nu: number };
  tr: BurmisterInput['traffic'];
  cp: {
    p: number;
    a: number;
    d: number;
    r: string;
    sh: string;
    ks: string;
    gntAuto: boolean;
    neForce: number | null;
  };
}
function stateFor(input: BurmisterInput): UiState {
  return {
    ly: input.layers.map((l, i) => ({
      id: i + 1,
      mat: l.mat,
      h: l.h,
      E: l.E,
      nu: l.nu,
      ifc: 'auto',
    })),
    pf: { cls: input.subgrade.cls, E: input.subgrade.E, nu: input.subgrade.nu },
    tr: { ...input.traffic },
    cp: {
      p: input.load.p,
      a: input.load.a,
      d: input.load.d,
      r: 'auto',
      sh: 'auto',
      ks: 'auto',
      gntAuto: false,
      neForce: null,
    },
  };
}
/** Script d'affectation des bindings `let` (technique du harnais d'équivalence). */
function stateScript(st: UiState): string {
  return (
    `ly=${JSON.stringify(st.ly)};` +
    `pf=${JSON.stringify(st.pf)};` +
    `tr=${JSON.stringify(st.tr)};` +
    `cp=${JSON.stringify(st.cp)};`
  );
}

// ==========================================================================
// Extraction DOM du rapport Détails — fonction SÉRIALISÉE (navigateur). Générique :
// MÊME code pour la définitive (#detout table) et pour le clone (#detout table).
//   - ligne 1 cellule (colspan=3) fond #1a4a7a (rgb 26,74,122) → bandeau SECTION ;
//     fond #f0f0f8 → FORMULE (ignorée).
//   - ligne 3 cellules → donnée. Unité = <span> couleur #888 (rgb 136,136,136) dans
//     la cellule valeur ; valeur = texte cellule moins l'unité.
// ==========================================================================

interface RawRow {
  section: string;
  label: string;
  value: string;
  unit: string;
  comment: string;
}

function extractReport(sel: string): { rows: RawRow[]; error?: string } {
  const table = document.querySelector(sel);
  if (!table) return { rows: [], error: 'table introuvable: ' + sel };
  const trs = Array.from(table.querySelectorAll('tr'));
  const rows: RawRow[] = [];
  let section = '';
  const bg = (el: Element) => getComputedStyle(el).backgroundColor;
  const colorOf = (el: Element) => getComputedStyle(el).color;
  for (const tr of trs) {
    const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
    if (tds.length === 1) {
      if (bg(tds[0]) === 'rgb(26, 74, 122)') section = (tds[0].textContent || '').trim();
      continue;
    }
    if (tds.length >= 3) {
      const label = (tds[0].textContent || '').trim();
      const valueCell = tds[1];
      let unit = '';
      const spans = Array.from(valueCell.querySelectorAll('span'));
      for (const s of spans) {
        if (colorOf(s) === 'rgb(136, 136, 136)') {
          unit = (s.textContent || '').trim();
          break;
        }
      }
      let value = valueCell.textContent || '';
      if (unit) {
        const idx = value.lastIndexOf(unit);
        if (idx >= 0) value = value.slice(0, idx);
      }
      value = value.trim();
      const comment = (tds[2].textContent || '').trim();
      rows.push({ section, label, value, unit, comment });
    }
  }
  return { rows };
}

/** Extraction du panneau Résultats (#resout) : verdict + KPI (.metric) + badges. */
interface ResultsPanel {
  verdict: string;
  metrics: { label: string; value: string; sub: string }[];
  badges: string[];
}
function extractResults(): ResultsPanel {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const out = document.getElementById('resout');
  const txt = norm(out?.textContent);
  const verdict = /Structure non satisfaisante/.test(txt)
    ? 'non satisfaisante'
    : /Structure satisfaisante/.test(txt)
      ? 'satisfaisante'
      : '';
  const metrics = Array.from(out?.querySelectorAll('.metric') ?? []).map((m) => ({
    label: norm(m.querySelector('.ml')?.textContent),
    value: norm(m.querySelector('.mv')?.textContent),
    sub: norm(m.querySelector('.ms')?.textContent),
  }));
  const badges = Array.from(out?.querySelectorAll('.badge') ?? []).map((b) =>
    norm(b.textContent),
  );
  return { verdict, metrics, badges };
}

// ==========================================================================
// Normalisation & parsing (côté Node) — robustes aux deux moteurs de rendu.
// ==========================================================================

function normLabel(s: string): string {
  let t = s.toLowerCase();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t
    .replace(/[σς]/g, 's')
    .replace(/ε/g, 'e')
    .replace(/ν/g, 'nu')
    .replace(/τ/g, 'tau')
    .replace(/θ/g, 'th')
    .replace(/δ/g, 'delta')
    .replace(/[µμ]/g, 'u');
  t = t.replace(/sigma/g, 's');
  t = t
    .replace(/[\u00a0\u202f]/g, ' ')
    // Underscore = séparateur d'indice (σ_z, ez_adm, et_adm) — le mapping classifyRow
    // suppose « s z psc » / « ^s [zr] » : on aligne « _ » sur l'espace (sinon les
    // lignes σ des sections 5/8 tomberaient en NON classées → ÉCHEC).
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}
function normUnit(u: string): string {
  return u.toLowerCase().replace(/[µμ]/g, 'u').replace(/\s+/g, '').trim();
}
function normText(s: string): string {
  return normLabel(s);
}
function parseNums(s: string): number[] {
  let t = s.replace(/[\u00a0\u202f]/g, '');
  t = t.replace(/[a-zµμσεθδν]+\d+(?=\s*=)/gi, '');
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  const m = t.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  return m ? m.map(Number) : [];
}
function relErr(a: number, b: number): number {
  if (a === b) return 0;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / denom;
}

// ==========================================================================
// MAPPING DOCUMENTÉ — classifyRow(section, label) → { key, kind }, À JOUR ADR 0014.
// La MÊME fonction s'applique aux DEUX côtés : deux lignes équivalentes reçoivent la
// MÊME `key`. Depuis « zéro écart » (13/07/2026) il n'y a PLUS de 'notexposed' ni
// d'absence côté burmister : tous les coefficients LCPC et le « et_adm r=50% » sont
// exposés. `key === null` ⇒ ligne NON classée = ÉCHEC (trou de mapping à corriger ici,
// PAS un écart d'app). Les résidus fermés stC/stG/axe/mid ne sont PAS des lignes : ils
// vivent dans la colonne COMMENTAIRE (« — » côté clone) → hors comparaison de valeur.
// ==========================================================================

type Kind = 'value';
function classifyRow(
  sectionRaw: string,
  labelRaw: string,
): { key: string | null; kind: Kind } {
  const v = (key: string): { key: string; kind: Kind } => ({ key, kind: 'value' });
  const none = { key: null, kind: 'value' as Kind };

  const secNum = sectionRaw.match(/^\s*(\d+)\./);
  const sec = secNum
    ? secNum[1]
    : /(condition|interface)/.test(normLabel(sectionRaw))
      ? 'IF'
      : '?';
  const L = normLabel(labelRaw);

  switch (sec) {
    case '1':
      if (L.includes('pression p0')) return v('S1.p0');
      if (L.includes('rayon a')) return v('S1.a');
      if (
        L.includes('entre-axe d') ||
        L.includes('entre axe d') ||
        L.includes('entreaxe')
      )
        return v('S1.d');
      if (L.startsWith('risque r')) return v('S1.risk');
      if (L.includes('plateforme')) return v('S1.pf');
      return none;
    case '2':
      if (L.includes('tmja')) return v('S2.tmja');
      if (L.startsWith('cam')) return v('S2.cam');
      if (L.includes('duree')) return v('S2.duree');
      if (L.startsWith('taux')) return v('S2.taux');
      if (L.includes('c cumulatif')) return v('S2.ccum');
      if (L === 'ne') return v('S2.ne');
      if (L.includes('adm catalogue')) return v('S2.ezadmcat');
      return none;
    case '3': {
      const lm = L.match(/^couche (\d+)/);
      if (lm) return v('S3.layer.' + lm[1]);
      if (L.includes('h paquet li')) return v('S3.hpaquet');
      if (L.includes('h total couches')) return v('S3.htotal');
      if (L.includes('pond') && L.includes('paquet li'))
        return v(L.includes('nu') ? 'S3.nu1' : 'S3.E1');
      return none;
    }
    case '4':
      if (L.includes('integration hankel')) return v('S4.hankel');
      if (L.includes('cl surface')) return v('S4.clsurface');
      if (L.includes('interface critiques')) return v('S4.ifcrit');
      return none;
    case '5': {
      const m = L.match(/^s ([zr])\b/);
      if (m) {
        const d2 = L.includes('d/2') || L.includes('d 2');
        return v(`S5.s${m[1]}_${d2 ? 'd2' : 'r0'}`);
      }
      return none;
    }
    case '6':
      if (L.includes('et r=0')) return v('S6.et_r0');
      if (L.includes('et r=d/2')) return v('S6.et_d2');
      if (L.includes('retenue')) return v('S6.retenue');
      if (L.includes('famille de structure')) return v('S6.famille');
      if (L.includes('materiau dimensionnant')) return v('S6.matdim');
      return none;
    case 'IF': {
      const im = L.match(/interface c(\d+)/);
      if (im) return v('IF.' + im[1]);
      if (L.includes('phase 2 mixte')) return v('IF.phase2');
      return none;
    }
    case '7':
      // ADR 0014 — tous exposés (VALEUR), plus aucun « non exposé §8 ».
      if (L.includes('kth') || L.includes('k theta') || L.includes('temperature'))
        return v('S7.kth');
      if (L.startsWith('risque r')) return v('S7.risk');
      if (L === 'sn') return v('S7.sn');
      if (L === 'sh') return v('S7.sh');
      if (L.startsWith('delta') || L === 'delta') return v('S7.delta');
      if (L.startsWith('kr')) return v('S7.kr');
      if (L.startsWith('kc')) return v('S7.kc');
      if (L.startsWith('ks')) return v('S7.ks');
      if (L.includes('50%')) return v('S7.adm50'); // « et_adm/st_adm r=50% » — LIVRÉ (ADR 0014)
      if (L.includes('phase 2')) return v('S7.phase2');
      if (L.includes('inverse')) return v('S7.inverse');
      if (L.startsWith('st base c')) return v('S7.stbase');
      if (L.includes('adm')) return v('S7.adm'); // et_adm/st_adm r=X%
      return none;
    case '8':
      if (L.includes('h total couches')) return v('S8.htotal');
      if (L.includes('s z psc') || L === 's z psc') return v('S8.sz_psc');
      if (L.includes('s r psc') || L === 's r psc') return v('S8.sr_psc');
      if (L.includes('ez axe roue')) return v('S8.ez_axe');
      if (L.includes('ez entre-jumelage') || L.includes('ez entre jumelage'))
        return v('S8.ez_mid');
      if (L.includes('ez sommet couche')) {
        const gm = L.match(/couche (\d+)/);
        return v('S8.ezg.' + (gm ? gm[1] : '?'));
      }
      if (L.includes('ez retenue')) return v('S8.ez_retenue');
      if (L.includes('ez admissible')) return v('S8.ez_adm');
      return none;
    case '9':
      if (L.startsWith('fatigue')) return v('S9.fatigue');
      if (L.includes('orni')) return v('S9.ornierage');
      if (L.includes('verdict')) return v('S9.verdict');
      return none;
    default:
      return none;
  }
}

// ==========================================================================
// Sortie serveur (a) via moteur SOURCE en sous-processus (jamais importé dans le spec).
// ==========================================================================
function serverOutputFor(input: BurmisterInput): unknown {
  const raw = execFileSync('npx', ['tsx', 'scripts/burmister-engine-run.mts'], {
    input: JSON.stringify(input),
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
  expect(parsed.ok, `moteur serveur (a) a échoué : ${raw.slice(0, 400)}`).toBe(true);
  expect(parsed.output, 'sortie serveur (a) vide').toBeTruthy();
  return parsed.output;
}

// ==========================================================================
// (b) RÉFÉRENCE — file://, réassignation d'état + doCalc + renderDetails, extraction.
// ==========================================================================
async function driveReferenceCase(
  page: Page,
  st: UiState,
): Promise<{ rows: RawRow[]; results: ResultsPanel }> {
  const err = (await page.evaluate(
    `(function(){ try { ${stateScript(st)} doCalc(); renderDetails(); return null; } catch(e){ return String(e && e.message || e); } })()`,
  )) as string | null;
  expect(err, `la définitive doit calculer sans lever (err=${err})`).toBeNull();
  const det = await page.evaluate(extractReport, '#detout table');
  expect(det.error, `extraction définitive : ${det.error ?? ''}`).toBeUndefined();
  const results = await page.evaluate(extractResults);
  return { rows: det.rows, results };
}

// ==========================================================================
// (c) NOTRE app — connexion forgée, iframe clone, interception du calcul.
// ==========================================================================
async function openOurClone(
  page: Page,
  serverOutput: unknown,
  token: string,
): Promise<{ intercepted: () => boolean }> {
  let calcIntercepted = false;

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
        modules: ['burmister', 'chaussee-burmister'],
        expiresAt: new Date(Date.now() + 3.15e10).toISOString(),
        expired: false,
        quota: { limit: 1000, used: 1, remaining: 999 },
        serverTime: new Date().toISOString(),
      }),
    }),
  );
  // UN SEUL projet CH → la page roadsens l'auto-sélectionne (ch.length === 1) →
  // ToolFrame monte le clone.
  await page.route(/\/projects$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'proj_rs',
          orgId: ORG_ID,
          name: 'E2E fidélité ROADSENS',
          domain: 'CH',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_rs',
        },
      ]),
    }),
  );
  // LE CŒUR : la requête de calcul burmister est interceptée et fulfillée avec (a),
  // forme BackendPersistedCalcResult ({calcResultId, ok, meta, output}) → ToolFrame
  // livre `output` (rawOutput whitelisté) au clone.
  await page.route(/\/projects\/[^/]+\/calc\/[^/]+/, async (route) => {
    calcIntercepted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calcResultId: 'cr_e2e_rs_1',
        ok: true,
        meta: { engineId: 'burmister', engineVersion: 'e2e-fidelite' },
        output: serverOutput,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/roadsens`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1500);
  return { intercepted: () => calcIntercepted };
}

function cloneFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((f) => f.url().includes('srcdoc') || f !== page.mainFrame());
  if (!frame) throw new Error('frame du clone introuvable');
  return frame;
}

/** Pilote le CLONE : saisit CAS_REF, clique « Calculer » (calc serveur intercepté). */
async function driveCloneCase(
  page: Page,
  frame: Frame,
  st: UiState,
): Promise<{ rows: RawRow[]; results: ResultsPanel }> {
  await frame.locator('#btnc').waitFor({ state: 'visible', timeout: 15_000 });
  // Saisie : réassignation des mêmes bindings que la référence (UI identique).
  await frame.evaluate(`(function(){ ${stateScript(st)} })()`);
  await frame.locator('#btnc').click();
  // Fin du recalc async : le panneau Résultats porte au moins une carte KPI.
  await expect
    .poll(async () => frame.locator('#resout .metric').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
  const det = await frame.evaluate(extractReport, '#detout table');
  expect(det.error, `extraction clone : ${det.error ?? ''}`).toBeUndefined();
  const results = await frame.evaluate(extractResults);
  return { rows: det.rows, results };
}

// ==========================================================================
// Comparaison des rapports Détails via classifyRow (tol rel 1e-6 / 5e-4 sci).
// ==========================================================================
interface CompareResult {
  valuesOk: number;
  uncoveredClient: string[];
  uncoveredOurs: string[];
  omitted: string[];
  masked: string[];
  mismatch: string[];
}

/**
 * REDACTION ASSUMÉE DE LA FAMILLE (FUITE #1, ADR 0015) : le clone affiche le libellé
 * NU d'allowlist (`sanitizeFamille`), la définitive y ajoute la référence de section
 * normative « (§x.y) » et/ou le discriminant Kmix « K=… ». On retire ces éléments
 * confidentiels des DEUX côtés avant de comparer le NOM de famille — la différence
 * est la redaction VOULUE, pas une infidélité d'affichage.
 */
function stripFamilleRedaction(s: string): string {
  return s
    .replace(/\s*\(§[^)]*\)/g, '')
    .replace(/[,;]?\s*K(?:mix)?\s*=\s*-?[\d.,]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareDetails(defRows: RawRow[], ourRows: RawRow[]): CompareResult {
  const ourByKey = new Map<string, RawRow>();
  const uncoveredOurs: string[] = [];
  const masked: string[] = [];
  for (const r of ourRows) {
    const c = classifyRow(r.section, r.label);
    if (/non expos/i.test(r.value))
      masked.push(`[${r.section}] « ${r.label} » = « ${r.value} »`);
    if (c.key === null) uncoveredOurs.push(`[${r.section}] « ${r.label} »`);
    else if (!ourByKey.has(c.key)) ourByKey.set(c.key, r);
  }

  const uncoveredClient: string[] = [];
  const omitted: string[] = [];
  const mismatch: string[] = [];
  let valuesOk = 0;

  for (const d of defRows) {
    const c = classifyRow(d.section, d.label);
    const tag = `[${d.section}] « ${d.label} » = « ${d.value} »${d.unit ? ' ' + d.unit : ''}`;
    if (c.key === null) {
      uncoveredClient.push(tag);
      continue;
    }
    const ours = ourByKey.get(c.key);
    if (!ours) {
      omitted.push(`${tag} — ABSENTE côté clone (clé ${c.key}).`);
      continue;
    }
    // Famille : comparaison redaction-aware (le clone masque « (§x.y) » / « K=… »).
    if (c.key === 'S6.famille') {
      const df = stripFamilleRedaction(d.value);
      const of = stripFamilleRedaction(ours.value);
      if (normText(df) === normText(of)) valuesOk++;
      else
        mismatch.push(
          `${tag} vs clone « ${ours.value} » — famille (hors redaction) « ${df} » ≠ « ${of} »`,
        );
      continue;
    }

    const dn = parseNums(d.value);
    const on = parseNums(ours.value);
    const isSci = /\d[eE][+-]?\d/.test(d.value);
    const tol = isSci ? 5e-4 : 1e-6;

    let ok = true;
    let why = '';
    if (dn.length === 0 && on.length === 0) {
      if (normText(d.value) !== normText(ours.value)) {
        ok = false;
        why = `texte différent (déf « ${d.value} » ≠ clone « ${ours.value} »)`;
      }
    } else if (dn.length !== on.length) {
      ok = false;
      why = `nombre de valeurs différent (déf ${JSON.stringify(dn)} ≠ clone ${JSON.stringify(on)})`;
    } else {
      for (let i = 0; i < dn.length; i++) {
        const e = relErr(dn[i], on[i]);
        if (e > tol) {
          ok = false;
          why = `valeur[${i}] déf=${dn[i]} clone=${on[i]} rel=${e.toExponential(3)} > tol=${tol.toExponential(0)}${isSci ? ' (déf notation sci lossy)' : ''}`;
          break;
        }
      }
    }
    if (ok && d.unit && ours.unit && normUnit(d.unit) !== normUnit(ours.unit)) {
      ok = false;
      why = `unité déf « ${d.unit} » ≠ clone « ${ours.unit} »`;
    }
    if (ok) valuesOk++;
    else
      mismatch.push(
        `${tag} vs clone « ${ours.value} »${ours.unit ? ' ' + ours.unit : ''} — ${why}`,
      );
  }
  return { valuesOk, uncoveredClient, uncoveredOurs, omitted, masked, mismatch };
}

// ==========================================================================
// SUITE 1 — INVENTAIRE + CAPTURES DU HTML CLIENT (référence, file://)
// ==========================================================================

interface ClientInventory {
  title: string;
  brand: string;
  calcButton: string;
  tabs: { tab: string; label: string; active: boolean }[];
  panes: Record<string, unknown>;
  presets: { id: string; label: string }[];
  catalogueFamilies: { group: string; value: string; label: string }[];
}

test.describe('FIDÉLITÉ ROADSENS — inventaire + captures du HTML CLIENT (référence)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    if (!existsSync(DEFINITIVE_HTML)) {
      throw new Error(
        `Définitive ROADSENS ABSENTE (${DEFINITIVE_HTML}). Impossible de cataloguer l'UI ` +
          `de référence — ÉCHEC dur (pas de skip silencieux).`,
      );
    }
    ensureDirs();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', () => {
      /* icônes CDN (tabler) absentes en file:// — sans effet sur le moteur / le DOM */
    });
    await page.goto(pathToFileURL(DEFINITIVE_HTML).href, {
      waitUntil: 'domcontentloaded',
    });
    const globals = await page.evaluate(() => ({
      doCalc: typeof (globalThis as { doCalc?: unknown }).doCalc,
      loadPreset: typeof (globalThis as { loadPreset?: unknown }).loadPreset,
      renderDetails: typeof (globalThis as { renderDetails?: unknown }).renderDetails,
    }));
    expect(globals.doCalc, 'doCalc absent').toBe('function');
    expect(globals.loadPreset, 'loadPreset absent').toBe('function');
    expect(globals.renderDetails, 'renderDetails absent').toBe('function');
  });

  test('given le HTML client, when on catalogue l’UI, then on capture la structure COMPLÈTE (6 onglets, champs, presets, catalogue)', async () => {
    const inv = (await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const attr = (el: Element | null, a: string) =>
        el ? el.getAttribute(a) || '' : '';

      const brand =
        txt(document.querySelector('.brand-name')) +
        ' — ' +
        txt(document.querySelector('.brand-top .tag'));
      const calcButton = txt(document.getElementById('btnc'));
      const tabs = Array.from(document.querySelectorAll('.tnav .tbtn')).map((b) => ({
        tab: attr(b, 'data-tab'),
        label: txt(b),
        active: b.classList.contains('on'),
      }));

      const panes: Record<string, unknown> = {};
      for (const paneEl of Array.from(document.querySelectorAll('.pane'))) {
        const id = attr(paneEl, 'id');
        const sectionTitles = Array.from(paneEl.querySelectorAll('.sec')).map((s) =>
          txt(s),
        );
        const fields = Array.from(paneEl.querySelectorAll('.fld')).map((l) => {
          const input = l.querySelector('input,textarea,select');
          return {
            label: txt(l.querySelector('label')) || txt(l.querySelector('span')),
            id: attr(input, 'id'),
            type: input
              ? (input as HTMLInputElement).type || input.tagName.toLowerCase()
              : '',
            value: input ? (input as HTMLInputElement).value : '',
          };
        });
        const checkboxes = Array.from(
          paneEl.querySelectorAll('input[type="checkbox"]'),
        ).map((c) => {
          const lbl = c.id ? paneEl.querySelector(`label[for="${c.id}"]`) : null;
          return {
            label: txt(lbl) || txt((c.parentElement as Element) ?? null),
            id: (c as HTMLInputElement).id,
            checked: (c as HTMLInputElement).checked,
          };
        });
        const tableHeaders = Array.from(paneEl.querySelectorAll('table')).map((t) =>
          Array.from(t.querySelectorAll('thead th')).map((th) => txt(th)),
        );
        const buttons = Array.from(paneEl.querySelectorAll('button'))
          .map((b) => txt(b))
          .filter(Boolean);
        panes[id] = { sectionTitles, fields, checkboxes, tableHeaders, buttons };
      }

      const presets = Array.from(document.querySelectorAll('#presetSel option'))
        .map((o) => ({ id: (o as HTMLOptionElement).value, label: txt(o) }))
        .filter((p) => p.id);
      const catalogueFamilies: { group: string; value: string; label: string }[] = [];
      for (const og of Array.from(document.querySelectorAll('#catt optgroup'))) {
        const group = attr(og, 'label');
        for (const o of Array.from(og.querySelectorAll('option'))) {
          catalogueFamilies.push({
            group,
            value: (o as HTMLOptionElement).value,
            label: txt(o),
          });
        }
      }
      return {
        title: document.title,
        brand,
        calcButton,
        tabs,
        panes,
        presets,
        catalogueFamilies,
      };
    })) as unknown as ClientInventory;

    // Assertions load-bearing : l'inventaire doit être non vide et fidèle au fichier.
    expect(inv.tabs.map((t) => t.tab)).toEqual(['s', 't', 'p', 'c', 'r', 'd']);
    expect(inv.tabs.map((t) => t.label.replace(/\s+/g, ' ').trim())).toEqual([
      'Structure',
      'Trafic',
      'Paramètres',
      'Catalogue',
      'Résultats',
      'Détails calcul',
    ]);
    expect(
      inv.presets.length,
      'presets « Cas de validation » non vides',
    ).toBeGreaterThanOrEqual(14);
    expect(
      inv.catalogueFamilies.length,
      'catalogue AGEROUTE non vide',
    ).toBeGreaterThanOrEqual(10);

    // ---- Captures par onglet (bascule via classes .on, la routine réelle des .tbtn) ----
    const switchTab = async (tab: string) => {
      await page.evaluate((t) => {
        document.querySelectorAll('.tbtn').forEach((x) => x.classList.remove('on'));
        document.querySelectorAll('.pane').forEach((x) => x.classList.remove('on'));
        document.querySelector(`[data-tab="${t}"]`)?.classList.add('on');
        document.getElementById(`pane-${t}`)?.classList.add('on');
      }, tab);
      await page.waitForTimeout(200);
    };
    for (const [tab, slug] of [
      ['s', '00-structure'],
      ['t', '01-trafic'],
      ['p', '02-parametres'],
      ['c', '03-catalogue'],
    ] as const) {
      await switchTab(tab);
      await page.screenshot({
        path: path.join(CAP_DIR, `roadsens-client-${slug}.png`),
        fullPage: false,
      });
    }

    dumpJson('roadsens-inventaire-client.json', inv);
  });
});

// ==========================================================================
// SUITE 2 — CLONE (iframe) ↔ RÉFÉRENCE : comparaison (classification fermée, dures)
// ==========================================================================
test.describe('FIDÉLITÉ ROADSENS — clone (iframe) ↔ référence', () => {
  test('given le même cas CAS_REF, when calcul serveur intercepté, then #detout + Résultats du clone FIDÈLES à la réf (classification fermée)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(DEFINITIVE_HTML), `Définitive ABSENTE (${DEFINITIVE_HTML}).`).toBe(
      true,
    );
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);
    ensureDirs();

    const st = stateFor(CAS_REF);

    // ---- (b) RÉFÉRENCE (file://) — autonome ----
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const refPage = await refCtx.newPage();
    refPage.on('pageerror', () => {});
    refPage.on('dialog', (d) => void d.accept());
    await refPage.goto(pathToFileURL(DEFINITIVE_HTML).href, {
      waitUntil: 'domcontentloaded',
    });
    const REF = await driveReferenceCase(refPage, st);
    await refPage.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-05-details.png'),
      fullPage: true,
    });
    dumpJson('roadsens-fidelite-reference.json', REF);
    expect(
      REF.rows.length,
      'le rapport Détails de réf (9 sections) ne doit pas être vide',
    ).toBeGreaterThan(25);
    expect(
      REF.results.metrics.length,
      'la réf doit rendre des KPI (.metric)',
    ).toBeGreaterThanOrEqual(3);
    expect(REF.results.verdict, 'la réf doit rendre un verdict').not.toBe('');
    await refCtx.close();

    // ---- (a) SORTIE SERVEUR du cas CAS_REF ----
    const serverOutput = serverOutputFor(CAS_REF);

    // ---- (c) NOTRE CLONE (iframe, calcul intercepté) ----
    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();
    const { intercepted } = await openOurClone(page, serverOutput, token);

    const frame = cloneFrame(page);
    const OURS = await driveCloneCase(page, frame, st);
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-nous-05-details.png'),
      fullPage: true,
    });
    dumpJson('roadsens-fidelite-clone.json', OURS);

    expect(
      intercepted(),
      'la requête de calcul DOIT avoir été interceptée (sinon comparaison invalide)',
    ).toBe(true);
    expect(
      OURS.rows.length,
      'INTÉGRATION : le clone n’a rendu AUCUNE ligne de détail (sortie serveur non livrée au clone ?)',
    ).toBeGreaterThan(25);

    // ---- Recheck CONFIDENTIALITÉ §8 : le HTML servi ne contient aucun symbole moteur ----
    const servedHtml = await page.evaluate(async () => {
      const res = await fetch(
        `/api/tools/roadsens?orgId=${encodeURIComponent('org_rs')}`,
        {
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem('roadsen_access_token')}`,
          },
        },
      );
      return res.text();
    });
    expect(servedHtml.length, 'HTML servi trop court (fetch échoué ?)').toBeGreaterThan(
      10_000,
    );
    expect(servedHtml, 'HTML servi ≠ clone roadsens (bridge absent)').toContain(
      '__geofamBridge',
    );
    const EXCISED_MARKERS = [
      'burIntegrateMLWithPSC',
      'computeBurmister',
      'krLCPC',
      'shLCPC',
      'ksLCPC',
      '__ROADSEN_ENGINE_',
      '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__',
    ];
    const leaks = EXCISED_MARKERS.filter((m) => servedHtml.includes(m));
    expect(
      leaks,
      `symboles moteur EXCISÉS/confidentiels présents dans le HTML servi : ${leaks.join(', ')}`,
    ).toHaveLength(0);

    // ==================================================================
    // COMPARAISON — rapport #detout (classification fermée)
    // ==================================================================
    const cmp = compareDetails(REF.rows, OURS.rows);

    // Résidus fermés §8 (colonne COMMENTAIRE, non comparés en valeur) — tracés.
    const residualsClosed = [
      'S7 st base C{i} : composantes collée (stC) / glissante (stG) — « — » côté clone ' +
        '(non whitelistées) ; NON sollicitées par CAS_REF (aucune couche traitée, rigL vide).',
      'S8 ez sommet couche (non liée) : décomposition axe/e-jum — « — » côté clone ' +
        '(non whitelistées) ; la VALEUR ε_z sommet reste whitelistée et FIDÈLE.',
    ];
    // Redaction assumée de la famille (FUITE #1) — tracée pour honnêteté.
    const refFamille = REF.rows.find(
      (r) => classifyRow(r.section, r.label).key === 'S6.famille',
    );
    const ourFamille = OURS.rows.find(
      (r) => classifyRow(r.section, r.label).key === 'S6.famille',
    );
    const familleRedaction = {
      reference: refFamille?.value ?? null,
      clone: ourFamille?.value ?? null,
      note: 'Le clone affiche le libellé NU d’allowlist (sanitizeFamille) ; la référence y ajoute « (§x.y) »/« K=… » (confidentiel) — redaction VOULUE, comparée hors ces éléments.',
    };

    const summary = {
      case: 'CAS_REF (BBSG1/GB3/GL1 sur PF2, T=150)',
      refRows: REF.rows.length,
      ourRows: OURS.rows.length,
      valuesOk: cmp.valuesOk,
      uncoveredClient: cmp.uncoveredClient,
      uncoveredOurs: cmp.uncoveredOurs,
      omitted: cmp.omitted,
      masked: cmp.masked,
      mismatch: cmp.mismatch,
      residualsClosed,
      familleRedaction,
      refVerdict: REF.results.verdict,
      ourVerdict: OURS.results.verdict,
      refMetrics: REF.results.metrics,
      ourMetrics: OURS.results.metrics,
    };
    dumpJson('roadsens-fidelite-classification.json', summary);
    // eslint-disable-next-line no-console
    console.log('\n[FIDÉLITÉ ROADSENS]\n' + JSON.stringify(summary, null, 2));

    // ==================================================================
    // ASSERTIONS DURES (zéro faux-vert)
    // ==================================================================
    expect(
      cmp.valuesOk,
      'au moins 20 valeurs comparées (sinon extraction/mapping cassé)',
    ).toBeGreaterThan(20);
    expect(
      cmp.uncoveredClient,
      'lignes réf NON classées par le mapping (trou de couverture)',
    ).toHaveLength(0);
    expect(
      cmp.uncoveredOurs,
      'lignes clone NON classées par le mapping (trou de couverture)',
    ).toHaveLength(0);
    expect(
      cmp.masked,
      'lignes « non exposé » restantes côté burmister (DÉFAUT ADR 0014)',
    ).toHaveLength(0);
    expect(cmp.omitted, 'lignes réf OMISES côté clone').toHaveLength(0);
    expect(cmp.mismatch, 'VALEURS/UNITÉS divergentes clone↔réf').toHaveLength(0);

    // ---- Panneau Résultats (verdict + KPI) : fidélité par construction ----
    expect(OURS.results.verdict, 'verdict clone ≠ réf').toBe(REF.results.verdict);
    expect(
      OURS.results.metrics.map((m) => m.value),
      'KPI (.metric) clone ≠ réf',
    ).toEqual(REF.results.metrics.map((m) => m.value));
    expect(
      OURS.results.metrics.map((m) => m.label),
      'libellés KPI clone ≠ réf',
    ).toEqual(REF.results.metrics.map((m) => m.label));

    await ctx.close();
  });
});
