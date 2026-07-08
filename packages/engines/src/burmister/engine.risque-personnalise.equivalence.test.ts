/**
 * EQUIVALENCE-PORTAGE du RISQUE PERSONNALISE (#93 sous-port 3a).
 *
 * Reference : `packages/engines/reference/roadsens_burmister_definitive.html`
 * (copiee dans le depot, non gelee), pilotee via jsdom (`gnt-auto-harness.ts`,
 * meme harnais que le sous-port GNT : il pilote `doCalc()` sans dependre du
 * module GNT lui-meme). Module sous test : `computeBurmister` (engine.ts), qui
 * porte desormais `invNorm()`/`uRisk()` (algorithme d'Acklam) au lieu du repli
 * fixe sur 1,282 pour tout risque hors table {5,10,15,25,50}.
 *
 * DEUX EXIGENCES DISTINCTES verifiees ici :
 *   1. Equivalence-PORTAGE (golden-master) : module == reference definitive,
 *      SUR les risques standard ET personnalises (rel 1e-9).
 *   2. Bit-exactitude DIRECTE de `uRisk()` sur la table standard (5/10/15/25/50) :
 *      la table catalogue EXACTE reste inchangee, verifiee ICI independamment de
 *      tout calcul de structure (isole la fonction, ne depend pas de jsdom).
 *
 * GATE LOCAL : la reference definitive est copiee dans le depot (contrairement
 * a l'ancienne reference, hors git) ; si elle venait a manquer, SKIP BRUYANT
 * (jamais un faux-vert), meme discipline que l'equivalence-portage existante.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeBurmister, uRisk } from './engine.js';
import { jsonRoundTrip, sanitizeResult } from './equivalence-harness.js';
import {
  burmisterDefinitiveSourceAvailable,
  loadDefinitiveCompute,
} from './gnt-auto-harness.js';
import { RISQUE_PERSONNALISE_FIXTURES } from './risque-personnalise-fixtures.js';

const MODULE_UNDER_TEST = 'chaussee-burmister-risque-personnalise';
/** Tolerance de PORTAGE serree : module et reference executent la MEME science. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

describe('burmister — uRisk() : table STANDARD preservee au bit pres (#93 sous-port 3a)', () => {
  it('uRisk(5) === 1.645 (table exacte)', () => {
    expect(uRisk(5)).toBe(1.645);
  });
  it('uRisk(10) === 1.282 (table exacte)', () => {
    expect(uRisk(10)).toBe(1.282);
  });
  it('uRisk(15) === 1.036 (table exacte)', () => {
    expect(uRisk(15)).toBe(1.036);
  });
  it('uRisk(25) === 0.674 (table exacte)', () => {
    expect(uRisk(25)).toBe(0.674);
  });
  it('uRisk(50) === 0.0 (table exacte)', () => {
    expect(uRisk(50)).toBe(0.0);
  });
  it('uRisk(10.5) !== 1.282 (hors table -> quantile continu, plus le repli fige)', () => {
    // Preuve directe que le bug de portage (repli fixe sur 1,282 pour TOUT r hors
    // table) est corrige : un risque proche de 10 mais hors table donne un quantile
    // DIFFERENT de 1,282 (continu, pas un plateau).
    expect(uRisk(10.5)).not.toBe(1.282);
    expect(uRisk(10.5)).toBeCloseTo(1.253, 2);
  });
});

const SOURCE_OK = burmisterDefinitiveSourceAvailable();

describe('burmister — risque personnalise : module TS <-> reference DEFINITIVE (#93 sous-port 3a)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#93] AVERTISSEMENT : reference definitive ABSENTE ' +
      '(packages/engines/reference/roadsens_burmister_definitive.html). ' +
      "L equivalence du risque personnalise N A PAS ete verifiee. Ce skip n est PAS un succes.";
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence risque personnalise NON verifiee (reference absente) — ${msg}`, () => {
      /* volontairement skip : reference absente */
    });
    return;
  }

  const { computeHtml, cleanup } = loadDefinitiveCompute();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares.
  it('compare AU MOINS 10 jeux de risque (pas de suite vide)', () => {
    expect(RISQUE_PERSONNALISE_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  for (const fx of RISQUE_PERSONNALISE_FIXTURES) {
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
          `Ecart de PORTAGE du risque personnalise sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
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
