/**
 * FIDELITE DU CLONE PRESSIOPRO (ADR 0015) — le clone EXCISE, alimente par la SORTIE
 * SERVEUR reelle (runPressiometre / runPressioEtalonnage / runPressioCalibrage), doit
 * RENDRE le depouillement, l'etalonnage et le calibrage fidelement, SANS calcul cote
 * navigateur et SANS fuite d'intermediaire moteur.
 *
 * C'est l'arbitre d'integration (jsdom, sans serveur) : on charge
 * apps/web/src/tools-cloned/pressiopro.html, on BRANCHE un faux hote MULTI-ENGINE qui
 * repond au `calc:request` du bridge en dispatchant sur le bon moteur selon l'engineId
 * (3 slugs), puis on verifie :
 *   1. ESSAI : doCalc async -> renderResults affiche les KPI (E_M/p_L/P_f), le bandeau
 *      categorie, la table des mesures corrigees (phases) — mapping serveur -> _res OK ;
 *   2. ETALONNAGE : calcEtalonnage async -> renderEtalResult affiche Vs/Pe/R² ;
 *   3. CALIBRAGE : calcCalibrage async -> renderCalibResult affiche le coefficient a ;
 *   4. GARDE-FOU R1 (elargissement aForced/aUsed) : le cas d'ecretage affiche « Resultat
 *      non corrige » / « force a 0 » depuis la sortie serveur (jamais recalcule client) ;
 *   5. EQUIVALENCE clone <-> reference gelee (skip si source absente en CI) : le panneau
 *      Resultats du clone est IDENTIQUE a celui de la reference (renderers = ceux de la
 *      reference alimentes par la sortie serveur, equivalente au moteur de la reference) ;
 *   6. NO-CALC-INITIAL : au chargement (etat vide) aucun `calc:request` n'est emis ;
 *   7. aucune fuite ([object Object]/undefined) ni symbole moteur dans le DOM rendu.
 *
 * Skip BRUYANT si le clone est absent (« pnpm clone:tools »).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { runPressioCalibrage } from '../pressio-calibrage/index.js';
import { runPressioEtalonnage } from '../pressio-etalonnage/index.js';

import {
  pressiometreSourceAvailable,
  pressiometreSourcePath,
} from './equivalence-harness.js';
import { PRESSIOMETRE_FIXTURES } from './test-fixtures.js';

import { runPressiometre } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pressiometre -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/pressiopro.html');

// Jeux de demonstration (etalonnage/calibrage) — memes valeurs que loadExempleFictif.
const ETAL_ROWS = [
  { p: 0.2, v15: 524, v30: 525, v60: 525 },
  { p: 0.4, v15: 547, v30: 548, v60: 548 },
  { p: 0.6, v15: 573, v30: 574, v60: 574 },
  { p: 0.8, v15: 605, v30: 606, v60: 606 },
  { p: 1.0, v15: 644, v30: 645, v60: 645 },
  { p: 1.2, v15: 693, v30: 694, v60: 694 },
  { p: 1.4, v15: 754, v30: 755, v60: 755 },
];
const CALIB_ROWS = [
  { p: 1, v15: 1, v30: 1, v60: 1 },
  { p: 3, v15: 2, v30: 2, v60: 2 },
  { p: 5, v15: 3, v30: 3, v60: 3 },
  { p: 8, v15: 4, v30: 4, v60: 4 },
  { p: 11, v15: 5, v30: 6, v60: 6 },
  { p: 14, v15: 7, v30: 7, v60: 7 },
  { p: 17, v15: 8, v30: 9, v60: 9 },
  { p: 20, v15: 10, v30: 10, v60: 10 },
  { p: 23, v15: 11, v30: 12, v60: 12 },
  { p: 26, v15: 13, v30: 13, v60: 13 },
];

type CloneWin = Window &
  typeof globalThis & {
    __geofamBridge: unknown;
    applyData: (d: unknown) => void;
    doCalc: () => Promise<void>;
    calcEtalonnage: () => void;
    calcCalibrage: () => void;
    // Rafraichissements d'en-tete / mesures INDEPENDANTS du calcul (lisent les champs
    // de saisie + depths.rows) : servent a resynchroniser les deux DOM dans un etat
    // UI canonique commun avant comparaison (cf. test EQUIVALENCE OCTET-A-OCTET).
    updateHdr: () => void;
    renderMrows: () => void;
  };

/** Hote MULTI-ENGINE : calc(engineId, params) recalcule cote « serveur » (moteur reel)
 * et renvoie l'enveloppe { ok, output }. Capture les params recus pour verification. */
function installBridge(win: CloneWin): { last: Record<string, unknown> } {
  const captured: Record<string, unknown> = {};
  (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
    calc: (engineId: string, params: unknown) => {
      captured[engineId] = params;
      const env: { ok: boolean; output?: unknown; error?: unknown } =
        engineId === 'pressio-etalonnage'
          ? runPressioEtalonnage(params)
          : engineId === 'pressio-calibrage'
            ? runPressioCalibrage(params)
            : runPressiometre(params);
      return Promise.resolve(
        env.ok
          ? { ok: true, calcResultId: 'test-cr-1', output: env.output }
          : { ok: false, error: env.error },
      );
    },
    emitPv: () => undefined,
    storeGet: () => Promise.resolve(undefined),
    storeSet: () => Promise.resolve(undefined),
    context: () => ({}),
  };
  return { last: captured };
}

