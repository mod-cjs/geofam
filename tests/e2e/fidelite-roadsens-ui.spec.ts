/**
 * FIDÉLITÉ D'INTERFACE ROADSENS — HTML client (référence gelée) ↔ NOTRE app live.
 * ==========================================================================
 *
 * OBJECTIF (distinct de l'équivalence golden-master qui compare des NOMBRES bruts
 * serveur↔HTML — cf. equivalence-burmister-golden.spec.ts) : PRODUIRE LA PREUVE des
 * écarts d'INTERFACE, de FONCTIONNEMENT et d'AFFICHAGE entre l'outil ROADSENS
 * (moteur Burmister) livré par le client et notre portage web. Même dispositif que
 * l'audit GEOPLAQUE (fidelite-geoplaque-ui.spec.ts). Ce spec ne CORRIGE rien : il
 * CATALOGUE + CAPTURE + COMPARE.
 *
 * DISPOSITIF :
 *   1. CLIENT (référence, LECTURE seule) — roadsens_burmister_definitive.html (v2.0.0,
 *      scellé ADR 0013) chargé en file:// dans un vrai Chromium. Inventaire COMPLET de
 *      l'UI : 6 onglets (Structure / Trafic / Paramètres / Catalogue / Résultats /
 *      Détails calcul), champs de chaque pane (libellé/id/type/défaut), tableaux
 *      (couches, fatigue), catalogue AGEROUTE, presets « Cas de validation ». Calcul de
 *      cas de référence (réassignation des bindings ly/pf/tr/cp + doCalc + renderDetails)
 *      pour capturer le panneau Résultats et le rapport Détails (9 sections). Captures
 *      → docs/audits-fidelite/captures/roadsens-client-*.png.
 *   2. NOUS (live) — login geoplaque@starfire.test sur roadsen.vercel.app → org
 *      etude-geoplaque → logiciel ROADSENS. Même inventaire (onglets réels, sections,
 *      champs, boutons). Captures alignées → roadsens-nous-*.png.
 *   3. COMPARAISON DES VALEURS (volet RUN_CALC, consomme du quota, ≤ 6 calculs) : pour
 *      2-3 cas identiques (preset catalogue, saisie par défaut, cas rigide BC), on rend
 *      le rapport Détails des DEUX côtés et on compare CHAQUE ligne (tol rel 1e-6, unités
 *      comprises) via classifyRow — détecteur d'omission ET d'écart.
 *
 * MAPPING À JOUR (ADR 0014, « zéro écart d'affichage », 13/07/2026) : TOUT ce que
 * l'outil client affiche est exposé côté plateforme — kθ/SN/Sh/δ/kr/kc/ks/σ_PSC et
 * « et_adm r=50% » sont désormais des LIGNES-VALEUR (plus « non exposé §8 », plus
 * « absent »). Seul le CODE moteur reste serveur. Toute ligne « non exposé côté client »
 * qui SUBSISTERAIT côté burmister est donc un DÉFAUT, pas un masque voulu.
 *
 * ZÉRO FAUX-VERT : HTML client absent → ÉCHEC DUR (jamais de skip silencieux) ;
 * « 0 ligne extraite » → ÉCHEC DUR ; volet valeurs → API/live injoignable = skip
 * BRUYANT, jamais un pass. Les captures sont des ARTEFACTS de preuve.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE + AFFICHAGE bout-en-bout, PAS la
 * justesse scientifique (responsabilité STARFIRE — split contractuel).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Page } from '@playwright/test';

// --------------------------------------------------------------------------
// Références & cibles
// --------------------------------------------------------------------------

/** Définitive du client (LECTURE SEULE — ne JAMAIS modifier ; scellée v2.0.0). */
const DEFINITIVE_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/roadsens_burmister_definitive.html',
);
const FRONT = 'https://roadsen.vercel.app';
const RS_EMAIL = process.env.RS_EMAIL ?? 'geoplaque@starfire.test';
const RS_PASSWORD = process.env.RS_PASSWORD ?? 'P@sser12345#';
const ORG_SLUG = 'etude-geoplaque';
const RUN_CALC = process.env.RUN_CALC === '1';
const NAV = 120_000;

const CAP_DIR = path.resolve(__dirname, '../../docs/audits-fidelite/captures');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');

