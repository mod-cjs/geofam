/**
 * FIDELITE DU CLONE geoplaque (ADR 0015) — le clone EXCISE, alimente par la SORTIE
 * SERVEUR reelle (runRadier / runPlaneStrain), doit RENDRE les diagnostics EC7, la
 * synthese et la cartographie fidelement, SANS calcul cote navigateur et SANS fuite
 * d'intermediaire moteur (4 solveurs EF, algebre dense, maillage).
 *
 * ARBITRE : la sortie SERVEUR (le contrat radier/plane-strain est deja prouve
 * equivalent au HTML d'origine par engine.equivalence.test — c'est l'arbitre
 * module<->origine). ICI on prouve que le clone RENDER la sortie serveur SANS la
 * deformer et SANS recalculer : mapping fidele + carto = grille 48x48 serveur.
 *
 * POINT DUR (carto sans nœuds EF) : les renderers d'origine consomment des CHAMPS
 * PAR NŒUD + geometrie de maillage ; ils sont REBRANCHES sur les grilles 48x48
 * re-echantillonnees serveur (champs/champDeflexion). On compare les VALEURS de la
 * grille (pas les pixels) : le clone doit stocker et rendre EXACTEMENT les valeurs
 * serveur (aucune recomputation cote client).
 *
 * UNITE : l'UI d'origine stocke E en kPa ; le contrat serveur attend des MPa. Le
 * clone divise E par 1000 a la frontiere -> la sortie tassement est en mm-echelle,
 * AFFICHEE SANS le x1000 de l'outil d'origine (decision radier-units). Le test
 * peuple donc `state` avec E x1000 (kPa) pour refleter la saisie de l'outil.
 *
 * jsdom n'implemente pas le canvas 2D : on le STUB (le clone est defensif — bakeField
 * calcule quand meme R.grid/fmin/fmax). Skip BRUYANT si le clone est absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { runAxi } from '../axi/index.js';
import { AXI_FIXTURES } from '../axi/test-fixtures.js';
import { runPlaneStrain } from '../plane-strain/index.js';
import { PLANE_STRAIN_FIXTURES } from '../plane-strain/test-fixtures.js';
import { runTriRaft } from '../tri-raft/index.js';
import { TRI_RAFT_FIXTURES } from '../tri-raft/test-fixtures.js';

import { RADIER_FIXTURES } from './test-fixtures.js';

import { runRadier } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/radier -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/geoplaque.html');

type Win = {
  document: Document;
  eval: (code: string) => unknown;
  dispatchEvent: (e: unknown) => boolean;
  Event: new (t: string) => unknown;
  __geofamBridge?: unknown;
  close?: () => void;
};

/** Stub minimal du contexte 2D (jsdom n'a pas de canvas) — le clone reste defensif. */
function stubCanvas(w: Record<string, unknown>): void {
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createImageData')
          return (x: number, y: number) => ({
            data: new Uint8ClampedArray(Math.max(0, x * y * 4)),
            width: x,
            height: y,
          });
        if (p === 'measureText') return () => ({ width: 10 });
        if (p === 'createRadialGradient' || p === 'createLinearGradient')
          return () => ({ addColorStop() {} });
        return () => undefined;
      },
    },
  );
  const HCE = (w as { HTMLCanvasElement: { prototype: Record<string, unknown> } })
    .HTMLCanvasElement;
  HCE.prototype.getContext = () => ctx;
  HCE.prototype.toDataURL = () => 'data:,';
}

/** Charge le clone dans jsdom (canvas stub), declenche `load` (init), renvoie la fenetre. */
async function bootClone(): Promise<{ win: Win; errs: string[]; dom: JSDOM }> {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const errs: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e as Error).message);
    if (!/Not implemented/.test(m)) errs.push(m);
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      stubCanvas(w as unknown as Record<string, unknown>);
      (
        w as unknown as { requestAnimationFrame: (cb: () => void) => number }
      ).requestAnimationFrame = (cb) => setTimeout(cb, 0) as unknown as number;
    },
  });
  const win = dom.window as unknown as Win;
  win.dispatchEvent(new win.Event('load'));
  await new Promise((r) => setTimeout(r, 30));
  return { win, errs, dom };
}