/** Charge le clone, branche l'hote, renvoie le DOM + le capteur de params. */
function loadClone(): {
  dom: JSDOM;
  win: CloneWin;
  captured: { last: Record<string, unknown> };
} {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as unknown as CloneWin;
  const captured = installBridge(win);
  return { dom, win, captured };
}

/** Etat essai (une profondeur) charge via applyData (interne au clone). Les params sont
 * ecrits dans le FORMULAIRE (getParams divise `a` par 10 : a interne 0,5 -> saisie 5). */
function applyEssai(win: CloneWin, fx: (typeof PRESSIOMETRE_FIXTURES)[number]): void {
  const p = fx.input.params;
  win.applyData({
    projet: {
      projet: 'Essai clone',
      sondage: 'BH-CLONE',
      a: String(p.a * 10),
      ph: String(p.Ph),
      pe: String(p.Pe),
      v0: String(p.V0),
      k0: String(p.k0),
      gamma: String(fx.input.gamma),
      nappe: String(fx.input.nappe),
    },
    depths: [
      {
        label: fx.input.label,
        pf_idx: fx.input.pf_idx,
        plm_idx: fx.input.plm_idx,
        rows: fx.input.rows,
      },
    ],
  });
}

const hasClone = existsSync(CLONE_PATH);
const d = hasClone ? describe : describe.skip;
if (!hasClone) {
  // eslint-disable-next-line no-console
  console.warn(
    `[clone-render] SKIP : clone absent (${CLONE_PATH}). Lancer « pnpm clone:tools ».`,
  );
}

