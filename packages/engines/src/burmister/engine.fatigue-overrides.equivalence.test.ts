/**
 * EQUIVALENCE-PORTAGE des SURCHARGES DE FATIGUE ε₆/σ₆ par materiau
 * (#93 sous-port 3d, reference DEFINITIVE — table des lois de fatigue
 * EDITABLE, `onchange="M['${'${k}'}'].e6=+this.value"` / `s6=`).
 *
 * ⚠️ CE N'EST PAS UN RECALAGE SCIENTIFIQUE (contrairement a `materialsRev` —
 * #93 sous-port 3c) : c'est une FONCTIONNALITE de la reference definitive
 * elle-meme (editer ε₆/σ₆ AVANT de calculer). On prouve ici que le module TS
 * (`load.fatigueOverrides`, contract.ts) reproduit EXACTEMENT l'effet de cette
 * edition (module == reference definitive AVEC la meme mutation de `M`,
 * rel 1e-9), pour les DEUX branches (ε₆ bitumineux, σ₆ MTLH/rigide), ET que le
 * GATE naturel (absent -> defauts catalogue) laisse le comportement HISTORIQUE
 * strictement inchange.
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`,
 * pilotee via jsdom (`gnt-auto-harness.ts` — `computeHtmlWithFatigueOverrides`,
 * qui mute `M[mat].e6`/`M[mat].s6` EN PLACE avant `doCalc()`, exactement comme
 * l'`onchange` de la reference).
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot ; si elle
 * venait a manquer, SKIP BRUYANT (jamais un faux-vert).
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import type { BurmisterInput } from './contract.js';
import { computeBurmister } from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-fatigue-overrides';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const TRAFIC_REF: BurmisterInput['traffic'] = {
  T: 150,
  C: 0.9,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };
const CP_BASE: BurmisterInput['load'] = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
};

// Materiau DIMENSIONNANT (`mD`, engine.ts l.998-1006) = la couche la PLUS
// PROFONDE du paquet lie (base bitEnd-1) : structure a UNE SEULE couche liee,
// pour que la surcharge cible directement (sans ambiguite) le materiau dont la
// base porte le critere de fatigue.

/** Structure bitumineuse (materiau dimensionnant : BBSG1, critere ε_t). */
const LAYERS_BITUMINEUX: BurmisterInput['layers'] = [
  { mat: 'BBSG1', h: 0.2, E: 1512, nu: 0.45 },
];

/**
 * Structure semi-rigide (materiau dimensionnant : GLc2, critere σ_t MTLH).
 * UNE SEULE couche GLc2 (pas de paire rigide/rigide ADJACENTE) : le chemin de
 * calcul PRINCIPAL (`_r0/_rd2/_rd`) reste le chemin "collee" historique meme
 * SANS `ifaceAuto` (aucune interface Tab. 68 a arbitrer) — isole strictement
 * le delta de la surcharge de fatigue, sans re-tester le rebase d'interface
 * (#87, deja couvert par `engine.interface-auto.equivalence.test.ts`).
 */
