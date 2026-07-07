/**
 * EQUIVALENCE-PORTAGE des CONDITIONS D'INTERFACE (#87, etape 2/2).
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`
 * (copiee dans le depot, non gelee), pilotee via jsdom (`gnt-auto-harness.ts` —
 * meme harnais generique que l'etape 1/2, il pilote `doCalc()` sans hypothese
 * sur le contenu de l'etat). Module sous test : `computeBurmister` (engine.ts)
 * avec `load.ifaceAuto=true`, qui integre desormais la condition d'interface
 * EFFECTIVE (Tab. 68, `_ifEff`/`_solveSet`/`_avgR`, transcription fidele) au
 * calcul PRINCIPAL (`_r0/_rd2/_rd`) au lieu du chemin collee pur historique.
 *
 * TRADUCTION DE CHAMP (reference <-> contrat) : la reference definitive lit
 * l'override d'interface par couche sur `ly[i].ifc` (`_ifEff`, l.1107) ; notre
 * contrat expose ce meme override sous le nom `iface` (coherent avec les
 * allowlists existantes `MODES_INTERFACE`). `toDefinitiveLayers` traduit
 * `iface` -> `ifc` UNIQUEMENT pour piloter la reference (le module TS sous test
 * recoit l'entree ORIGINALE, avec `iface` — c'est le contrat reel qu'il expose).
 * Sans cette traduction, un override non reconnu par la reference (car sous le
 * mauvais nom de champ) FERAIT ECHOUER la comparaison silencieusement en
 * masquant un vrai defaut de portage derriere un mismatch de nommage — d'ou le
 * test dedie qui verifie que la traduction fonctionne (cf. plus bas).
 *
 * Tolerance de PORTAGE serree (rel 1e-9) : module et reference executent la
 * MEME science sur des structures a >=2 couches RIGIDES ADJACENTES (semi-
 * rigide, mixte, inverse, beton multi-couches) — le seul perimetre ou le calcul
 * principal peut differer du chemin collee (cf. en-tete
 * `interface-auto-fixtures.ts`).
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
import { INTERFACE_AUTO_FIXTURES } from './interface-auto-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-interface-auto';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

/**
 * Traduit l'override d'interface par couche `iface` (contrat TS) en `ifc`
 * (champ lu par la reference definitive, `_ifEff`). Cf. en-tete du fichier.
 */
function toDefinitiveLayers(input: BurmisterInput): BurmisterInput {
  return {
    ...input,
    layers: input.layers.map((l) => {
      const { iface, ...rest } = l as BurmisterInput['layers'][number] & {
        iface?: string;
      };
      return iface !== undefined ? { ...rest, ifc: iface } : rest;
    }) as BurmisterInput['layers'],
  };
}

/**
 * Le resultat brut `_D` echo les couches telles que MUTEES en interne (`lys`,
 * `JSON.parse(JSON.stringify(ly))`). La reference les porte donc sous `ifc`
 * (nom de champ interne a la reference, cf. `toDefinitiveLayers` ci-dessus),
 * le module sous `iface` (nom du contrat). C'est un simple ECHO diagnostique
 * (`lys` n'est PAS dans la sortie client-safe whitelistee, contract.ts) : on
 * normalise ce SEUL nom de champ avant comparaison pour ne pas confondre ce
 * detail de nommage avec un vrai ecart de calcul.
 */
function normalizeReferenceLysFieldName(result: unknown): unknown {
  const r = result as { lys?: Array<Record<string, unknown>> };
  if (!Array.isArray(r.lys)) return result;
  return {
    ...r,
    lys: r.lys.map((l) => {
      if (!('ifc' in l)) return l;
      const { ifc, ...rest } = l;
      return { ...rest, iface: ifc };
    }),
  };
}