d(
  'pressiopro — fidelite du clone excise (mapping serveur -> renderers conserves)',
  () => {
    it('ESSAI : rend le depouillement (KPI E_M/p_L, categorie, mesures corrigees) depuis la sortie serveur', async () => {
      const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels');
      expect(fx).toBeDefined();
      if (!fx) return;
      const expected = runPressiometre(fx.input);
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const { dom, win } = loadClone();
      applyEssai(win, fx);
      await win.doCalc();

      const res = dom.window.document.getElementById('resCont')?.innerHTML ?? '';
      // 1. le pont a repondu (plus de placeholder d'attente).
      expect(res).not.toContain('Calcul en cours');
      expect(res.length).toBeGreaterThan(0);
      // 2. KPI E_M et p_L (whitelistés) affiches, aux valeurs SERVEUR (unites d'affichage).
      expect(res).toContain('E<sub>M</sub>');
      expect(res).toContain(expected.output.EM.toFixed(2));
      expect(res).toContain((expected.output.pL * 0.1).toFixed(3));
      // 3. bandeau categorie A–E (libelle serveur).
      expect(res).toContain(expected.output.categorieLibelle);
      expect(res).toMatch(/catb [A-E]/);
      // 4. table des mesures corrigees : au moins une phase pseudo-elastique.
      expect(res).toContain('Pseudo-élast.');
      // 5. aucune fuite grossiere / valeur non definie.
      expect(res).not.toContain('[object Object]');
      expect(res).not.toContain('undefined');
      expect(res).not.toContain('calcDepth');
      dom.window.close();
    });

    it('ETALONNAGE : rend Vs/Pe/R² depuis pressio-etalonnage (pont + mapping)', async () => {
      const expected = runPressioEtalonnage({ rows: ETAL_ROWS });
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const { dom, win, captured } = loadClone();
      win.applyData({ etalRows: ETAL_ROWS });
      win.calcEtalonnage();
      await new Promise((r) => setTimeout(r, 0)); // laisse la Promise du pont se resoudre

      // le clone a bien appele le MOTEUR ETALONNAGE (bon slug).
      expect(
        captured.last['pressio-etalonnage'],
        'slug etalonnage non appele',
      ).toBeDefined();
      const el = dom.window.document.getElementById('etalResult')?.innerHTML ?? '';
      expect(el).not.toContain('Calcul en cours');
      expect(el).toContain('R²');
      expect(el).toContain(expected.output.Vs.toFixed(1));
      expect(el).toContain(expected.output.Pe.toFixed(3));
      expect(el).not.toContain('undefined');
      expect(el).not.toContain('calcEtalonnage(');
      dom.window.close();
    });

    it('CALIBRAGE : rend le coefficient a depuis pressio-calibrage (pont + mapping)', async () => {
      const expected = runPressioCalibrage({ rows: CALIB_ROWS });
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const { dom, win, captured } = loadClone();
      win.applyData({ calibRows: CALIB_ROWS });
      win.calcCalibrage();
      await new Promise((r) => setTimeout(r, 0));

      expect(
        captured.last['pressio-calibrage'],
        'slug calibrage non appele',
      ).toBeDefined();
      const el = dom.window.document.getElementById('calibResult')?.innerHTML ?? '';
      expect(el).not.toContain('Calcul en cours');
      // a affiche en cm³/MPa (a_calib × 10, comme renderCalibResult).
      expect(el).toContain((expected.output.a * 10).toFixed(3));
      expect(el).toContain('R²');
      expect(el).not.toContain('undefined');
      dom.window.close();
    });

    it('GARDE-FOU R1 : « Resultat non corrige / force a 0 » depuis aForced/aUsed (contrat elargi)', async () => {
      const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'borne-a-trop-grand');
      expect(fx).toBeDefined();
      if (!fx) return;
      const expected = runPressiometre(fx.input);
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;
      // pre-condition : le moteur a bien ecrete (aForced) — sinon le test ne prouve rien.
      expect(expected.output.aForced).toBe(true);
      expect(expected.output.aUsed).toBe(0);

      const { dom, win } = loadClone();
      applyEssai(win, fx);
      await win.doCalc();

      const res = dom.window.document.getElementById('resCont')?.innerHTML ?? '';
      // L'avertissement client, alimente par la sortie serveur (jamais recalcule cote clone).
      expect(res).toContain('Résultat non corrigé');
      expect(res).toContain('forcé à 0');
      dom.window.close();
    });

    it('PONT dryRun : bridge.calc(engineId, params, {dryRun:true}) poste un calc:request payload.dryRun=true ; sans opts -> dryRun=false (additif, rétrocompatible)', async () => {
      // On teste le VRAI pont du clone (pas un mock) : on espionne postMessage vers le parent.
      const html = readFileSync(CLONE_PATH, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window as unknown as Window & {
        __geofamBridge: {
          calc: (e: string, p: unknown, o?: unknown) => Promise<unknown>;
        };
      };
      const posted: Array<{ type?: string; payload?: Record<string, unknown> }> = [];
      const parent = dom.window.parent as unknown as {
        postMessage: (m: unknown, o?: string) => void;
      };
      parent.postMessage = (m: unknown) =>
        posted.push(m as { type?: string; payload?: Record<string, unknown> });

      void win.__geofamBridge.calc('pressiometre', { rows: [] }, { dryRun: true });
      void win.__geofamBridge.calc('pressiometre', { rows: [] });

      const reqs = posted.filter((m) => m?.type === 'calc:request');
      expect(reqs.length, 'le pont n a pas posté 2 calc:request').toBe(2);
      // 1er appel = APERÇU (dryRun:true) ; 2e = calcul PERSISTANT (dryRun:false).
      expect(reqs[0]!.payload?.dryRun, 'opts.dryRun non transmis par le pont').toBe(true);
      expect(reqs[1]!.payload?.dryRun, 'un appel sans opts doit rester persistant').toBe(
        false,
      );
      dom.window.close();
    });

    it('APERÇU E_M (updateSeuilPreview) : émet le calc via le pont AVEC dryRun=true (aucun calcul persistant/facturé/scellable) — vs doCalc PERSISTANT', async () => {
      const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels')!;
      const html = readFileSync(CLONE_PATH, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window as unknown as CloneWin & {
        updateSeuilPreview: () => void;
        setTimeout: (fn: () => void, ms?: number) => number;
      };
      // Pont capteur : enregistre l'engineId, les params ET les OPTIONS (3ᵉ arg) reçus.
      const calls: Array<{ engineId: string; opts: unknown }> = [];
      (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
        calc: (engineId: string, params: unknown, opts?: unknown) => {
          calls.push({ engineId, opts: opts ?? null });
          const env = runPressiometre(params);
          return Promise.resolve(
            env.ok
              ? { ok: true, calcResultId: 'cr-1', output: env.output }
              : { ok: false },
          );
        },
        emitPv: () => undefined,
        snapshot: () => undefined,
        storeGet: () => Promise.resolve(undefined),
        storeSet: () => Promise.resolve(undefined),
        context: () => ({}),
      };
      applyEssai(win, fx);
      const setSel = (id: string, v: number): void => {
        const el = dom.window.document.getElementById(id) as HTMLSelectElement | null;
        if (el) el.value = String(v);
      };
      setSel('sel_pf', fx.input.pf_idx ?? 2);
      setSel('sel_plm', fx.input.plm_idx ?? 5);
      // L'aperçu est débouncé (~300 ms). Sous jsdom, ce timer est fragile (re-rendus
      // asynchrones concurrents). On rend l'HORLOGE de debounce DÉTERMINISTE : le
      // callback ~300 ms s'exécute immédiatement. On ne teste QUE le contenu de l'appel
      // (le débounce lui-même est un détail temporel, hors périmètre de cette assertion).
      const realSetTimeout = win.setTimeout.bind(win);
      (win as unknown as { setTimeout: unknown }).setTimeout = (
        fn: () => void,
        ms?: number,
      ): number => {
        if ((ms ?? 0) >= 250 && (ms ?? 0) <= 350) {
          fn();
          return 0;
        }
        return realSetTimeout(fn, ms);
      };
      win.updateSeuilPreview();
      (win as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;

      const preview = calls.find((c) => c.engineId === 'pressiometre');
      expect(preview, "updateSeuilPreview n'a pas émis de calc").toBeDefined();
      expect(
        (preview!.opts as { dryRun?: boolean } | null)?.dryRun,
        'aperçu E_M NON marqué dryRun (persisté/facturé/scellable = finding revue adverse)',
      ).toBe(true);
      // Aucun calcResultId scellable posé par un aperçu.
      expect(
        (win as unknown as { __pressioLastCalcResultId: unknown })
          .__pressioLastCalcResultId,
      ).toBeNull();

      // CONTRE-ÉPREUVE : un dépouillement RÉEL (doCalc) reste PERSISTANT (opts absent /
      // dryRun non vrai) et pose bien un calcResultId scellable — l'un ne contamine pas l'autre.
      calls.length = 0;
      await win.doCalc();
      const real = calls.find((c) => c.engineId === 'pressiometre');
      expect(real, 'doCalc doit émettre un calc').toBeDefined();
      expect(
        (real!.opts as { dryRun?: boolean } | null)?.dryRun === true,
        'doCalc marqué dryRun (un calcul réel ne doit pas être un aperçu)',
      ).toBe(false);
      expect(
        (win as unknown as { __pressioLastCalcResultId: unknown })
          .__pressioLastCalcResultId,
      ).toBe('cr-1');
      dom.window.close();
    });

    it('EQUIVALENCE OCTET-A-OCTET : les 8 pages .pg du clone sont IDENTIQUES a la reference gelee', async () => {
      if (!pressiometreSourceAvailable()) {
        // eslint-disable-next-line no-console
        console.warn('[clone-render] SKIP equivalence : source gelee absente (CI).');
        return;
      }
      const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels');
      if (!fx) return;
      const expected = runPressiometre(fx.input);
      if (!expected.ok) return;

      // CLONE : depouillement via le pont (moteur reel). renderResults est SYNCHRONE ici
      // (pas de setTimeout) : on capture juste apres l'await, PUIS on ferme le DOM pour
      // annuler le timer drawResCharts (+120 ms) qui appellerait Chart.js (absent en jsdom).
      const { dom: cloneDom, win: cloneWin } = loadClone();
      // Laisser l'init AU CHARGEMENT du clone se stabiliser AVANT d'appliquer l'essai :
      // le clone execute son init differee (renderMrows/updateHdr/placeholders) qui,
      // sinon, ECRASE applyData pendant l'await de doCalc. La reference, dont l'init
      // avorte sur l'acces localStorage (origine opaque jsdom), n'en a pas besoin — le
      // wait symetrique est neutre pour elle.
      await new Promise((r) => setTimeout(r, 100));
      applyEssai(cloneWin, fx);
      await cloneWin.doCalc();
      const clonePages = readAllPages(cloneDom);
      cloneDom.window.close();

      // REFERENCE : depouillement LOCAL (moteur intact). doCalc y differe renderResults de
      // 80 ms (setTimeout) puis drawResCharts de +120 ms : on attend ~130 ms (renderResults
      // a rendu, drawResCharts pas encore) puis on ferme AVANT l'appel Chart.js.
      const refHtml = readFileSync(pressiometreSourcePath(), 'utf8');
      const refDom = new JSDOM(refHtml, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      });
      const refWin = refDom.window as unknown as CloneWin;
      await new Promise((r) => setTimeout(r, 100));
      applyEssai(refWin, fx);
      await refWin.doCalc();
      await new Promise((r) => setTimeout(r, 130));
      const refPages = readAllPages(refDom);
      refDom.window.close();

      for (const id of PG_IDS) {
        // readAllPages remplit TOUJOURS les 8 cles (cf. boucle sur PG_IDS) -> `!` sur.
        const ref = refPages[id]!;
        const clone = clonePages[id]!;
        // Anti-vacuite : la reference DOIT avoir rendu un contenu reel sur CHAQUE page
        // (pages alimentees par l'essai) ou son placeholder (pages conditionnelles) —
        // jamais une chaine vide qui rendrait l'egalite trivialement vraie.
        expect(
          ref.length,
          `page ${id} vide cote reference (rendu casse ?)`,
        ).toBeGreaterThan(PG_FLOOR[id]);
        // ZERO ECART : meme HTML de page (canvas dynamiques vides des deux cotes, normalises).
        // Pages conditionnelles (etalon/calibrage/profil non declenchees par un simple
        // essai) : le PLACEHOLDER est identique des deux cotes -> egalite valable aussi.
        expect(clone, `page ${id} du clone != reference gelee`).toBe(ref);
      }
      // Ancrage semantique fort : la page Resultats porte bien le depouillement.
      expect(refPages['pg-resultats']!).toContain('E<sub>M</sub>');
    });

    it('NO-CALC-INITIAL : au chargement (etat vide) aucun calc:request emis', async () => {
      const html = readFileSync(CLONE_PATH, 'utf8');
      const posted: unknown[] = [];
      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(window) {
          const orig = window.postMessage.bind(window);
          (window as unknown as { postMessage: unknown }).postMessage = (
            ...args: unknown[]
          ) => {
            posted.push(args[0]);
            return (orig as (...a: unknown[]) => unknown)(...args);
          };
        },
      });
      await new Promise((r) => setTimeout(r, 40));
      const calcRequests = posted.filter(
        (m) => (m as { type?: string })?.type === 'calc:request',
      );
      expect(calcRequests, 'un calc:request a fuite au chargement').toHaveLength(0);
      dom.window.close();
    });
  },
);

