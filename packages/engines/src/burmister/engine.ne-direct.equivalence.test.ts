/**
 * EQUIVALENCE-PORTAGE du NE DIRECT (#93 sous-port 3b).
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`
 * (copiee dans le depot, non gelee), pilotee via jsdom (`gnt-auto-harness.ts`,
 * meme harnais reutilise). Module sous test : `computeBurmister` (engine.ts),
 * qui porte desormais `load.neForce?: number` : si fourni (fini, positif), NE =
 * neForce et le calcul TMJA x CAM x croissance x duree est ignore ; sinon,
 * calcul historique INCHANGE (GATE naturel).
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot ; si elle
 * venait a manquer, SKIP BRUYANT (jamais un faux-vert).
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeBurmister } from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';
import { NE_DIRECT_FIXTURES } from './ne-direct-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-ne-direct';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — NE direct : module TS <-> reference DEFINITIVE (#93 sous-port 3b)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#93] AVERTISSEMENT : reference definitive ABSENTE ' +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence du NE direct N A PAS ete verifiee. Ce skip n est PAS un succes.";
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence NE direct NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  const { computeHtml, cleanup } = loadDefinitiveCompute();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares.
  it('compare AU MOINS 10 jeux de NE direct (pas de suite vide)', () => {
    expect(NE_DIRECT_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  for (const fx of NE_DIRECT_FIXTURES) {
    it(`[${fx.id}] module == reference definitive (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
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
          `Ecart de PORTAGE du NE direct sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
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

describe('burmister — gate NE direct : comportement HISTORIQUE preserve quand neForce est absent/null', () => {
  const LAYERS: Array<{ mat: string; h: number; E: number; nu: number }> = [
    { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
    { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 },
    { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
  ];
  const SUBGRADE = { cls: 'PF2', E: 50, nu: 0.35 };
  const TRAFFIC = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };

  it('neForce absent -> NE == calcul TMJA historique (365*T*C*CAM*dir*tv)', () => {
    const state = {
      layers: LAYERS,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    };
    const result = computeBurmister(state) as { NE: number };
    const t = TRAFFIC.tau / 100;
    const C = Math.abs(t) < 1e-4 ? TRAFFIC.N : (Math.pow(1 + t, TRAFFIC.N) - 1) / t;
    const expectedNE = 365 * TRAFFIC.T * C * TRAFFIC.C * TRAFFIC.dir * TRAFFIC.tv;
    expect(result.NE).toBeCloseTo(expectedNE, 6);
  });

  it('neForce=null explicite -> meme comportement que absent', () => {
    const state = {
      layers: LAYERS,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
      },
    };
    const withoutNe = computeBurmister(state) as { NE: number };
    const stateWithNull = { ...state, load: { ...state.load, neForce: null as never } };
    const withNullNe = computeBurmister(stateWithNull) as { NE: number };
    expect(withNullNe.NE).toBe(withoutNe.NE);
  });

  it('neForce fourni -> NE == neForce (court-circuite le calcul TMJA)', () => {
    const state = {
      layers: LAYERS,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: {
        p: 0.662,
        a: 0.125,
        d: 0.375,
        r: 'auto',
        sh: 'auto',
        ks: 'auto',
        neForce: 12345678,
      },
    };
    const result = computeBurmister(state) as { NE: number };
    expect(result.NE).toBe(12345678);
  });
});
