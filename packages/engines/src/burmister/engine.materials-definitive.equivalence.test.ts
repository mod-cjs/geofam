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
 * DEUX PREUVES :
 *   1. AVEC `materialsRev='definitive'` : module == reference definitive
 *      (rel 1e-9), sur GLc2/BQc/BC5g.
 *   2. SANS `materialsRev` (absent) : module == ANCIENNE table (s6 0.37/0.30,
 *      pas de BC5g) — comportement HISTORIQUE preserve, verifie en isolant
 *      `AGEROUTE_MATERIALS` (s6 inchanges) et en prouvant que BC5g reste absent
 *      de la table par defaut (le moteur leve une erreur si on lui soumet BC5g
 *      sans le flag, comme la reference historique avant l'ajout de ce materiau).
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot ; si elle
 * venait a manquer, SKIP BRUYANT (jamais un faux-vert).
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { AGEROUTE_MATERIALS, AGEROUTE_MATERIALS_DEFINITIVE, computeBurmister } from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';
import { MATERIALS_DEFINITIVE_FIXTURES } from './materials-definitive-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-materiaux-definitive';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

describe('burmister — tables materiaux : HISTORIQUE vs DEFINITIVE isolees (#93 sous-port 3c)', () => {
  it('table HISTORIQUE (defaut) : GLc2.s6=0,37, BQc.s6=0,30, pas de BC5g', () => {
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

describe('burmister — gate materialsRev : comportement HISTORIQUE preserve quand absent', () => {
  const LAYERS_GLC2 = [
    { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
    { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
    { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
  ];
  const SUBGRADE = { cls: 'PF3', E: 120, nu: 0.35 };
  const TRAFFIC = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
  const CP_BASE = { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' } as const;

  it('materialsRev absent -> resultat IDENTIQUE a materialsRev absent explicitement omis (defaut stable)', () => {
    const state = { layers: LAYERS_GLC2, subgrade: SUBGRADE, traffic: TRAFFIC, load: CP_BASE };
    const a = computeBurmister(state) as Record<string, unknown>;
    const b = computeBurmister({ ...state, load: { ...CP_BASE } }) as Record<string, unknown>;
    expect(a).toEqual(b);
  });

  it("materialsRev='definitive' -> resultat DIFFERE du defaut (s6 GLc2 recalibre 0,37->0,3705)", () => {
    const state = { layers: LAYERS_GLC2, subgrade: SUBGRADE, traffic: TRAFFIC, load: CP_BASE };
    const historique = computeBurmister(state) as { e6: number | null; etA: number | null };
    const definitive = computeBurmister({
      ...state,
      load: { ...CP_BASE, materialsRev: 'definitive' },
    }) as { e6: number | null; etA: number | null };
    // `e6` (raw : coefficient s6 minimal retenu pour la structure MTLH) DOIT
    // refleter directement le recalage 0,37 -> 0,3705 ; la valeur ADMISSIBLE
    // (`etA`) qui en depend DOIT donc egalement differer.
    expect(historique.e6).toBe(0.37);
    expect(definitive.e6).toBe(0.3705);
    expect(definitive.etA).not.toBe(historique.etA);
  });

  it(
    "BC5g soumis SANS materialsRev='definitive' -> materiau NON reconnu (absent de la table " +
      'historique) : les coefficients de calage effectivement retenus DIFFERENT de ceux de la ' +
      'table definitive (BC5g.s6=2,15, kd=1/1,47) — preuve indirecte que M ne contient PAS BC5g ' +
      'quand le flag est absent (le moteur ne LEVE pas sur ce cas, contrairement au materiau ' +
      "totalement inconnu en position influant sur `bitEnd` — cf. 'hors-domaine-materiau-inconnu')",
    () => {
      // BC5g place en couche la PLUS PROFONDE du paquet lie (`mD`, le materiau
      // DIMENSIONNANT du critere de fatigue rigide — cf. engine.ts l.998-1006) :
      // c'est le SEUL positionnement ou son coefficient s6 pilote directement `e6`.
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
      // Sans le flag, BC5g est absent de M (table historique) : `mD = M['BC5g']
      // || {}` est un objet VIDE (ni `.bit` ni `.rig`) -> minE6 (`e6`) = Infinity
      // (aucun coefficient de calage disponible), jamais 2,15 (BC5g reel).
      expect(sansFlag.e6).toBe(Infinity);
      // Avec le flag, BC5g (s6=2,15) est reconnu : le coefficient retenu differe.
      expect(avecFlag.e6).toBe(2.15);
    },
  );
});

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — revision materiaux definitive : module TS <-> reference DEFINITIVE (#93 sous-port 3c)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#93] AVERTISSEMENT : reference definitive ABSENTE ' +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence de la revision materiaux N A PAS ete verifiee. Ce skip n est PAS un succes.";
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