function ensureDirs(): void {
  mkdirSync(CAP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
}
function dumpJson(name: string, data: unknown): void {
  ensureDirs();
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// Symboles GLOBAUX de la définitive (bindings lexicaux `let`/fonctions déclarées :
// accessibles en IDENTIFIANTS NUS depuis page.evaluate, JAMAIS via globalThis).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- identifiant NU requis par page.evaluate (globaux de la définitive)
declare let ly: Array<{
  id: number;
  mat: string;
  h: number;
  E: number;
  nu: number;
  ifc: string;
}>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- identifiant NU requis par page.evaluate (globaux de la définitive)
declare let pf: { cls: string; E: number; nu: number };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- identifiant NU requis par page.evaluate (globaux de la définitive)
declare let tr: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- identifiant NU requis par page.evaluate (globaux de la définitive)
declare let cp: {
  p: number;
  a: number;
  d: number;
  r: string;
  sh: string;
  ks: string;
  gntAuto: boolean;
  neForce: number | null;
};
declare function doCalc(): void;
declare function renderDetails(): void;
declare function loadPreset(id: string): void;

// ==========================================================================
// Cas de référence — répliqués en constantes locales (on n'importe PAS
// @roadsen/engines dans un spec e2e). Un cas « manuel » (défauts) + deux presets.
// ==========================================================================

interface BurmisterInput {
  layers: Array<{ mat: string; h: number; E: number; nu: number }>;
  subgrade: { cls: string; E: number; nu: number };
  traffic: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
  load: { p: number; a: number; d: number; r: 'auto'; sh: 'auto'; ks: 'auto' };
  neForce?: number | null;
  gntAuto?: boolean;
}

/** Cas MANUEL bitumineux — structure classique BBSG1/GB3/GL1 sur PF2, T=150. */
const _CAS_MANUEL: BurmisterInput = {
  layers: [
    { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
    { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
    { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
  ],
  subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
  traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
  load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
  neForce: null,
  gntAuto: false,
};

// ==========================================================================
// Extraction DOM du rapport Détails — fonction SÉRIALISÉE (navigateur). Générique :
// même code pour la définitive (#detout table) et pour notre app (table aria-label).
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

// ==========================================================================
// Normalisation & parsing (côté Node) — inchangés (robustes aux deux moteurs de rendu).
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
// MÊME `key`. `kind` : 'value' (à comparer). Depuis « zéro écart » (13/07/2026) il n'y
// a PLUS de 'notexposed' ni de 'absent' côté burmister : tous les coefficients LCPC et
// le « et_adm r=50% » sont exposés. `key === null` ⇒ ligne NON classée = ÉCHEC (omission
// de couverture du mapping — à corriger dans le mapping, PAS un écart d'app).
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
// SUITE 1 — INVENTAIRE + CAPTURES DU HTML CLIENT (référence, file://)
// ==========================================================================

interface ClientInventory {
  title: string;
  brand: string;
  calcButton: string;
  tabs: { tab: string; label: string; active: boolean }[];
  panes: Record<string, PaneFields>;
  presets: { id: string; label: string }[];
  catalogueFamilies: { group: string; value: string; label: string }[];
}
interface PaneFields {
  sectionTitles: string[];
  fields: { label: string; id: string; type: string; value: string }[];
  checkboxes: { label: string; id: string; checked: boolean }[];
  tableHeaders: string[][];
  buttons: string[];
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
    await switchTab('s');
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-00-structure.png'),
      fullPage: false,
    });
    await switchTab('t');
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-01-trafic.png'),
      fullPage: false,
    });
    await switchTab('p');
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-02-parametres.png'),
      fullPage: false,
    });
    await switchTab('c');
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-03-catalogue.png'),
      fullPage: false,
    });

    dumpJson('roadsens-inventaire-client.json', inv);
    console.log('[CLIENT INVENTAIRE]\n' + JSON.stringify(inv, null, 2));
  });

  test('given un preset catalogue, when on le sélectionne, then le calcul est immédiat + bascule Résultats (comportement) et on capture Résultats + Détails', async () => {
    // Comportement clé : loadPreset('s2') pose la structure, appelle doCalc() et
    // BASCULE sur l'onglet Résultats (pane-r .on) — capture ce comportement.
    const beh = await page.evaluate(() => {
      let err: string | null = null;
      try {
        loadPreset('s2');
      } catch (e) {
        err = String((e && (e as Error).message) || e);
      }
      const rActive =
        document.getElementById('pane-r')?.classList.contains('on') ?? false;
      const hasMetric = !!document.querySelector('#resout .metric');
      return { err, rActive, hasMetric };
    });
    expect(beh.err, `loadPreset('s2') doit aboutir : ${beh.err}`).toBeNull();
    expect(
      beh.rActive,
      'la sélection d’un preset doit BASCULER sur l’onglet Résultats',
    ).toBe(true);
    expect(beh.hasMetric, 'le panneau Résultats doit être peuplé (calcul immédiat)').toBe(
      true,
    );

    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-04-resultats.png'),
      fullPage: false,
    });

    // Extraction du panneau Résultats (verdict, métriques, badges de critère).
    const resPanel = await page.evaluate(() => {
      const txt = (el: Element | null) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const out = document.getElementById('resout');
      const metrics = Array.from(out?.querySelectorAll('.metric') ?? []).map((m) => ({
        label: txt(m.querySelector('.ml')),
        value: txt(m.querySelector('.mv')),
        sub: txt(m.querySelector('.ms')),
      }));
      const badges = Array.from(out?.querySelectorAll('.badge') ?? []).map((b) => txt(b));
      const sections = Array.from(out?.querySelectorAll('.sec') ?? []).map((s) => txt(s));
      return { metrics, badges, sections, textLen: txt(out).length };
    });
    expect(
      resPanel.metrics.length,
      'le panneau Résultats client doit exposer des métriques',
    ).toBeGreaterThanOrEqual(3);

    // Détails — bascule pane-d et rends le rapport 9 sections.
    await page.evaluate(() => {
      try {
        renderDetails();
      } catch {
        /* déjà rendu par renderRes */
      }
      document.querySelectorAll('.tbtn').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.pane').forEach((x) => x.classList.remove('on'));
      document.querySelector('[data-tab="d"]')?.classList.add('on');
      document.getElementById('pane-d')?.classList.add('on');
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-client-05-details.png'),
      fullPage: true,
    });

    const det = await page.evaluate(extractReport, '#detout table');
    expect(det.error, `extraction Détails client : ${det.error ?? ''}`).toBeUndefined();
    expect(
      det.rows.length,
      'le rapport Détails client (9 sections) ne doit pas être vide',
    ).toBeGreaterThan(25);
    const sections = Array.from(new Set(det.rows.map((r) => r.section)));

    dumpJson('roadsens-resultats-client.json', {
      preset: 's2',
      resPanel,
      detailSections: sections,
      detailRows: det.rows,
    });
    console.log(
      `[CLIENT preset s2] Résultats=${resPanel.metrics.length} métriques · Détails=${det.rows.length} lignes / ${sections.length} sections`,
    );
  });
});