/** Normalise le panneau Resultats pour la comparaison clone<->reference : retire les
 * espaces non signifiants (le contenu des <canvas> reste vide dans les deux — dessine par
 * Chart.js absent en jsdom). */
function normalizeRes(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

/** Les 8 pages .pg de la note PressioPro, dans l'ordre de l'outil (onglets). */
const PG_IDS = [
  'pg-projet',
  'pg-log',
  'pg-etalon',
  'pg-calibrage',
  'pg-mesures',
  'pg-resultats',
  'pg-profil',
  'pg-export',
] as const;

/**
 * Plancher anti-vacuite (octets d'innerHTML normalise) par page. Verrouille qu'une
 * egalite clone==reference ne soit JAMAIS trivialement vraie sur une page vide.
 * Valeurs mesurees sur la reference gelee (marge de securite dessous) ; les pages
 * CONDITIONNELLES non declenchees par un simple essai (etalon/calibrage/profil)
 * restent a leur placeholder — non vide, mais plus court que les pages alimentees.
 */
const PG_FLOOR: Record<(typeof PG_IDS)[number], number> = {
  'pg-projet': 2000,
  'pg-log': 200,
  'pg-etalon': 200,
  'pg-calibrage': 200,
  'pg-mesures': 500,
  'pg-resultats': 2000,
  'pg-profil': 200,
  'pg-export': 500,
};

/** innerHTML NORMALISE de chacune des 8 pages .pg (comparaison stable clone<->ref).
 *
 * Neutralise le WIDGET LIVE `#seuilPreview` (apercu E_M de la page Mesures) : son
 * CONTENU dynamique est excise cote clone (calcul local -> apercu asynchrone via le
 * pont, dryRun) et rendu SYNCHRONE cote reference — divergence attendue, verifiee par
 * le test dedie « APERCU E_M (updateSeuilPreview) ... dryRun ». Sa STRUCTURE (le
 * conteneur, present des deux cotes) reste comparee ; seul son inner dynamique est
 * remis a un placeholder identique. Toute autre divergence de la page reste detectee. */
function readAllPages(dom: JSDOM): Record<string, string> {
  const preview = dom.window.document.getElementById('seuilPreview');
  if (preview) preview.innerHTML = '';
  const out: Record<string, string> = {};
  for (const id of PG_IDS) {
    out[id] = normalizeRes(dom.window.document.getElementById(id)?.innerHTML ?? '');
  }
  return out;
}

// ===========================================================================
// CAPTURE OPTION-3 (snapshot:capture) — le pont PRESSIOPRO scelle le DOCUMENT
// (la NOTE que « Imprimer / PDF » produit : TOUTES les pages .pg via @media print)
// APRES un calcul REUSSI (garde §5). §8 (politique 26/07) : la note ne porte que des
// valeurs AFFICHEES par l'outil (rendues depuis la sortie serveur whitelistee) ; toutes
// les figures (chartPV/EM/PLM/Spec/Etal/Calib) sont des <svg> INLINE (aucune
// rasterisation), l'HTML est INERTE. ZERO FAUX-VERT : sans le cablage (snapshot /
// __pressioproCaptureSnapshot / appel en fin de calcul), `caps` reste vide -> ECHEC.
// ===========================================================================

const REPO = resolve(HERE, '../../../..');
// sha256 scelle au registre (pressiometre-menard) — cf. TOOLS.pressiopro.expectedSha256.
const REF_SHA256 = 'b5a06e1c34e1928b06a3e9dcd5628d516ba7d0d2818a67c62bdb43e93c65e4dc';

type Cap = { displayHtml: string; printHtml: string };

/** Passe un HTML dans la VRAIE garde §8 serveur (assertInertHtml) via le runner
 *  scripts/assert-inert-run.mts — jamais une copie des regles. Sur octets REELS. */
function guardInert(html: string): { ok: boolean; error?: string } {
  const raw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
    input: html,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw) as { ok: boolean; error?: string };
}