/** Peuple `state` (E stocke en kPa = MPa x1000, comme l'outil d'origine). */
function setRadierState(
  win: Win,
  input: (typeof RADIER_FIXTURES)[number]['input'],
): void {
  const rafts = input.rafts.map((r, i) => ({
    id: i + 1,
    pts: r.pts,
    E: r.E * 1000,
    nu: r.nu,
    e: r.e,
  }));
  const layers = input.layers.map((l) => ({
    name: l.name ?? 'Couche',
    zBase: l.zBase,
    E: l.E * 1000,
    nu: l.nu,
  }));
  win.eval(
    `state.rafts=${JSON.stringify(rafts)};` +
      `state.pointLoads=${JSON.stringify(input.pointLoads ?? [])};` +
      `state.lineLoads=${JSON.stringify(input.lineLoads ?? [])};` +
      `state.areaLoads=${JSON.stringify(input.areaLoads ?? [])};` +
      `state.pointSprings=${JSON.stringify(input.pointSprings ?? [])};` +
      `state.lineSprings=${JSON.stringify(input.lineSprings ?? [])};` +
      `state.layers=${JSON.stringify(layers)};`,
  );
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
  'geoplaque — fidelite du clone excise (mapping serveur -> renderers rebranchés)',
  () => {
    it('RADIER : boote sans erreur puis rend synthèse + EC7 depuis la sortie serveur', async () => {
      const fx =
        RADIER_FIXTURES.find((f) => (f.input.pointLoads?.length ?? 0) >= 2) ??
        RADIER_FIXTURES[0];
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const output = env.output;

      const { win, errs } = await bootClone();
      expect(errs, errs.join('\n')).toHaveLength(0);

      win.__geofamBridge = {
        calc: () => Promise.resolve({ ok: true, calcResultId: 'cr-radier-1', output }),
        emitPv: () => undefined,
        context: () => ({}),
      };
      setRadierState(win, fx.input);
      await (win.eval('doSolve()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 20));

      const resbody = win.document.getElementById('resbody')?.innerHTML ?? '';
      // 1. rendu abouti (plus de placeholder), synthèse + EC7 présents.
      expect(resbody).not.toContain('Lance un calcul');
      expect(resbody).toContain('Synthèse');
      expect(resbody).toContain('EC7 annexe H');
      // 2. valeurs serveur FIDELES (tassement mm SANS x1000 ; réaction p_min/p_max scalaires).
      expect(resbody).toContain(
        output.wMax.toFixed(1) + ' / ' + output.wMin.toFixed(1) + ' mm',
      );
      expect(resbody).toContain(output.totalLoad.toFixed(0) + ' kN');
      expect(resbody).toContain(
        output.mxMax.toFixed(1) + ' / ' + output.myMax.toFixed(1),
      );
      // 3. aucune fuite grossière ni valeur non définie.
      expect(resbody).not.toContain('undefined');
      expect(resbody).not.toContain('[object Object]');
      expect(/\bNaN\b/.test(resbody)).toBe(false);
      // 4. aucun symbole solveur dans le DOM rendu.
      expect(resbody).not.toMatch(/solveModel|solveDense|buildACM/);

      win.close?.();
    });

    it('CARTO : le clone stocke et rend les GRILLES 48×48 serveur À L’IDENTIQUE (valeurs, pas pixels)', async () => {
      const fx = RADIER_FIXTURES[0];
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const output = env.output;
      expect(output.champs, 'le serveur doit exposer les cartes de champs').toBeDefined();
      expect(output.champs?.deflexion?.vals?.length ?? 0).toBeGreaterThan(100);

      const { win } = await bootClone();
      win.__geofamBridge = {
        calc: () => Promise.resolve({ ok: true, calcResultId: 'cr-carto', output }),
        emitPv: () => undefined,
        context: () => ({}),
      };
      setRadierState(win, fx.input);
      await (win.eval('doSolve()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 20));

      // La grille active (champ 'w' = deflexion) DOIT être exactement la grille serveur.
      const gridJson = win.eval(
        'JSON.stringify(state.results && state.results.grid ? {vals:state.results.grid.vals, vMin:state.results.grid.vMin, vMax:state.results.grid.vMax, cols:state.results.grid.cols} : null)',
      ) as string;
      const grid = JSON.parse(gridJson) as {
        vals: (number | null)[];
        vMin: number;
        vMax: number;
        cols: number;
      } | null;
      expect(grid, 'la carto doit consommer la grille serveur').not.toBeNull();
      if (!grid) return;
      const serverDefl = output.champs!.deflexion!;
      // ZERO ECART : valeurs de la grille RENDUE == valeurs serveur (aucune recomputation).
      expect(grid.cols).toBe(serverDefl.cols);
      expect(grid.vMin).toBeCloseTo(serverDefl.vMin, 10);
      expect(grid.vMax).toBeCloseTo(serverDefl.vMax, 10);
      expect(grid.vals.length).toBe(serverDefl.vals.length);
      for (let i = 0; i < grid.vals.length; i++) {
        const a = grid.vals[i] ?? null;
        const b = serverDefl.vals[i] ?? null;
        if (a === null || b === null) expect(a).toBe(b);
        else expect(a).toBeCloseTo(b, 10);
      }
      // La légende affiche l'étendue serveur (min/max de la grille).
      const legbar = win.document.getElementById('legend')?.innerHTML ?? '';
      expect(legbar.length).toBeGreaterThan(0);

      win.close?.();
    });

    it('2D plane-strain : rend stats + profils SVG depuis la sortie serveur (engineId plane-strain)', async () => {
      const fx = PLANE_STRAIN_FIXTURES[0];
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runPlaneStrain(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const output = env.output as {
        wMax: number;
        profils?: { deflexion?: { v: number[] } };
      };
      expect(output.profils?.deflexion?.v?.length ?? 0).toBeGreaterThan(2);

      const { win } = await bootClone();
      let sentEngineId: string | null = null;
      win.__geofamBridge = {
        calc: (engineId: string) => {
          sentEngineId = engineId;
          return Promise.resolve({ ok: true, calcResultId: 'cr-ps', output });
        },
        emitPv: () => undefined,
        context: () => ({}),
      };
      // Renseigne les couches + un champ de charge répartie, puis clique #ps-run.
      const layers = fx.input.layers.map((l) => ({
        name: 'c',
        zBase: l.zBase,
        E: l.E * 1000,
        nu: l.nu,
      }));
      win.eval(`state.layers=${JSON.stringify(layers)};`);
      const setV = (id: string, v: string): void => {
        win.eval(
          `(function(){var el=document.getElementById(${JSON.stringify(id)}); if(el) el.value=${JSON.stringify(v)};})()`,
        );
      };
      setV('ps-b', '6');
      setV('ps-E', '3e7');
      setV('ps-nu', '0.2');
      setV('ps-e', '0.4');
      setV('ps-q', '50');
      win.eval("document.getElementById('ps-run').dispatchEvent(new Event('click'))");
      await new Promise((r) => setTimeout(r, 30));

      // engineId envoyé = plane-strain (liste fermée), pas le radier de l'hôte.
      expect(sentEngineId).toBe('plane-strain');
      const out = win.document.getElementById('ps-out')?.innerHTML ?? '';
      expect(out).toContain('Tassement max / min');
      // Tassement affiché SANS x1000 (mm-échelle serveur).
      expect(out).toContain(output.wMax.toFixed(1));
      // psPlot rendu (SVG avec 3 bandes -> au moins un <path>).
      expect(out).toContain('<svg');
      expect(out).toContain('<path');
      expect(out).not.toContain('undefined');
      expect(/\bNaN\b/.test(out)).toBe(false);

      win.close?.();
    });

    it('2D axi : rend stats radiales + profils depuis la sortie serveur (engineId axi, clé `o`)', async () => {
      const fx = AXI_FIXTURES[0];
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runAxi(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const output = env.output as {
        wc: number;
        profils?: { deflexion?: { v: number[] } };
      };

      const { win } = await bootClone();
      let sentEngineId: string | null = null;
      win.__geofamBridge = {
        calc: (engineId: string) => {
          sentEngineId = engineId;
          return Promise.resolve({ ok: true, calcResultId: 'cr-axi', output });
        },
        emitPv: () => undefined,
        context: () => ({}),
      };
      const layers = fx.input.layers.map((l) => ({
        name: 'c',
        zBase: l.zBase,
        E: l.E * 1000,
        nu: l.nu,
      }));
      win.eval(`state.layers=${JSON.stringify(layers)};`);
      const setV = (id: string, v: string): void => {
        win.eval(
          `(function(){var el=document.getElementById(${JSON.stringify(id)});if(el)el.value=${JSON.stringify(v)};})()`,
        );
      };
      setV('ax-r', '6');
      setV('ax-E', '3e7');
      setV('ax-nu', '0.2');
      setV('ax-e', '0.4');
      setV('ax-q', '120');
      win.eval("document.getElementById('ax-run').dispatchEvent(new Event('click'))");
      await new Promise((r) => setTimeout(r, 30));

      expect(sentEngineId).toBe('axi');
      const out = win.document.getElementById('ax-out')?.innerHTML ?? '';
      expect(out).toContain('Tassement centre / bord');
      expect(out).toContain(output.wc.toFixed(1));
      expect(out).toContain('<svg');
      expect(out).not.toContain('undefined');
      expect(/\bNaN\b/.test(out)).toBe(false);
      win.close?.();
    });

    it('2D tri-raft : rend la carte champDeflexion 48×48 serveur (jamais le maillage triangulaire réel)', async () => {
      const fx = TRI_RAFT_FIXTURES[0];
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runTriRaft(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const output = env.output as {
        wMax: number;
        nRaft: number;
        champDeflexion?: unknown;
      };

      const { win } = await bootClone();
      let sentEngineId: string | null = null;
      win.__geofamBridge = {
        calc: (engineId: string) => {
          sentEngineId = engineId;
          return Promise.resolve({ ok: true, calcResultId: 'cr-tri', output });
        },
        emitPv: () => undefined,
        context: () => ({}),
      };
      const layers = fx.input.layers.map((l) => ({
        name: 'c',
        zBase: l.zBase,
        E: l.E * 1000,
        nu: l.nu,
      }));
      const rafts = fx.input.rafts.map((r, i) => ({
        id: i + 1,
        pts: r.pts,
        E: 30000000,
        nu: 0.2,
        e: 0.5,
      }));
      win.eval(
        `state.layers=${JSON.stringify(layers)};state.rafts=${JSON.stringify(rafts)};` +
          `state.pointLoads=${JSON.stringify(fx.input.pointLoads ?? [])};` +
          `state.lineLoads=${JSON.stringify(fx.input.lineLoads ?? [])};` +
          `state.areaLoads=${JSON.stringify(fx.input.areaLoads ?? [])};`,
      );
      const setV = (id: string, v: string): void => {
        win.eval(
          `(function(){var el=document.getElementById(${JSON.stringify(id)});if(el)el.value=${JSON.stringify(v)};})()`,
        );
      };
      setV('tri-target', '1');
      setV('tri-E', '3e7');
      setV('tri-nu', '0.2');
      setV('tri-e', '0.5');
      setV('tri-q', String(fx.input.opts.q ?? 0));
      win.eval("document.getElementById('tri-run').dispatchEvent(new Event('click'))");
      await new Promise((r) => setTimeout(r, 30));

      expect(sentEngineId).toBe('tri-raft');
      const out = win.document.getElementById('tri-out')?.innerHTML ?? '';
      expect(out).toContain('Tassement max / min');
      expect(out).toContain(output.wMax.toFixed(1));
      // La carte est la grille d'affichage 48×48 — jamais le rendu triangulé réel.
      if (output.champDeflexion) {
        expect(out).toContain('<svg');
        expect(out).toContain('grille d’affichage 48×48');
      }
      expect(out).not.toContain('undefined');
      expect(/\bNaN\b/.test(out)).toBe(false);
      win.close?.();
    });

    it('NO-CALC-INITIAL : un modèle vide (aucune plaque/charge) NE sollicite PAS le serveur', async () => {
      const { win } = await bootClone();
      let calls = 0;
      win.__geofamBridge = {
        calc: () => {
          calls += 1;
          return Promise.resolve({ ok: true, output: {} });
        },
        emitPv: () => undefined,
        context: () => ({}),
      };
      // init() a posé 2 couches mais AUCUNE plaque/charge -> plausibleGeoplaque() = false.
      await (win.eval('doSolve()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toBe(0);
      const resbody = win.document.getElementById('resbody')?.innerHTML ?? '';
      expect(resbody).toMatch(/Dessine au moins une plaque/);
      win.close?.();
    });

    it('§8 : le HTML servi ne contient AUCUN symbole solveur ni marqueur confidentiel', () => {
      const html = readFileSync(CLONE_PATH, 'utf8');
      // Symboles solveurs (appels) — doublon du garde-fou audit-excision, ancré dans le test.
      for (const sym of [
        'solveModel',
        'solveDense',
        'solvePlaneStrain',
        'solveAxi',
        'solveTriRaft',
        'buildACM',
      ]) {
        expect(
          new RegExp(`(?<![\\w.$])${sym}\\s*\\(`).test(html),
          `symbole ${sym} présent`,
        ).toBe(false);
      }
      // Marqueur confidentiel des moteurs (DoD §8) — jamais dans le HTML navigateur.
      expect(html).not.toContain('__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__');
    });
  },
);