const LAYERS_MTLH: BurmisterInput['layers'] = [
  { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
  { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
];

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — gate fatigueOverrides : comportement HISTORIQUE preserve quand absent/vide', () => {
  it('fatigueOverrides absent -> resultat IDENTIQUE a fatigueOverrides omis explicitement', () => {
    const state = { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const a = computeBurmister(state) as Record<string, unknown>;
    const b = computeBurmister({ ...state, load: { ...CP_BASE } }) as Record<string, unknown>;
    expect(a).toEqual(b);
  });

  it('fatigueOverrides=[] (vide) -> resultat IDENTIQUE a fatigueOverrides absent', () => {
    const state = { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const sansFlag = computeBurmister(state) as Record<string, unknown>;
    const flagVide = computeBurmister({
      ...state,
      load: { ...CP_BASE, fatigueOverrides: [] },
    }) as Record<string, unknown>;
    expect(flagVide).toEqual(sansFlag);
  });

  it("fatigueOverrides sur un materiau HORS structure (n'affecte pas le materiau dimensionnant reel) -> resultat IDENTIQUE", () => {
    const state = { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const sansFlag = computeBurmister(state) as Record<string, unknown>;
    // GLc2 n'apparait pas dans LAYERS_BITUMINEUX : la surcharge est sans effet.
    const avecFlagInoffensif = computeBurmister({
      ...state,
      load: { ...CP_BASE, fatigueOverrides: [{ mat: 'GLc2', s6: 0.9 }] },
    }) as Record<string, unknown>;
    expect(avecFlagInoffensif).toEqual(sansFlag);
  });
});

describe('burmister — surcharge ε₆ (bitumineux, BBSG1) pilote directement la deformation admissible', () => {
  it("BBSG1 e6 100->120 -> l'admissible et le coefficient de reference EFFECTIF (sortie) refletent 120, pas le defaut catalogue", () => {
    const state = { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const defaut = computeBurmister(state) as { e6: number | null; etA: number | null };
    const surcharge = computeBurmister({
      ...state,
      load: { ...CP_BASE, fatigueOverrides: [{ mat: 'BBSG1', e6: 120 }] },
    }) as { e6: number | null; etA: number | null };
    expect(defaut.e6).toBe(100);
    expect(surcharge.e6).toBe(120);
    expect(surcharge.etA).not.toBe(defaut.etA);
  });
});

describe('burmister — surcharge σ₆ (MTLH, GLc2) pilote directement la contrainte admissible', () => {
  it('GLc2 s6 0,37->0,40 -> le coefficient de reference EFFECTIF (sortie) reflete 0,40, pas le defaut catalogue', () => {
    const state = { layers: LAYERS_MTLH, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const defaut = computeBurmister(state) as { e6: number | null; etA: number | null };
    const surcharge = computeBurmister({
      ...state,
      load: { ...CP_BASE, fatigueOverrides: [{ mat: 'GLc2', s6: 0.4 }] },
    }) as { e6: number | null; etA: number | null };
    expect(defaut.e6).toBe(0.37);
    expect(surcharge.e6).toBe(0.4);
    expect(surcharge.etA).not.toBe(defaut.etA);
  });

  it("materialsRev='definitive' (base 0,3705) COMBINE avec une surcharge -> l'override PRIME sur la table selectionnee", () => {
    const state = { layers: LAYERS_MTLH, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const definitiveSansSurcharge = computeBurmister({
      ...state,
      load: { ...CP_BASE, materialsRev: 'definitive' },
    }) as { e6: number | null };
    const definitiveAvecSurcharge = computeBurmister({
      ...state,
      load: { ...CP_BASE, materialsRev: 'definitive', fatigueOverrides: [{ mat: 'GLc2', s6: 0.4 }] },
    }) as { e6: number | null };
    expect(definitiveSansSurcharge.e6).toBe(0.3705);
    expect(definitiveAvecSurcharge.e6).toBe(0.4);
  });

  it('doublon de materiau dans le tableau -> la DERNIERE entree gagne (deterministe)', () => {
    const state = { layers: LAYERS_MTLH, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE };
    const doublon = computeBurmister({
      ...state,
      load: {
        ...CP_BASE,
        fatigueOverrides: [
          { mat: 'GLc2', s6: 0.4 },
          { mat: 'GLc2', s6: 0.45 },
        ],
      },
    }) as { e6: number | null };
    expect(doublon.e6).toBe(0.45);
  });
});

describe('burmister — sortie client-safe : valeur EFFECTIVE reflete pour le PV (honnetete du sceau)', () => {
  it('sans override : fatigue.referenceCatalogue == defaut catalogue (bitumineux)', () => {
    const raw = computeBurmister({
      layers: LAYERS_BITUMINEUX,
      subgrade: PF3,
      traffic: TRAFIC_REF,
      load: CP_BASE,
    }) as { e6: number | null };
    expect(raw.e6).toBe(100);
  });

  it('avec override : fatigue.referenceCatalogue == valeur SAISIE, jamais le defaut catalogue (bitumineux)', () => {
    const raw = computeBurmister({
      layers: LAYERS_BITUMINEUX,
      subgrade: PF3,
      traffic: TRAFIC_REF,
      load: { ...CP_BASE, fatigueOverrides: [{ mat: 'BBSG1', e6: 120 }] },
    }) as { e6: number | null };
    expect(raw.e6).toBe(120);
  });

  it('avec override : fatigue.referenceCatalogue == valeur SAISIE, jamais le defaut catalogue (MTLH)', () => {
    const raw = computeBurmister({
      layers: LAYERS_MTLH,
      subgrade: PF3,
      traffic: TRAFIC_REF,
      load: { ...CP_BASE, fatigueOverrides: [{ mat: 'GLc2', s6: 0.4 }] },
    }) as { e6: number | null };
    expect(raw.e6).toBe(0.4);
  });
});

describe('burmister — surcharges fatigue : module TS <-> reference DEFINITIVE (#93 sous-port 3d)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#93] AVERTISSEMENT : reference definitive ABSENTE ' +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence des surcharges de fatigue N A PAS ete verifiee. Ce skip n est PAS un succes.";
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence surcharges fatigue NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  interface Fixture {
    id: string;
    description: string;
    input: BurmisterInput;
    overrides: ReadonlyArray<{ mat: string; e6?: number; s6?: number }>;
  }

  const FIXTURES: Fixture[] = [
    {
      id: 'fatigue-e6-bbsg-100-120',
      description: 'BBSG1 (bitumineux, materiau dimensionnant) : e6 edite 100 -> 120',
      input: { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE },
      overrides: [{ mat: 'BBSG1', e6: 120 }],
    },
    {
      id: 'fatigue-s6-glc2-0370-0400',
      description: 'GLc2 (MTLH, materiau dimensionnant) : s6 edite 0,3705 -> 0,40',
      input: { layers: LAYERS_MTLH, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE },
      overrides: [{ mat: 'GLc2', s6: 0.4 }],
    },
    {
      id: 'fatigue-e6-borne-basse-50',
      description: 'BBSG1 : e6 edite a la borne basse de saisie (50 μdef)',
      input: { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE },
      overrides: [{ mat: 'BBSG1', e6: 50 }],
    },
    {
      id: 'fatigue-s6-borne-haute-5',
      description: 'GLc2 : s6 edite a la borne haute de saisie (5,0 MPa)',
      input: { layers: LAYERS_MTLH, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE },
      overrides: [{ mat: 'GLc2', s6: 5.0 }],
    },
    {
      id: 'fatigue-sans-override-inchange',
      // Temoin : AUCUNE surcharge -> module == reference definitive. On utilise des
      // couches BITUMINEUSES (BBSG e6=100, INCHANGE entre l'ancienne table et la
      // definitive) et non MTLH : sinon le delta de calage s6 GLc2 0,37->0,3705 (etape
      // 3c, materialsRev) ferait diverger le temoin pour une raison ETRANGERE aux
      // surcharges de fatigue. Ici, aucun coefficient ne differe entre les deux tables
      // -> le temoin isole strictement l'effet « pas d'override = inchange ».
      description: 'AUCUNE surcharge : module == reference definitive SANS mutation de M (temoin)',
      input: { layers: LAYERS_BITUMINEUX, subgrade: PF3, traffic: TRAFIC_REF, load: CP_BASE },
      overrides: [],
    },
  ];

  for (const fx of FIXTURES) {
    it(`[${fx.id}] module (fatigueOverrides) == reference definitive editee (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // Instance jsdom DEDIEE par scenario : la mutation de M est PERSISTANTE sur
      // la fenetre (comme la reference reelle), donc jamais partagee entre cas.
      const { computeHtmlWithFatigueOverrides, cleanup } = loadDefinitiveCompute();
      try {
        const reference = sanitizeResult(
          computeHtmlWithFatigueOverrides(fx.input, fx.overrides),
        );
        const moduleInput = {
          ...fx.input,
          load: { ...fx.input.load, fatigueOverrides: fx.overrides.length ? fx.overrides : undefined },
        };
        const testCase: GoldenCase = {
          id: fx.id,
          description: fx.description,
          provenance: 'HTML-reference-definitive',
          inputs: moduleInput,
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
            `Ecart de PORTAGE des surcharges de fatigue sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
          );
        }
        expect(result.equal).toBe(true);
      } finally {
        cleanup();
      }
    });
  }

  it('compare AU MOINS 5 jeux (pas de suite vide)', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(5);
  });
});
