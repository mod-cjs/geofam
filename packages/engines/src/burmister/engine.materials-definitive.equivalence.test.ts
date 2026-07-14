/**
 * EQUIVALENCE-PORTAGE de la REVISION MATERIAUX « definitive » (#93 sous-port 3c).
 *
 * ⚠️ SCIENCE, PAS UN SIMPLE PORT : la reference DEFINITIVE corrige GLc2 s6
 * 0.37->0.3705, BQc s6 0.30->0.304, et AJOUTE le materiau BC5g (Beton BC5 dalle
 * GOUJONNEE, kd=1/1,47). Ce recalage engage le CALAGE scientifique STARFIRE.
 * L'ACTIVATION EN PRODUCTION du flag `materialsRev='definitive'` necessite une
 * validation `expert-genie-civil`/STARFIRE prealable — ce test prouve UNIQUEMENT
 * l'equivalence-PORTAGE (module == reference definitive), pas la justesse
 * scientifique du recalage lui-meme (deja signee par ailleurs pour les autres
 * coefficients, cf. `roadsen-science-signed-decision`).
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`,
 * pilotee via jsdom (`gnt-auto-harness.ts`, reutilise). Module sous test :
 * `computeBurmister` (engine.ts) avec `load.materialsRev`.
 *
 * DEUX PREUVES (ADR 0013 — TABLE UNIQUE, mode historique RETIRE) :
 *   1. AVEC `materialsRev='definitive'` : module == reference definitive
 *      (rel 1e-9), sur GLc2/BQc/BC5g.
 *   2. SANS `materialsRev` (absent) : module == MEME resultat definitive (le flag
 *      n'a PLUS d'effet — une seule table). On le prouve : sans flag, GLc2 utilise
 *      s6=0,3705 (pas 0,37) et BC5g est RECONNU (e6=2,15, plus jamais Infinity).
 *      Les CONSTANTES `AGEROUTE_MATERIALS` (base structurelle, s6=0,37/0,30) et
 *      `AGEROUTE_MATERIALS_DEFINITIVE` restent testees isolement (la definitive
 *      derive de la base par spread), mais SEULE la definitive est utilisee au calcul.
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot ; si elle
 * venait a manquer, SKIP BRUYANT (jamais un faux-vert).
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import {
  AGEROUTE_MATERIALS,
  AGEROUTE_MATERIALS_DEFINITIVE,
  computeBurmister,
} from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';
import { MATERIALS_DEFINITIVE_FIXTURES } from './materials-definitive-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-materiaux-definitive';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

describe('burmister — tables materiaux : BASE vs DEFINITIVE (constantes, ADR 0013)', () => {
  it('table de BASE `AGEROUTE_MATERIALS` (structurelle, non utilisee seule) : GLc2.s6=0,37, BQc.s6=0,30, pas de BC5g', () => {
    // NB : ces valeurs restent celles de la BASE dont derive la definitive (spread).
    // Elles ne sont PLUS utilisees au calcul depuis le retrait du mode historique.
    expect(AGEROUTE_MATERIALS.GLc2.s6).toBe(0.37);
    expect(AGEROUTE_MATERIALS.BQc.s6).toBe(0.3);
    expect((AGEROUTE_MATERIALS as Record<string, unknown>)['BC5g']).toBeUndefined();
  });
  it('table DEFINITIVE : GLc2.s6=0,3705, BQc.s6=0,304, BC5g present (kd=1/1,47)', () => {
    expect(AGEROUTE_MATERIALS_DEFINITIVE.GLc2.s6).toBe(0.3705);
    expect(AGEROUTE_MATERIALS_DEFINITIVE.BQc.s6).toBe(0.304);
    expect(AGEROUTE_MATERIALS_DEFINITIVE.BC5g.kd).toBeCloseTo(1 / 1.47, 12);
    expect(AGEROUTE_MATERIALS_DEFINITIVE.BC5g.E).toBe(35000);
  });
  it('la table DEFINITIVE ne modifie PAS les autres materiaux (ex. BC5 non goujonne inchange)', () => {
    expect(AGEROUTE_MATERIALS_DEFINITIVE.BC5.kd).toBe(AGEROUTE_MATERIALS.BC5.kd);
    expect(AGEROUTE_MATERIALS_DEFINITIVE.BBSG1).toEqual(AGEROUTE_MATERIALS.BBSG1);
  });
});

describe('burmister — materialsRev SANS effet : SANS flag == AVEC flag == definitive (ADR 0013)', () => {
  const LAYERS_GLC2 = [
    { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
    { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
    { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
  ];
  const SUBGRADE = { cls: 'PF3', E: 120, nu: 0.35 };
  const TRAFFIC = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
  const CP_BASE = {
    p: 0.662,
    a: 0.125,
    d: 0.375,
    r: 'auto',
    sh: 'auto',
    ks: 'auto',
  } as const;

  it('materialsRev absent -> resultat stable (idempotent, defaut reproductible)', () => {
    const state = {
      layers: LAYERS_GLC2,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: CP_BASE,
    };
    const a = computeBurmister(state) as Record<string, unknown>;
    const b = computeBurmister({ ...state, load: { ...CP_BASE } }) as Record<
      string,
      unknown
    >;
    expect(a).toEqual(b);
  });

  it("materialsRev='definitive' == absent : le flag n'a PLUS d'effet (table unique, mode historique retire)", () => {
    const state = {
      layers: LAYERS_GLC2,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: CP_BASE,
    };
    const sansFlag = computeBurmister(state) as Record<string, unknown>;
    const avecFlag = computeBurmister({
      ...state,
      load: { ...CP_BASE, materialsRev: 'definitive' },
    }) as Record<string, unknown>;
    // MORD si quelqu un reintroduisait le gate historique : les DEUX doivent etre
    // strictement identiques (meme table definitive appliquee des deux cotes).
    expect(sansFlag).toEqual(avecFlag);
  });

  it('SANS flag, GLc2 utilise s6=0,3705 (definitive), PAS 0,37 (historique retire)', () => {
    const state = {
      layers: LAYERS_GLC2,
      subgrade: SUBGRADE,
      traffic: TRAFFIC,
      load: CP_BASE,
    };
    const sansFlag = computeBurmister(state) as { e6: number | null };
    // `e6` (raw : coefficient s6 minimal retenu pour la structure MTLH) == 0,3705 :
    // preuve DIRECTE que la table DEFINITIVE est utilisee meme sans flag.
    expect(sansFlag.e6).toBe(0.3705);
  });

  it('SANS flag, BC5g est RECONNU (materiau definitive, e6=2,15) — plus jamais Infinity', () => {
    // BC5g place en couche la PLUS PROFONDE du paquet lie (`mD`, le materiau
    // DIMENSIONNANT du critere de fatigue rigide) : son coefficient s6 pilote `e6`.
    // Avant ADR 0013, sans flag BC5g etait absent -> e6=Infinity ; il est desormais
    // TOUJOURS reconnu (table definitive unique). MORD si le gate revenait.
    const layers = [
      { mat: 'BC2', h: 0.15, E: 20000, nu: 0.25 },
      { mat: 'BC5g', h: 0.22, E: 35000, nu: 0.25 },
    ];
    const state = { layers, subgrade: SUBGRADE, traffic: TRAFFIC, load: CP_BASE };
    const sansFlag = computeBurmister(state) as { e6: number | null };
    const avecFlag = computeBurmister({
      ...state,
      load: { ...CP_BASE, materialsRev: 'definitive' },
    }) as { e6: number | null };
    expect(sansFlag.e6).toBe(2.15);
    expect(avecFlag.e6).toBe(2.15);
  });
});

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — revision materiaux definitive : module TS <-> reference DEFINITIVE (#93 sous-port 3c)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#93] AVERTISSEMENT : reference definitive ABSENTE ' +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      'L equivalence de la revision materiaux N A PAS ete verifiee. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence revision materiaux NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  const { computeHtml, cleanup } = loadDefinitiveCompute();

  // Filet anti faux-vert : on EXIGE >=5 cas effectivement compares (perimetre
  // restreint : GLc2/BQc/BC5g, moins de combinaisons que GNT/interface).
  it('compare AU MOINS 5 jeux de materiaux (pas de suite vide)', () => {
    expect(MATERIALS_DEFINITIVE_FIXTURES.length).toBeGreaterThanOrEqual(5);
  });

  for (const fx of MATERIALS_DEFINITIVE_FIXTURES) {
    it(`[${fx.id}] module (materialsRev=definitive) == reference definitive (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
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
          `Ecart de PORTAGE de la revision materiaux sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
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
