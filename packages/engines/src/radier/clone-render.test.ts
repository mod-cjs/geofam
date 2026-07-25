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
 * clone divise E par 1000 a la frontiere -> la sortie tassement est en mm-echelle.
 * AFFICHAGE = COPIE DE L'OUTIL CLIENT (decision titulaire 15/07 re-confirmee 17/07,
 * RENVERSE le 01/07) : les tassements sont AFFICHES AVEC le x1000 de l'outil d'origine
 * (sur-rapport COPIE, defaut inclus). La valeur SERVEUR reste inchangee ; SEUL l'affichage
 * applique le x1000. Les assertions attendent donc `output.w*1000`. La GRILLE (carto)
 * reste FIDELE aux valeurs serveur brutes (aucun x1000 sur les cellules). Le test peuple
 * `state` avec E x1000 (kPa) pour refleter la saisie de l'outil.
 *
 * jsdom n'implemente pas le canvas 2D : on le STUB (le clone est defensif — bakeField
 * calcule quand meme R.grid/fmin/fmax). Skip BRUYANT si le clone est absent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { radierSourceAvailable, radierSourcePath } from './equivalence-harness.js';

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
const REPO = resolve(HERE, '../../../..');

type Win = {
  document: Document;
  eval: (code: string) => unknown;
  dispatchEvent: (e: unknown) => boolean;
  Event: new (t: string) => unknown;
  __geofamBridge?: unknown;
  close?: () => void;
};

/** Passe un HTML dans la VRAIE garde §8 serveur (assertInertHtml) via le runner
 *  scripts/assert-inert-run.mts — jamais une copie des regles. */
function guardInert(html: string): { ok: boolean; error?: string } {
  const raw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
    input: html,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw) as { ok: boolean; error?: string };
}

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

type Cap = { displayHtml: string; printHtml: string };
/** Boote le clone, installe un pont AVEC capteur `snapshot`, peuple `state` puis lance
 *  doSolve() — collecte les captures emises par __geoplaqueCaptureSnapshot en fin de solve. */
async function bootRadierCapturing(
  input: (typeof RADIER_FIXTURES)[number]['input'],
  output: unknown,
): Promise<{ win: Win; caps: Cap[] }> {
  const { win } = await bootClone();
  const caps: Cap[] = [];
  win.__geofamBridge = {
    calc: () => Promise.resolve({ ok: true, calcResultId: 'cr-cap', output }),
    emitPv: () => undefined,
    snapshot: (displayHtml: string, printHtml: string) =>
      caps.push({
        displayHtml: String(displayHtml || ''),
        printHtml: String(printHtml || ''),
      }),
    context: () => ({}),
  };
  setRadierState(win, input);
  await (win.eval('doSolve()') as Promise<unknown>);
  await new Promise((r) => setTimeout(r, 20));
  return { win, caps };
}

/** Rend la note printReport de la REFERENCE client gelee : boote la source (canvas +
 *  window.open stubbes), peuple state, doSolve() SYNCHRONE (le moteur local calcule), puis
 *  printReport() -> capture le HTML ecrit dans la fenetre d impression. */