/** Boote le clone avec un pont CAPTEUR multi-engine (calc via moteur reel + snapshot),
 *  applique un essai, pilote doCalc, renvoie les captures + la fenetre. `xform` permet de
 *  muter la sortie serveur (sanity-mutation / injection d'erreur en bande). */
async function captureEssai(
  fx: (typeof PRESSIOMETRE_FIXTURES)[number],
  xform?: (out: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ caps: Cap[]; win: CloneWin; dom: JSDOM }> {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as unknown as CloneWin;
  const caps: Cap[] = [];
  (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
    calc: (engineId: string, params: unknown) => {
      const env =
        engineId === 'pressio-etalonnage'
          ? runPressioEtalonnage(params)
          : engineId === 'pressio-calibrage'
            ? runPressioCalibrage(params)
            : runPressiometre(params);
      if (!env.ok) return Promise.resolve({ ok: false, error: env.error });
      const out = xform
        ? xform(env.output as Record<string, unknown>)
        : (env.output as Record<string, unknown>);
      return Promise.resolve({ ok: true, calcResultId: 'cap-pp-1', output: out });
    },
    emitPv: () => undefined,
    snapshot: (displayHtml: string, printHtml: string) =>
      caps.push({
        displayHtml: String(displayHtml || ''),
        printHtml: String(printHtml || ''),
      }),
    storeGet: () => Promise.resolve(undefined),
    storeSet: () => Promise.resolve(undefined),
    context: () => ({}),
  };
  applyEssai(win, fx);
  await win.doCalc();
  await new Promise((r) => setTimeout(r, 15));
  return { caps, win, dom };
}

/** Extrait le fragment <svg> d'aria-label donne dans un HTML capture (isole une figure). */
function svgByLabel(html: string, label: string): string {
  const marker = `aria-label="${label}"`;
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<svg', at);
  const end = html.indexOf('</svg>', at);
  return start < 0 || end < 0 ? '' : html.slice(start, end + 6);
}

/** cx des cercles de mesure (class="ppt") d'un fragment SVG, dans l'ordre du DOM. */
function pptCx(svg: string): number[] {
  const out: number[] = [];
  const re = /class="ppt"[^>]*cx="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) out.push(Number(m[1]));
  return out;
}

/** Nombre de sommets (commandes M/L) du 1er <path> d'un fragment SVG (la courbe tracée). */
function pathVertexCount(svg: string): number {
  const m = svg.match(/<path d="([^"]*)"/);
  if (!m) return 0;
  return ((m[1] ?? '').match(/[ML]/g) ?? []).length;
}

