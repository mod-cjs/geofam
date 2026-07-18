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

    it('EQUIVALENCE : le panneau Resultats du clone est IDENTIQUE a la reference gelee', async () => {
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
      applyEssai(cloneWin, fx);
      await cloneWin.doCalc();
      const cloneRes = normalizeRes(
        cloneDom.window.document.getElementById('resCont')?.innerHTML ?? '',
      );
      cloneDom.window.close();

      // REFERENCE : depouillement LOCAL (moteur intact). doCalc y differe renderResults de
      // 80 ms (setTimeout) puis drawResCharts de +120 ms : on attend ~120 ms (renderResults
      // a rendu, drawResCharts pas encore) puis on ferme AVANT l'appel Chart.js.
      const refHtml = readFileSync(pressiometreSourcePath(), 'utf8');
      const refDom = new JSDOM(refHtml, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      });
      const refWin = refDom.window as unknown as CloneWin;
      applyEssai(refWin, fx);
      await refWin.doCalc();
      await new Promise((r) => setTimeout(r, 130));
      const refRes = normalizeRes(
        refDom.window.document.getElementById('resCont')?.innerHTML ?? '',
      );

      // Garde anti faux-vert : la reference DOIT avoir rendu un vrai depouillement.
      expect(
        refRes.length,
        'reference sans depouillement (rendu casse ?)',
      ).toBeGreaterThan(200);
      expect(refRes).toContain('E<sub>M</sub>');
      // ZERO ECART : meme HTML de panneau Resultats (hors canvas dynamiques, normalises).
      expect(cloneRes, 'panneau Resultats clone != reference').toBe(refRes);

      refDom.window.close();
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
