/**
 * EQUIVALENCE-PORTAGE du MODULE GNT AUTOMATIQUE (#87, etape 1/2).
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`
 * (copiee dans le depot, non gelee), pilotee via jsdom (`gnt-auto-harness.ts`,
 * `cp.gntAuto=true`). Module sous test : `computeBurmister` (engine.ts) avec
 * `load.gntAuto=true`, qui applique `applyGntAuto()` (transcription fidele de
 * `applyGntAuto()` de la reference, l.569-581) AVANT le calcul Burmister.
 *
 * Tolerance de PORTAGE serree (rel 1e-9) : module et reference executent la
 * MEME science sur les fixtures choisies (aucune paire de couches rigides
 * adjacentes -> `ifaceAuto` renvoie toujours 'collee', seul chemin transcrit
 * dans engine.ts — cf. en-tete `gnt-auto-fixtures.ts`).
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot (contrairement
 * a l'ancienne reference, hors git) ; si elle venait a manquer, SKIP BRUYANT
 * (jamais un faux-vert), meme discipline que l'equivalence-portage existante.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeBurmister } from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import { GNT_AUTO_FIXTURES } from './gnt-auto-fixtures.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-gnt-auto';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — module GNT automatique : module TS <-> reference DEFINITIVE (#87 etape 1/2)', () => {
  if (!SOURCE_OK) {
    const msg =
      "[#87] AVERTISSEMENT : reference definitive ABSENTE " +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence du module GNT automatique N A PAS ete verifiee. Ce skip n est PAS un succes.";
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence GNT automatique NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  const { computeHtml, cleanup } = loadDefinitiveCompute();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares.
  it('compare AU MOINS 10 jeux d entrees GNT (pas de suite vide)', () => {
    expect(GNT_AUTO_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  for (const fx of GNT_AUTO_FIXTURES) {
    it(`[${fx.id}] module (gntAuto=true) == reference definitive (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      const reference = sanitizeResult(computeHtml(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-reference-definitive',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(jsonRoundTrip(computeBurmister(inputs))),
      );
      if (!result.equal) {
        const lignes = result.diffs
          .map(
            (d: { path: string; expected: unknown; actual: unknown; reason: string }) =>
              `  - ${d.path || '(racine)'} : reference=${JSON.stringify(d.expected)} ` +
              `module=${JSON.stringify(d.actual)} [${d.reason}]`,
          )
          .join('\n');
        throw new Error(
          `Ecart de PORTAGE du module GNT automatique sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});

describe('burmister — gate gntAuto : comportement HISTORIQUE preserve quand gntAuto est absent/false', () => {
  it('gntAuto absent -> les couches GNT ne sont PAS retraitees (E/nu inchanges)', () => {
    const state = {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.3, E: 300, nu: 0.35 },
      ],
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    };
    const result = computeBurmister(state) as { lys: Array<{ E: number; nu: number }> };
    // Si le module GNT s'appliquait a tort, E passerait a 600 (topG, hasBound=false).
    expect(result.lys[1]!.E).toBe(300);
    expect(result.lys[1]!.nu).toBe(0.35);
  });

  it('gntAuto=false explicite -> meme comportement que absent (couches inchangees)', () => {
    const state = {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.3, E: 300, nu: 0.35 },
      ],
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
        gntAuto: false,
      },
    };
    const result = computeBurmister(state) as { lys: Array<{ E: number; nu: number }> };
    expect(result.lys[1]!.E).toBe(300);
    expect(result.lys[1]!.nu).toBe(0.35);
  });

  it('gntAuto=true -> les couches GNT SONT retraitees (E impose par le catalogue)', () => {
    const state = {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.3, E: 300, nu: 0.35 },
      ],
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
        gntAuto: true,
      },
    };
    const result = computeBurmister(state) as { lys: Array<{ E: number; nu: number }> };
    // hasBound=false (seule couche liee = BBSG1, en surface) ; couche GNT unique =
    // topG -> E fixe a 600 MPa (catalogue p.79), nu impose a 0,35.
    expect(result.lys[1]!.E).toBe(600);
    expect(result.lys[1]!.nu).toBe(0.35);
  });

  it('gntAuto=true ne mute PAS l objet layers fourni par l appelant (pas d effet de bord sur l entree)', () => {
    const inputLayers = [
      { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
      { mat: 'GNT1', h: 0.3, E: 300, nu: 0.35 },
    ];
    const state = {
      layers: inputLayers,
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
        gntAuto: true,
      },
    };
    computeBurmister(state);
    // L'objet d'entree du client ne doit JAMAIS etre mute par le pre-traitement.
    expect(inputLayers[1]!.E).toBe(300);
    expect(inputLayers[1]!.nu).toBe(0.35);
  });
});