function renderReferenceNote(input: (typeof RADIER_FIXTURES)[number]['input']): string {
  const html = readFileSync(radierSourcePath(), 'utf8');
  let written = '';
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      stubCanvas(w as unknown as Record<string, unknown>);
      // window.open stub : capte le document.write de printReport (impression client).
      (w as unknown as { open: unknown }).open = () => ({
        document: {
          write: (h: string) => {
            written += h;
          },
          close: () => undefined,
        },
        focus: () => undefined,
        print: () => undefined,
      });
    },
  });
  const win = dom.window as unknown as Win;
  win.dispatchEvent(new win.Event('load'));
  setRadierState(win, input);
  win.eval('doSolve()'); // SYNCHRONE dans la reference (moteur local)
  win.eval('printReport()');
  win.close?.();
  return written;
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
      // 2. valeurs serveur FIDELES, AFFICHEES ×1000 (copie du sur-rapport de l'outil client).
      expect(resbody).toContain(
        (output.wMax * 1000).toFixed(1) + ' / ' + (output.wMin * 1000).toFixed(1) + ' mm',
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
      // Tassement affiché AVEC x1000 (copie du sur-rapport de l'outil client).
      expect(out).toContain((output.wMax * 1000).toFixed(1));
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
      // Tassement affiché AVEC x1000 (copie du sur-rapport de l'outil client).
      expect(out).toContain((output.wc * 1000).toFixed(1));
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
      // Tassement affiché AVEC x1000 (copie du sur-rapport de l'outil client).
      expect(out).toContain((output.wMax * 1000).toFixed(1));
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

    // ======================================================================
    // CAPTURE OPTION-3 (snapshot:capture) — le pont geoplaque scelle le DOCUMENT
    // (note printReport + figure heatmap) APRES un calcul RADIER reussi. ZERO
    // FAUX-VERT : si le cablage (snapshot / __geoplaqueCaptureSnapshot / appel en
    // fin de doSolve) est retire, `caps` reste vide -> ces tests DEVIENNENT ROUGES.
    // ======================================================================
    it('given un calcul RADIER reussi, when doSolve se termine, then le pont emet snapshot:capture (display + print) — NON vide', async () => {
      const fx =
        RADIER_FIXTURES.find((f) => (f.input.pointLoads?.length ?? 0) >= 2) ??
        RADIER_FIXTURES[0];
      if (!fx) return;
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      expect(caps.length, 'AUCUNE capture emise par le pont geoplaque').toBe(1);
      const cap = caps[0];
      if (!cap) throw new Error('capture absente');

      // printHtml = document imprimable auto-contenu (note + figure).
      expect(cap.printHtml.length, 'printHtml vide').toBeGreaterThan(2000);
      expect(cap.printHtml, 'printHtml non auto-contenu').toContain('<!doctype html>');
      expect(cap.printHtml, 'CSS non inline').toContain('<style>');
      expect(cap.printHtml, 'titre de note absent').toContain('Note de calcul — GEOPLAQUE');
      expect(cap.printHtml, 'section EC7 absente').toContain(
        'Vérifications — Eurocode 7, annexe H',
      );
      expect(cap.printHtml, 'synthèse absente').toContain('Synthèse des résultats');
      // displayHtml = apercu auto-contenu (MÊME corps que le printHtml : en-tête GEOPLAQUE
      // + EC7 + synthèse ; seul le <title> diffère — « Aperçu de la note »).
      expect(cap.displayHtml.length, 'displayHtml vide').toBeGreaterThan(2000);
      expect(cap.displayHtml, 'displayHtml non auto-contenu').toContain('<!doctype html>');
      expect(cap.displayHtml, 'en-tête GEOPLAQUE absente de l apercu').toContain('GEOPLAQUE');
      expect(cap.displayHtml, 'EC7 absente de l apercu').toContain(
        'Vérifications — Eurocode 7, annexe H',
      );
      expect(cap.displayHtml, 'synthèse absente de l apercu').toContain(
        'Synthèse des résultats',
      );

      win.close?.();
    });

    it('FIGURE SUBSTITUÉE (§8) : la note embarque la HEATMAP design-sûre, PAS le canvas client brut', async () => {
      const fx = RADIER_FIXTURES[0];
      if (!fx) return;
      const env = runRadier(fx.input);
      if (!env.ok) return;
      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      expect(caps.length).toBe(1);
      const cap = caps[0];
      if (!cap) throw new Error('capture absente');
      // La figure est un SVG INLINE reconstruit depuis la grille 48×48 (design-sûr,
      // sealable) — PAS le canvas brut cv.toDataURL (dont l alt était « Modèle »), PAS une
      // URI data: (que la garde de scellement assertInertHtml rejette).
      expect(cap.printHtml, 'figure SVG absente (substitution ratée)').toMatch(/<svg/i);
      expect(cap.printHtml, 'légende figure heatmap absente').toContain(
        'Cartographie du champ de déflexion',
      );
      expect(cap.printHtml, 'ancien alt du canvas brut « Modèle » encore présent').not.toContain(
        'alt="Modèle"',
      );
      expect(cap.printHtml, 'URI data: (non sealable) dans la figure').not.toMatch(
        /src\s*=\s*["']?\s*data:/i,
      );
      // La note assume explicitement la nature design-sûre (grille découplée du maillage).
      expect(cap.printHtml).toContain('découplée du maillage');
      // Aucun indice de maillage dans la note (lignes d élément / nœuds / valeurs nodales).
      expect(cap.printHtml).not.toMatch(/Nœuds de calcul|nœud\(s\) plastifié|itération\(s\)/);
      win.close?.();
    });

    it('TABLE COMPLÈTE DES COUPLES (task c) : tous les couples voisins + positions sont REPORTÉS', async () => {
      const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-quatre-poteaux');
      expect(fx, 'fixture multi-charges absente').toBeDefined();
      if (!fx) return;
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // Le serveur expose bien la table complète (anti-vacuité).
      expect((env.output.loadPairs?.length ?? 0), 'serveur sans table de couples').toBeGreaterThan(
        1,
      );

      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      const cap = caps[0];
      if (!cap) throw new Error('capture absente');
      // Titre de section de la table complète (client l.1346).
      expect(cap.printHtml, 'section « couples voisins » absente').toContain(
        'Tassement différentiel entre charges voisines',
      );
      // Chaque couple serveur apparaît (P ki ↔ P kj) — pas seulement le pire.
      const rows = (env.output.loadPairs ?? []).filter(
        (e) => (e.p1?.x ?? null) !== null && (e.p2?.x ?? null) !== null,
      );
      expect(rows.length).toBeGreaterThan(1);
      for (const e of rows) {
        expect(
          cap.printHtml,
          `couple P${e.ki}↔P${e.kj} absent de la note`,
        ).toContain(`P${e.ki} ↔ P${e.kj}`);
      }
      // Les POSITIONS SAISIES apparaissent (colonnes Position 1 / Position 2).
      expect(cap.printHtml).toContain('Position 1 (m)');
      expect(cap.printHtml).toContain('Position 2 (m)');
      win.close?.();
    });

    it('LOCALISATIONS MASQUÉES (task a, §8 #54) : la note garde les VALEURS mais AUCUNE localisation *At', async () => {
      const fx = RADIER_FIXTURES[0];
      if (!fx) return;
      const env = runRadier(fx.input);
      if (!env.ok) return;
      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      const cap = caps[0];
      if (!cap) throw new Error('capture absente');
      // La VALEUR de tassement max EST reportée (fidélité)…
      expect(cap.printHtml).toContain('Tassement total max');
      // …mais JAMAIS la localisation « — en (x, y) » (nœud de maillage, exception §8).
      expect(cap.printHtml, 'localisation *At exposée (masquage §8 rompu)').not.toMatch(
        /—\s*en\s*\(/,
      );
      expect(cap.printHtml).not.toMatch(/entre\s*\([-\d.,\s]+\)\s*et\s*\(/);
      win.close?.();
    });

    it('given le displayHtml et le printHtml REELLEMENT captures, when passes dans la VRAIE garde §8 (assertInertHtml), then ACCEPTES', async () => {
      const fx =
        RADIER_FIXTURES.find((f) => (f.input.pointLoads?.length ?? 0) >= 2) ??
        RADIER_FIXTURES[0];
      if (!fx) return;
      const env = runRadier(fx.input);
      if (!env.ok) return;
      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      expect(caps.length, 'capture non emise -> rien a verifier').toBe(1);
      const cap = caps[0];
      if (!cap) throw new Error('capture absente');
      expect(/<script\b/i.test(cap.printHtml), 'printHtml contient <script>').toBe(false);
      expect(/<script\b/i.test(cap.displayHtml), 'displayHtml contient <script>').toBe(false);
      const gp = guardInert(cap.printHtml);
      expect(gp.ok, `garde §8 REFUSE le printHtml — motif : ${gp.error ?? ''}`).toBe(true);
      const gd = guardInert(cap.displayHtml);
      expect(gd.ok, `garde §8 REFUSE le displayHtml — motif : ${gd.error ?? ''}`).toBe(true);
      win.close?.();
    });

    // ESPRIT MUTATION : doSolve rend la note d'erreur PUIS `return` AVANT
    // `__geoplaqueCaptureSnapshot()`. Ce test devient ROUGE si l'appel de capture est
    // déplacé AVANT ce `return` (ou si la garde `if(out.erreur){…return;}` est retirée) :
    // une capture serait émise sur un document d'erreur → caps.length passerait à 1.
    it('GARDE §5 : sur une erreur EN BANDE (output.erreur), AUCUNE capture n est emise (on ne scelle pas un document d erreur)', async () => {
      const fx =
        RADIER_FIXTURES.find((f) => (f.input.pointLoads?.length ?? 0) >= 1) ??
        RADIER_FIXTURES[0];
      if (!fx) return;
      // Etat PLAUSIBLE (sinon on n atteint jamais le serveur) mais sortie EN ERREUR.
      const errored = { erreur: 'Erreur de calcul (test en bande).', warnings: [] };
      const { win, caps } = await bootRadierCapturing(fx.input, errored);
      expect(caps.length, 'un document d ERREUR a été capturé (garde §5 absente/déplacée)').toBe(
        0,
      );
      // Contre-preuve : la note d ERREUR EST bien rendue (le chemin d erreur a été pris,
      // la capture n a pas été court-circuitée « en amont » du rendu).
      const resbody = win.document.getElementById('resbody')?.innerHTML ?? '';
      expect(resbody, 'la note d erreur n a pas été rendue').toContain(
        'Erreur de calcul (test en bande)',
      );
      win.close?.();
    });

    it('DETERMINISME : deux captures de la MEME sortie serveur sont IDENTIQUES (hachable/scellable)', async () => {
      const fx =
        RADIER_FIXTURES.find((f) => (f.input.pointLoads?.length ?? 0) >= 2) ??
        RADIER_FIXTURES[0];
      if (!fx) return;
      const env = runRadier(fx.input);
      if (!env.ok) return;
      const a = await bootRadierCapturing(fx.input, env.output);
      const b = await bootRadierCapturing(fx.input, env.output);
      expect(a.caps.length).toBe(1);
      expect(b.caps.length).toBe(1);
      expect(b.caps[0]?.printHtml, 'printHtml non déterministe').toBe(a.caps[0]?.printHtml);
      expect(b.caps[0]?.displayHtml, 'displayHtml non déterministe').toBe(
        a.caps[0]?.displayHtml,
      );
      a.win.close?.();
      b.win.close?.();
    });

    it('EQUIVALENCE NOTE : la note capturée == note client, aux SEULES exceptions §8 (localisations *At masquées + figure substituée)', async () => {
      if (!radierSourceAvailable()) {
        // eslint-disable-next-line no-console
        console.warn('[clone-render] SKIP equivalence note : source gelée absente (CI).');
        return;
      }
      const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-quatre-poteaux');
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      const refNote = renderReferenceNote(fx.input);
      const { win, caps } = await bootRadierCapturing(fx.input, env.output);
      const cloneNote = caps[0]?.printHtml ?? '';

      // Garde anti faux-vert : la référence a bien produit une note COMPLETE.
      expect(refNote.length, 'référence sans note (rendu cassé ?)').toBeGreaterThan(3000);
      expect(refNote, 'référence sans EC7').toContain('Eurocode 7, annexe H');
      expect(refNote, 'référence sans table de couples').toContain(
        'Tassement différentiel entre charges voisines',
      );
      // La référence PORTE les localisations *At (preuve que le masquage clone est réel,
      // pas un artefact d une référence qui n en aurait pas).
      expect(refNote, 'référence sans localisation *At').toMatch(/—\s*en\s*\(/);

      // Extraction du LIBELLÉ (1re cellule) de chaque ligne de tableau — structure de la
      // note, indépendante des unités et de l ordre d attributs.
      // Normalise les apostrophes (droite ' vs typographique ’, purement cosmétique et
      // incohérent dans la source client) pour ne comparer que la STRUCTURE des libellés.
      const apos = (s: string): string => s.replace(/['’]/g, "'");
      const labelsOf = (h: string): string[] =>
        (h.match(/<tr>\s*<td>([\s\S]*?)<\/td>/g) ?? [])
          .map((r) =>
            apos(
              r.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
            ),
          )
          .filter((t) => t.length > 0 && !/^#$|^Élément$|^Couple$|^Critère$/.test(t));
      const refLabels = labelsOf(refNote);
      const cloneLabels = new Set(labelsOf(cloneNote));

      // (1) FIDÉLITÉ STRUCTURELLE : chaque LIBELLÉ de ligne de la référence est présent dans
      //     le clone, SAUF les lignes de MÉTHODE EF légitimement omises (§8) :
      //      - « Nœuds de calcul » (compte de nœuds) ; « Pas de maillage » (discrétisation) ;
      //      - la ligne SYNTHÈSE « Plastification de l'interface » ne diffère de la ligne
      //        OPTION homonyme (Paramètres) que par le nombre de nœuds plastifiés → même label,
      //        donc couverte par la ligne option présente des deux côtés.
      const METHOD_ONLY = /^(Nœuds de calcul|Pas de maillage)$/;
      const missingLabels = refLabels.filter(
        (l) => !METHOD_ONLY.test(l) && !cloneLabels.has(l),
      );
      // Anti-vacuité : structure substantielle des deux côtés.
      expect(refLabels.length, 'référence sans lignes').toBeGreaterThan(12);
      // Sanity du comparateur : un libellé mangé NE doit PAS matcher.
      expect(cloneLabels.has('__inexistant__')).toBe(false);
      expect(
        missingLabels,
        `libellés de ligne de la note client ABSENTS du clone (hors §8) : ${missingLabels.join(' || ')}`,
      ).toEqual([]);

      // (2) FIDÉLITÉ DES POSITIONS (task c, §8-safe) : chaque couple de la référence figure
      //     dans le clone avec ses POSITIONS SAISIES p1/p2 (unités-indépendant).
      const pairPos = (h: string): string[] =>
        (h.match(/<tr><td>P\d+\s*[↔↔]\s*P\d+<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td>/g) ?? []).map(
          (r) =>
            r
              .replace(/<[^>]+>/g, '|')
              .replace(/\s+/g, ' ')
              .trim(),
        );
      const refPairs = pairPos(refNote);
      expect(refPairs.length, 'référence sans couples').toBeGreaterThan(1);
      const clonePairs = new Set(pairPos(cloneNote));
      const missingPairs = refPairs.filter((p) => !clonePairs.has(p));
      expect(
        missingPairs,
        `couples (couple + positions) de la référence absents du clone : ${missingPairs.slice(0, 3).join(' ; ')}`,
      ).toEqual([]);

      // (3) RÉCIPROQUE §8 : le clone n introduit AUCUNE localisation *At, et la figure est
      //     substituée (SVG heatmap, pas le canvas brut → aucune URI data:).
      expect(cloneNote, 'localisation *At introduite par le clone').not.toMatch(/—\s*en\s*\(/);
      expect(cloneNote, 'figure canvas brute (URI data:) dans le clone').not.toMatch(
        /src\s*=\s*["']?\s*data:/i,
      );

      // (4) ⚠ SENTINELLE UNITÉS — DIVERGENCE CONNUE À ARBITRER (titulaire + expert).
      //     Le clone applique le ×1000 (« sur-rapport COPIE », décision 15/07) à une sortie
      //     serveur DÉJÀ en échelle mm → les tassements/Δs/β (et donc les VERDICTS EC7) du
      //     clone valent ~1000× la note client (ex. 29147 mm vs 29.4 mm). Ce n'est PAS une
      //     exception §8 mais un CONFLIT D'UNITÉS non résolu (mémoires 01/07 « ne pas copier »
      //     vs 15/07 « copier ») qui, en l'état, ferait SCELLER des valeurs et des verdicts
      //     erronés. On NE MASQUE PAS ce fait : on le CARACTÉRISE (le test reste vert sur la
      //     structure, ROUGE-documenté ici). Si quelqu'un « corrige » le ×1000, cette
      //     sentinelle bascule → revue forcée. À TRANCHER AVANT SCELLEMENT.
      const numAfter = (h: string, label: string): number | null => {
        const m = h.match(
          new RegExp(label + '<\\/td><td>([\\d\\u202f\\u00a0 ]*[\\d.]+)\\s*mm'),
        );
        return m && m[1] ? parseFloat(m[1].replace(/[^\d.]/g, '')) : null;
      };
      const refTass = numAfter(refNote, 'Tassement total max');
      const cloneTass = numAfter(cloneNote, 'Tassement total max');
      expect(refTass, 'tassement de référence introuvable').not.toBeNull();
      expect(cloneTass, 'tassement clone introuvable').not.toBeNull();
      if (refTass && cloneTass) {
        const facteur = cloneTass / refTass;
        // Divergence ~×1000 CARACTÉRISÉE (et non ~1). Si le facteur retombe à ~1 (unités
        // réconciliées) OU explose autrement, cette sentinelle casse et force la revue.
        expect(
          facteur,
          `DIVERGENCE UNITÉS clone/réf = ×${facteur.toFixed(0)} (attendu ~1000, décision ×1000 non réconciliée) — À ARBITRER`,
        ).toBeGreaterThan(500);
      }

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