// ==========================================================================
// SUITE 2 — INVENTAIRE + CAPTURES DE NOTRE APP LIVE (Vercel↔Render)
// ==========================================================================

async function login(page: Page): Promise<void> {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(RS_EMAIL);
  await page.getByLabel('Mot de passe').fill(RS_PASSWORD);
  await Promise.all([
    page.waitForURL(new RegExp(`/app/${ORG_SLUG}/(logiciels|projets)`), { timeout: NAV }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

const OUR_TAB_LABELS = [
  'Structure',
  'Trafic',
  'Paramètres',
  'Catalogue',
  'Résultats',
  'Détails',
];

test.describe('FIDÉLITÉ ROADSENS — inventaire + captures de NOTRE app LIVE', () => {
  test('given l’org etude-geoplaque connectée, when j’ouvre ROADSENS, then on catalogue nos onglets + capture chaque état', async ({
    browser,
  }) => {
    test.setTimeout(400_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);

    await login(page);
    await page.goto(`${FRONT}/app/${ORG_SLUG}/logiciels/roadsens`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await expect(
      page.getByText(
        /couldn.t load|server error|Application error|page n.a pas pu|403|non autorisé/i,
      ),
    ).toHaveCount(0);

    // Onglet Structure présent (role=tab).
    await expect(page.getByRole('tab', { name: 'Structure' })).toBeVisible({
      timeout: 30_000,
    });

    const ourTabs = await page
      .getByRole('tab')
      .allTextContents()
      .then((a) => a.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean));
    console.log('[NOUS onglets live] ' + JSON.stringify(ourTabs));

    await page.screenshot({
      path: path.join(CAP_DIR, 'roadsens-nous-00-vue-globale.png'),
      fullPage: true,
    });

    // Capture par onglet + inventaire des champs visibles de chaque panneau.
    const panesInventory: Record<
      string,
      { headings: string[]; labels: string[]; buttons: string[] }
    > = {};
    let idx = 0;
    for (const label of OUR_TAB_LABELS) {
      const tab = page.getByRole('tab', { name: new RegExp('^' + label, 'i') }).first();
      if (
        await tab
          .count()
          .then((c) => c > 0)
          .catch(() => false)
      ) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(500);
        const slug = label
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        await page.screenshot({
          path: path.join(CAP_DIR, `roadsens-nous-0${idx + 1}-${slug}.png`),
          fullPage: true,
        });
        panesInventory[label] = await page.evaluate(() => {
          const txt = (el: Element | null) =>
            (el?.textContent || '').replace(/\s+/g, ' ').trim();
          const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
          if (!panel) return { headings: [], labels: [], buttons: [] };
          const headings = Array.from(panel.querySelectorAll('h1,h2,h3,h4,strong'))
            .map((h) => txt(h))
            .filter((t) => t.length > 1 && t.length < 80);
          const labels = Array.from(panel.querySelectorAll('label,[aria-label]'))
            .map((l) => txt(l) || l.getAttribute('aria-label') || '')
            .map((s) => s.replace(/\s+/g, ' ').trim())
            .filter((t) => t.length > 1 && t.length < 80);
          const buttons = Array.from(panel.querySelectorAll('button'))
            .map((b) => txt(b))
            .filter((t) => t.length > 1 && t.length < 60);
          return {
            headings: Array.from(new Set(headings)),
            labels: Array.from(new Set(labels)),
            buttons: Array.from(new Set(buttons)),
          };
        });
      }
      idx++;
    }

    dumpJson('roadsens-inventaire-nous.json', { tabs: ourTabs, panes: panesInventory });
    console.log(
      '[NOUS INVENTAIRE live]\n' +
        JSON.stringify({ tabs: ourTabs, panes: panesInventory }, null, 2),
    );

    expect(ourTabs.length, 'notre app doit présenter 6 onglets').toBeGreaterThanOrEqual(
      6,
    );
    await ctx.close();
  });
});

// ==========================================================================
// SUITE 3 — COMPARAISON DES VALEURS (client Détails ↔ notre Détails), RUN_CALC.
// Consomme du quota (≤ 6 calculs). 3 cas : preset s2 (bitumineux), preset s16
// (rigide BC), et un cas MANUEL bitumineux par défaut.
// ==========================================================================

/** Pilote la définitive (file://) pour un preset ou une saisie manuelle → RawRow[]. */
async function computeClientDetails(
  page: Page,
  mode: { kind: 'preset'; id: string } | { kind: 'manual'; input: BurmisterInput },
): Promise<RawRow[]> {
  const res = await page.evaluate(
    (m) => {
      let err: string | null = null;
      try {
        if (m.kind === 'preset') {
          loadPreset(m.id);
        } else {
          const st = m.input;
          ly = st.layers.map((l, i) => ({
            id: i + 1,
            mat: l.mat,
            h: l.h,
            E: l.E,
            nu: l.nu,
            ifc: 'auto',
          }));
          pf = { cls: st.subgrade.cls, E: st.subgrade.E, nu: st.subgrade.nu };
          tr = {
            T: st.traffic.T,
            C: st.traffic.C,
            N: st.traffic.N,
            tau: st.traffic.tau,
            dir: st.traffic.dir,
            tv: st.traffic.tv,
          };
          cp = {
            p: st.load.p,
            a: st.load.a,
            d: st.load.d,
            r: st.load.r,
            sh: st.load.sh,
            ks: st.load.ks,
            gntAuto: st.gntAuto ?? false,
            neForce: st.neForce ?? null,
          };
          doCalc();
        }
        renderDetails();
      } catch (e) {
        err = String((e && (e as Error).message) || e);
      }
      return { err };
    },
    mode as unknown as Record<string, unknown>,
  );
  expect(res.err, `la définitive doit calculer sans lever (err=${res.err})`).toBeNull();
  const out = await page.evaluate(extractReport, '#detout table');
  expect(out.error, `extraction définitive : ${out.error ?? ''}`).toBeUndefined();
  return out.rows;
}

/** Sélectionne un projet existant (ou en crée un) sur la page ROADSENS live. */
async function ensureProject(page: Page): Promise<void> {
  const projetSelect = page.getByLabel('Projet', { exact: true });
  if (
    await projetSelect
      .count()
      .then((c) => c > 0)
      .catch(() => false)
  ) {
    const optionValues = await projetSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    const firstReal = optionValues.find((v) => v && v !== '__new__');
    if (firstReal) {
      await projetSelect.selectOption(firstReal);
    } else {
      await projetSelect.selectOption('__new__');
      await page
        .getByLabel('Nom du nouveau projet')
        .fill(`E2E fidélité ROADSENS ${Date.now()}`);
      await page.getByRole('button', { name: 'Créer' }).click();
      await page.waitForTimeout(2500);
    }
  }
}

/** Rend le rapport Détails de NOTRE app après un calcul, extrait RawRow[]. */
async function extractOurDetails(page: Page): Promise<RawRow[]> {
  await page
    .getByRole('tab', { name: /^Détails/i })
    .first()
    .click();
  const detailsTable = page.locator(
    '[data-testid="tab-details"] table[aria-label="Rapport détaillé ROADSENS — sections numérotées"]',
  );
  await expect(
    detailsTable,
    'le rapport Détails de la plateforme doit être rendu',
  ).toBeVisible({ timeout: 30_000 });
  const out = await page.evaluate(
    extractReport,
    '[data-testid="tab-details"] table[aria-label="Rapport détaillé ROADSENS — sections numérotées"]',
  );
  expect(out.error, `extraction plateforme : ${out.error ?? ''}`).toBeUndefined();
  return out.rows;
}

interface CompareResult {
  valuesOk: number;
  uncoveredClient: string[];
  uncoveredOurs: string[];
  omitted: string[];
  masked: string[];
  mismatch: string[];
}

/** Compare deux rapports Détails via classifyRow (tol rel 1e-6, unités comprises). */
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
      omitted.push(`${tag} — ABSENTE côté plateforme (clé ${c.key}).`);
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
        why = `texte différent (déf « ${d.value} » ≠ plateforme « ${ours.value} »)`;
      }
    } else if (dn.length !== on.length) {
      ok = false;
      why = `nombre de valeurs différent (déf ${JSON.stringify(dn)} ≠ plateforme ${JSON.stringify(on)})`;
    } else {
      for (let i = 0; i < dn.length; i++) {
        const e = relErr(dn[i], on[i]);
        if (e > tol) {
          ok = false;
          why = `valeur[${i}] déf=${dn[i]} plateforme=${on[i]} rel=${e.toExponential(3)} > tol=${tol.toExponential(0)}${isSci ? ' (déf notation sci lossy)' : ''}`;
          break;
        }
      }
    }
    if (ok && d.unit && ours.unit && normUnit(d.unit) !== normUnit(ours.unit)) {
      ok = false;
      why = `unité déf « ${d.unit} » ≠ plateforme « ${ours.unit} »`;
    }
    if (ok) valuesOk++;
    else
      mismatch.push(
        `${tag} vs plateforme « ${ours.value} »${ours.unit ? ' ' + ours.unit : ''} — ${why}`,
      );
  }
  return { valuesOk, uncoveredClient, uncoveredOurs, omitted, masked, mismatch };
}