describe('burmister — conditions d interface (Tab. 68) : module TS <-> reference DEFINITIVE (#87 etape 2/2)', () => {
  if (!SOURCE_OK) {
    const msg =
      "[#87] AVERTISSEMENT : reference definitive ABSENTE " +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence des conditions d interface N A PAS ete verifiee. Ce skip n est PAS un succes.";
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence conditions d interface NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  const { computeHtml, cleanup } = loadDefinitiveCompute();

  // Filet anti faux-vert : on EXIGE >=5 cas effectivement compares.
  it('compare AU MOINS 5 jeux d entrees a interfaces non-collees (pas de suite vide)', () => {
    expect(INTERFACE_AUTO_FIXTURES.length).toBeGreaterThanOrEqual(5);
  });

  for (const fx of INTERFACE_AUTO_FIXTURES) {
    it(`[${fx.id}] module (ifaceAuto=true) == reference definitive (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      const reference = sanitizeResult(
        normalizeReferenceLysFieldName(computeHtml(toDefinitiveLayers(fx.input))),
      );
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
          `Ecart de PORTAGE des conditions d interface sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
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

describe('burmister — gate ifaceAuto : comportement HISTORIQUE preserve quand ifaceAuto est absent/false', () => {
  const STATE_2_RIG_ADJACENTS = {
    layers: [
      { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
      { mat: 'GC3', h: 0.19, E: 23000, nu: 0.25 },
      { mat: 'GC3', h: 0.18, E: 23000, nu: 0.25 },
    ],
    subgrade: { cls: 'PF3', E: 120, nu: 0.35 },
    traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
    load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
  };

  it('ifaceAuto absent -> ez identique au chemin collee pur (pas de retraitement)', () => {
    const without = computeBurmister(STATE_2_RIG_ADJACENTS) as { ez: number };
    const withFalse = computeBurmister({
      ...STATE_2_RIG_ADJACENTS,
      load: { ...STATE_2_RIG_ADJACENTS.load, ifaceAuto: false },
    }) as { ez: number };
    expect(withFalse.ez).toBe(without.ez);
  });

  it('ifaceAuto=true sur 2 couches rigides adjacentes -> ez DIFFERE du chemin collee (interface effective appliquee)', () => {
    const collee = computeBurmister(STATE_2_RIG_ADJACENTS) as { ez: number };
    const effectif = computeBurmister({
      ...STATE_2_RIG_ADJACENTS,
      load: { ...STATE_2_RIG_ADJACENTS.load, ifaceAuto: true },
    }) as { ez: number };
    expect(effectif.ez).not.toBeCloseTo(collee.ez, 6);
  });

  it('ifaceAuto=true SANS paire rigide adjacente -> aucun effet (une seule couche rigide, ifaceAuto="collee")', () => {
    const state = {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GC3', h: 0.19, E: 23000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 300, nu: 0.35 },
      ],
      subgrade: { cls: 'PF3', E: 120, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    };
    const off = computeBurmister(state) as { ez: number };
    const on = computeBurmister({
      ...state,
      load: { ...state.load, ifaceAuto: true },
    }) as { ez: number };
    expect(on.ez).toBe(off.ez);
  });

  it('gntAuto et ifaceAuto combines : les deux prises en compte sans interference', () => {
    const state = {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GC3', h: 0.19, E: 23000, nu: 0.25 },
        { mat: 'GC3', h: 0.18, E: 23000, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 400, nu: 0.35 },
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
        ifaceAuto: true,
      },
    };
    const result = computeBurmister(state) as {
      lys: Array<{ E: number; nu: number }>;
      ez: number;
    };
    // gntAuto a bien retraite la couche GNT : hasBound=true (GC3 rig) -> plafond
    // 360, mais la cascade part du module SOUS-JACENT (ici la PSC, seule couche
    // GNT, derniere de la structure) : E = min(3*pf.E, 360) = min(3*50,360) = 150
    // (NON cape ici — le plafond ne s'applique QUE si 3xEb le depasse).
    expect(result.lys[3]!.E).toBe(150);
    expect(result.lys[3]!.nu).toBe(0.35);
    // ez est un nombre fini (le calcul n'a pas plante en combinant les deux gates).
    expect(Number.isFinite(result.ez)).toBe(true);
  });
});