const capD = hasClone ? describe : describe.skip;

capD(
  'pressiopro — capture option-3 de la note (§8 inerte, garde §5, equivalence, courbes SVG)',
  () => {
    const essaiFx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels')!;

    it('given un depouillement REUSSI, when doCalc() se termine, then le pont emet snapshot:capture (display + print) NON vide et auto-contenu', async () => {
      const env = runPressiometre(essaiFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const { caps, dom } = await captureEssai(essaiFx);
      expect(
        caps.length,
        'aucune capture emise (cablage snapshot absent ?)',
      ).toBeGreaterThan(0);
      const cap = caps[caps.length - 1]!;
      expect(cap.printHtml.length, 'printHtml vide').toBeGreaterThan(2000);
      expect(cap.printHtml, 'printHtml non auto-contenu').toContain('<!doctype html>');
      expect(cap.printHtml, 'CSS non inline').toContain('<style>');
      // La note porte les KPI du depouillement (E_M) + le bandeau categorie.
      expect(cap.printHtml, 'E_M absent de la note').toContain(env.output.EM.toFixed(2));
      expect(cap.printHtml, 'categorie absente de la note').toContain(
        env.output.categorieLibelle,
      );
      // displayHtml auto-contenu aussi.
      expect(cap.displayHtml.length, 'displayHtml vide').toBeGreaterThan(2000);
      expect(cap.displayHtml, 'displayHtml non auto-contenu').toContain(
        '<!doctype html>',
      );
      dom.window.close();
    });

    it('given les HTML REELLEMENT captures, when passes dans la VRAIE garde §8 (assertInertHtml), then ACCEPTES (aucun script/handler/canvas/URI data:)', async () => {
      const { caps, dom } = await captureEssai(essaiFx);
      const cap = caps[caps.length - 1]!;
      expect(/<script\b/i.test(cap.printHtml), 'printHtml contient <script>').toBe(false);
      expect(/<canvas\b/i.test(cap.printHtml), 'printHtml contient un <canvas>').toBe(
        false,
      );
      expect(
        /<[a-zA-Z][^>]*\son\w+\s*=/i.test(cap.printHtml),
        'handler inline present',
      ).toBe(false);
      // On cible une FIGURE rasterisee (src=data:), pas les url(data:image/svg+xml) legitimes
      // du CSS client (fleche de <select>). La garde §8 serveur (guardInert) reste l'arbitre.
      expect(
        /src\s*=\s*["']?\s*data:/i.test(cap.printHtml),
        'figure rasterisee (src=data:) presente',
      ).toBe(false);
      // La note DOIT porter au moins une figure SVG (courbe P-V redessinee).
      expect(/<svg\b/i.test(cap.printHtml), 'aucune figure SVG dans la note').toBe(true);
      const gPrint = guardInert(cap.printHtml);
      expect(gPrint.ok, `garde §8 REFUSE le printHtml : ${gPrint.error ?? ''}`).toBe(
        true,
      );
      const gDisp = guardInert(cap.displayHtml);
      expect(gDisp.ok, `garde §8 REFUSE le displayHtml : ${gDisp.error ?? ''}`).toBe(
        true,
      );
      dom.window.close();
    });

    it('EQUIVALENCE clone<->reference client : meme jeu de PAGES (.pg) + memes valeurs affichees (E_M, categorie) que la note du HTML gele', async () => {
      if (!pressiometreSourceAvailable()) {
        // eslint-disable-next-line no-console
        console.warn(
          '[clone-render] capture SKIP equivalence : source gelee absente (CI).',
        );
        return;
      }
      // La reference (HTML gele) DOIT etre la version scellee au registre (echec DUR).
      const refBuf = readFileSync(pressiometreSourcePath());
      const actualSha = createHash('sha256').update(refBuf).digest('hex');
      expect(
        actualSha,
        'SHA-256 reference pressiometre != registre (version divergente)',
      ).toBe(REF_SHA256);
      // Jeu de pages de la reference (toutes les .pg imprimees via @media print).
      const refDom = new JSDOM(refBuf.toString('utf8'), {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      });
      const refPgIds = Array.from(refDom.window.document.querySelectorAll('.pg'))
        .map((p) => (p as HTMLElement).id)
        .filter(Boolean)
        .sort();
      refDom.window.close();
      expect(refPgIds.length, 'reference sans pages .pg').toBeGreaterThanOrEqual(8);

      const env = runPressiometre(essaiFx.input);
      if (!env.ok) return;
      const { caps, dom } = await captureEssai(essaiFx);
      const cap = caps[caps.length - 1]!;
      // 1. Jeu de pages IDENTIQUE : la note du clone porte les MEMES .pg que le client.
      for (const id of refPgIds) {
        expect(cap.printHtml, `page ${id} absente de la note du clone`).toContain(
          `id="${id}"`,
        );
      }
      // 2. Valeurs affichees IDENTIQUES (arbitre : sortie serveur, prouvee equivalente au
      //    HTML d'origine par engine.equivalence.test) : E_M + categorie.
      expect(cap.printHtml).toContain(env.output.EM.toFixed(2));
      expect(cap.printHtml).toContain(env.output.categorieLibelle);
      dom.window.close();
    });

    it('GARDE §5 (essai, erreur EN BANDE output.erreur) : AUCUNE capture n est emise', async () => {
      // runPressiometre encode ses erreurs de garde dans output.erreur (ok:true). La note
      // d'un document d'erreur ne doit JAMAIS etre scellee. Mutation : deplacer l'appel de
      // capture avant le « if(out.erreur) return » rendrait ce test ROUGE.
      const { caps, win } = await captureEssai(essaiFx, (out) => ({
        ...out,
        erreur: 'Plage pseudo-élastique invalide.',
      }));
      expect(
        caps.length,
        'une capture a ete emise sur une erreur en bande (garde §5 KO)',
      ).toBe(0);
      const res = win.document.getElementById('resCont')?.innerHTML ?? '';
      expect(res).toMatch(/Calcul indisponible|invalide/);
      win.close?.();
    });

    it('DETERMINISTE : deux captures du MEME calcul produisent un printHtml identique (aucune horloge/hasard)', async () => {
      const a = await captureEssai(essaiFx);
      const b = await captureEssai(essaiFx);
      expect(a.caps[a.caps.length - 1]!.printHtml).toBe(
        b.caps[b.caps.length - 1]!.printHtml,
      );
      a.dom.window.close();
      b.dom.window.close();
    });

    it('COURBE P-V : la note porte le <svg> chartPV avec un cercle de mesure (class ppt) par palier, aux abscisses de la transformee client (donnees fideles) + sanity-mutation', async () => {
      const env = runPressiometre(essaiFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const courbe = (env.output as { courbe?: Array<{ pCorr: number }> }).courbe ?? [];
      expect(courbe.length, 'la fixture doit produire une courbe').toBeGreaterThan(3);

      const { caps, dom } = await captureEssai(essaiFx);
      const svg = svgByLabel(
        caps[caps.length - 1]!.printHtml,
        'Courbe pressiometrique P-V et fluage',
      );
      expect(svg.length, 'SVG chartPV absent de la note').toBeGreaterThan(50);
      const cx = pptCx(svg);
      // 1. Un cercle de mesure par palier de la courbe serveur (fidelite du nombre de points).
      expect(cx.length, 'nb de points mesures != longueur de la courbe serveur').toBe(
        courbe.length,
      );
      // 2. DONNEES FIDELES : abscisse (X) = transformee client repliquee ici. X ne depend que
      //    de P=pCorr*0,1 et de pMax=pL*0,1*1,4 (arbitre independant, non vacu).
      const W = 760,
        mL = 54,
        mR = 54;
      const pMax = (env.output.pL as number) * 0.1 * 1.4;
      const pxOf = (p: number): number =>
        Math.round((mL + (p / pMax) * (W - mL - mR)) * 100) / 100;
      courbe.forEach((c, i) => {
        expect(cx[i], `abscisse du point ${i} != transformee client`).toBeCloseTo(
          pxOf(c.pCorr * 0.1),
          2,
        );
      });
      // 3. SANITY-MUTATION : tronquer la courbe d'un palier DIMINUE le nombre de cercles.
      const mut = await captureEssai(essaiFx, (out) => ({
        ...out,
        courbe: (out.courbe as unknown[]).slice(0, -1),
      }));
      const cxMut = pptCx(
        svgByLabel(
          mut.caps[mut.caps.length - 1]!.printHtml,
          'Courbe pressiometrique P-V et fluage',
        ),
      );
      expect(
        cxMut.length,
        'muter la courbe n a pas change le trace (donnees non branchees ?)',
      ).toBe(courbe.length - 1);
      dom.window.close();
      mut.dom.window.close();
    });

    it('COURBE ETALONNAGE : le calcul etalonnage capture une note avec le <svg> chartEtal (un point ppt par palier saisi) + sanity-mutation', async () => {
      const expected = runPressioEtalonnage({ rows: ETAL_ROWS });
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const html = readFileSync(CLONE_PATH, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window as unknown as CloneWin;
      const caps: Cap[] = [];
      (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
        calc: (engineId: string, params: unknown) =>
          Promise.resolve(
            engineId === 'pressio-etalonnage'
              ? (() => {
                  const e = runPressioEtalonnage(params);
                  return e.ok
                    ? { ok: true, calcResultId: 'cap-etal', output: e.output }
                    : { ok: false, error: e.error };
                })()
              : { ok: false, error: { message: 'engine inattendu' } },
          ),
        emitPv: () => undefined,
        snapshot: (d: string, p: string) =>
          caps.push({ displayHtml: String(d || ''), printHtml: String(p || '') }),
        storeGet: () => Promise.resolve(undefined),
        storeSet: () => Promise.resolve(undefined),
        context: () => ({}),
      };
      win.applyData({ etalRows: ETAL_ROWS });
      win.calcEtalonnage();
      await new Promise((r) => setTimeout(r, 20));

      expect(
        caps.length,
        'aucune capture emise apres un etalonnage reussi',
      ).toBeGreaterThan(0);
      const svg = svgByLabel(
        caps[caps.length - 1]!.printHtml,
        'Courbe d etalonnage V=f(P)',
      );
      expect(svg.length, 'SVG chartEtal absent de la note').toBeGreaterThan(50);
      expect(pptCx(svg).length, 'nb points etalonnage != nb paliers saisis').toBe(
        ETAL_ROWS.length,
      );
      dom.window.close();
    });

    it('COURBE CALIBRAGE : le <svg> chartCalib reproduit FIDÈLEMENT le tracé (bugué) de drawCalibChart du client — points mesurés INVISIBLES (y=r.pc inexistant), courbe balayée sur les VOLUMES + filtre pc>=0, axe X mal-titré « Pression P (bar) »', async () => {
      const expected = runPressioCalibrage({ rows: CALIB_ROWS });
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const html = readFileSync(CLONE_PATH, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window as unknown as CloneWin;
      const caps: Cap[] = [];
      (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
        calc: (engineId: string, params: unknown) =>
          Promise.resolve(
            engineId === 'pressio-calibrage'
              ? (() => {
                  const e = runPressioCalibrage(params);
                  return e.ok
                    ? { ok: true, calcResultId: 'cap-calib', output: e.output }
                    : { ok: false, error: e.error };
                })()
              : { ok: false, error: { message: 'engine inattendu' } },
          ),
        emitPv: () => undefined,
        snapshot: (d: string, p: string) =>
          caps.push({ displayHtml: String(d || ''), printHtml: String(p || '') }),
        storeGet: () => Promise.resolve(undefined),
        storeSet: () => Promise.resolve(undefined),
        context: () => ({}),
      };
      win.applyData({ calibRows: CALIB_ROWS });
      win.calcCalibrage();
      await new Promise((r) => setTimeout(r, 20));

      expect(
        caps.length,
        'aucune capture emise apres un calibrage reussi',
      ).toBeGreaterThan(0);
      const svg = svgByLabel(
        caps[caps.length - 1]!.printHtml,
        'Courbe de calibrage Pc=f(V)',
      );
      expect(svg.length, 'SVG chartCalib absent de la note').toBeGreaterThan(50);
      // 1. FIDÉLITÉ AU BUG : les points mesurés sont mappés {x:r.v, y:r.pc} avec r.pc
      //    INEXISTANT côté client -> AUCUN cercle de mesure (class ppt) n'est tracé. La
      //    version « corrigée » (un ppt par palier) est INTERDITE (décision titulaire).
      expect(
        pptCx(svg).length,
        'des points de mesure sont tracés — la version corrigée a été réintroduite',
      ).toBe(0);
      // 2. Axe X mal-titré comme le client (l'abscisse est un volume, le titre dit « Pression »).
      expect(svg, 'axe X non conforme au client').toContain('Pression P (bar)');
      expect(svg, 'axe Y non conforme au client').toContain('Volume V60 (cm3)');
      // 3. La « courbe ajustée » = balayage EXACT du client sur les VOLUMES (vMin=min(v)-20 ..
      //    vMax=max(v)+50, 61 pas, filtre pc>=0). On reproduit ici la logique cliente et on
      //    compare le nombre de sommets tracés (non vacue : reflète le filtre pc>=0).
      const vs = CALIB_ROWS.map((r) => r.v60);
      const vMin = Math.min(...vs) - 20;
      const vMax = Math.max(...vs) + 50;
      const { c0, c1, c2 } = expected.output;
      let expectedVerts = 0;
      for (let i = 0; i <= 60; i++) {
        const v = vMin + ((vMax - vMin) * i) / 60;
        const pc = c0 + c1 * v + c2 * v * v;
        if (pc >= 0) expectedVerts += 1;
      }
      expect(
        pathVertexCount(svg),
        'nb de sommets de la courbe != balayage client (filtre pc>=0)',
      ).toBe(expectedVerts);
      // Garde anti-vacuité : la fixture DOIT produire une courbe non triviale.
      expect(expectedVerts, 'fixture calibrage sans courbe (test creux)').toBeGreaterThan(
        1,
      );
      // 4. DOMAINE X (minor revue) : le canvas client fixe x.min=vMin. Le SVG dérive le
      //    domaine X de la seule courbe tracée (origine=vMin, borne haute=dernier v avec
      //    pc>=0). On verrouille l'ORIGINE du domaine à vMin (graduation la plus à gauche) —
      //    tolérance app==PV actée explicitement : la borne HAUTE suit la courbe clippée
      //    (pc>=0), fidèle au tracé bugué (jamais une reconstruction cohérente).
      expect(
        svg,
        'graduation X de gauche != vMin (domaine X non conforme au canvas client)',
      ).toContain(`>${vMin.toFixed(1)}</text>`);
      dom.window.close();
    });

    it('GARDE §5 (calibrage, erreur HORS bande resp.ok=false) : AUCUNE capture n est emise', async () => {
      const html = readFileSync(CLONE_PATH, 'utf8');
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
      const win = dom.window as unknown as CloneWin;
      const caps: Cap[] = [];
      (win as unknown as { __geofamBridge: unknown }).__geofamBridge = {
        calc: () =>
          Promise.resolve({ ok: false, error: { message: 'points insuffisants' } }),
        emitPv: () => undefined,
        snapshot: (d: string, p: string) =>
          caps.push({ displayHtml: String(d || ''), printHtml: String(p || '') }),
        storeGet: () => Promise.resolve(undefined),
        storeSet: () => Promise.resolve(undefined),
        context: () => ({}),
      };
      win.applyData({ calibRows: CALIB_ROWS });
      win.calcCalibrage();
      await new Promise((r) => setTimeout(r, 20));
      expect(caps.length, 'capture emise sur une erreur hors bande (garde §5 KO)').toBe(
        0,
      );
      dom.window.close();
    });
  },
);