test.describe('FIDÉLITÉ ROADSENS — comparaison des VALEURS (Détails client ↔ plateforme)', () => {
  test('given RUN_CALC=1, when on rend le rapport Détails des 2 côtés pour 3 cas, then chaque ligne client est mappée + concorde (tol 1e-6)', async ({
    browser,
  }) => {
    test.skip(
      !RUN_CALC,
      'RUN_CALC=1 requis (consomme du quota, ≤ 6 calculs) pour le volet comparaison de valeurs.',
    );
    test.setTimeout(600_000);

    // --- Contexte client (file://) réutilisé pour les 3 cas ---
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const refPage = await refCtx.newPage();
    refPage.on('pageerror', () => {});
    await refPage.goto(pathToFileURL(DEFINITIVE_HTML).href, {
      waitUntil: 'domcontentloaded',
    });

    // --- Contexte live (login une fois, 3 calculs) ---
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);
    await login(page);
    await page.goto(`${FRONT}/app/${ORG_SLUG}/logiciels/roadsens`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});
    await ensureProject(page);

    const _calcBtn = page.getByRole('button', { name: /^Calculer/ }).first();

    const cases: Array<{
      name: string;
      client: { kind: 'preset'; id: string } | { kind: 'manual'; input: BurmisterInput };
      driveOurs: () => Promise<void>;
      capture: string;
    }> = [
      {
        name: 'preset s2 (bitumineux — BBSG/GB3)',
        client: { kind: 'preset', id: 's2' },
        capture: 'roadsens-nous-07-details-s2.png',
        driveOurs: async () => {
          await page
            .getByRole('tab', { name: /^Structure/ })
            .first()
            .click()
            .catch(() => {});
          await page
            .getByLabel('Charger une famille de structure validée')
            .selectOption('s2');
          // Le preset déclenche le calcul serveur + bascule Résultats (handleApplyPreset).
          await page.waitForResponse(
            (r) =>
              /\/calc\/burmister$/.test(new URL(r.url()).pathname) &&
              r.request().method() === 'POST',
            { timeout: 120_000 },
          );
          await page.waitForTimeout(1500);
        },
      },
      {
        name: 'preset s16 (rigide — BC5/BC2)',
        client: { kind: 'preset', id: 's16' },
        capture: 'roadsens-nous-08-details-s16.png',
        driveOurs: async () => {
          await page
            .getByRole('tab', { name: /^Structure/ })
            .first()
            .click()
            .catch(() => {});
          await page
            .getByLabel('Charger une famille de structure validée')
            .selectOption('s16');
          await page.waitForResponse(
            (r) =>
              /\/calc\/burmister$/.test(new URL(r.url()).pathname) &&
              r.request().method() === 'POST',
            { timeout: 120_000 },
          );
          await page.waitForTimeout(1500);
        },
      },
    ];

    const summary: Record<string, CompareResult & { defRows: number; ourRows: number }> =
      {};

    for (const cs of cases) {
      const defRows = await computeClientDetails(refPage, cs.client);
      expect(defRows.length, `Détails client vide pour ${cs.name}`).toBeGreaterThan(25);

      await cs.driveOurs();
      const ourRows = await extractOurDetails(page);
      expect(ourRows.length, `Détails plateforme vide pour ${cs.name}`).toBeGreaterThan(
        25,
      );
      await page.screenshot({ path: path.join(CAP_DIR, cs.capture), fullPage: true });

      const cmp = compareDetails(defRows, ourRows);
      summary[cs.name] = { ...cmp, defRows: defRows.length, ourRows: ourRows.length };
      console.log(
        `\n[COMPARE ${cs.name}] client=${defRows.length} · plateforme=${ourRows.length} lignes` +
          `\n  valeurs conformes : ${cmp.valuesOk}` +
          `\n  lignes « non exposé » restantes côté plateforme (DÉFAUT ADR 0014 si >0) : ${cmp.masked.length}` +
          (cmp.uncoveredClient.length
            ? `\n  NON COUVERTES (client) :\n    - ${cmp.uncoveredClient.join('\n    - ')}`
            : '') +
          (cmp.omitted.length
            ? `\n  OMISES (plateforme) :\n    - ${cmp.omitted.join('\n    - ')}`
            : '') +
          (cmp.mismatch.length
            ? `\n  ÉCARTS DE VALEUR :\n    - ${cmp.mismatch.join('\n    - ')}`
            : '') +
          (cmp.masked.length
            ? `\n  MASQUÉES :\n    - ${cmp.masked.join('\n    - ')}`
            : ''),
      );
    }

    await refCtx.close();
    await ctx.close();
    dumpJson('roadsens-comparaison-valeurs.json', summary);

    // ---- Assertions (zéro faux-vert) ----
    for (const [name, cmp] of Object.entries(summary)) {
      expect(
        cmp.valuesOk,
        `[${name}] au moins 20 valeurs comparées (sinon extraction cassée)`,
      ).toBeGreaterThan(20);
      expect(
        cmp.uncoveredClient,
        `[${name}] lignes client NON classées par le mapping`,
      ).toHaveLength(0);
      expect(
        cmp.masked,
        `[${name}] lignes « non exposé » restantes côté burmister (DÉFAUT ADR 0014)`,
      ).toHaveLength(0);
      expect(cmp.omitted, `[${name}] lignes client OMISES côté plateforme`).toHaveLength(
        0,
      );
      expect(cmp.mismatch, `[${name}] VALEURS/UNITÉS divergentes`).toHaveLength(0);
    }
  });
});
