/**
 * EQUIVALENCE-PORTAGE terzaghi : module TS extrait <-> HTML d'origine (jsdom).
 *
 * @science-unsigned — prouve le PORTAGE (le module reproduit l'origine), PAS la
 * justesse scientifique (kit cas-tests STARFIRE indisponible, #36). MJ-6 : pas de
 * prod sans conformite.
 *
 * Methode : pour chaque jeu d'entrees, on execute le HTML d'ORIGINE via jsdom
 * (reference, provenance 'HTML-origine') ET le module TS, et on compare les
 * resultats BRUTS (tous champs, intermediaires compris) a une tolerance de
 * portage SERREE (rel 1e-9). Le harnais golden @roadsen/shared est l'arbitre
 * (anti auto-reference : provenance != module sous test).
 *
 * GATE LOCAL : les sources moteur sont HORS depot git (03-Moteurs-client). En CI
 * elles sont absentes -> SKIP BRUYANT (jamais un faux-vert). « 0 cas execute »
 * localement (sources presentes mais aucun cas) serait un echec : on l'assert.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeTerzaghi } from './engine.js';
import {
  loadOriginalComputeAll,
  sanitizeResult,
  terzaghiSourceAvailable,
} from './equivalence-harness.js';
import { TERZAGHI_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'fondation-superficielle';
/** Tolerance de PORTAGE serree : module et origine sont le MEME code, on vise l'egalite. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = terzaghiSourceAvailable();

describe('terzaghi — equivalence-portage module <-> HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#45] AVERTISSEMENT : source terzaghi_V13.html ABSENTE (03-Moteurs-client/ hors depot git). ' +
      'L equivalence-portage N A PAS ete verifiee — gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  // On charge le moteur d'origine UNE fois (jsdom couteux). cleanup en fin de suite.
  const { computeAll, cleanup } = loadOriginalComputeAll();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares.
  const cmpFixtures = TERZAGHI_FIXTURES.filter((f) => !f.horsDomaine);
  const horsDomaine = TERZAGHI_FIXTURES.filter((f) => f.horsDomaine);

  it('compare AU MOINS 10 jeux d entrees nominaux/bornes (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('couvre au moins un cas HORS-DOMAINE', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // REFERENCE : sortie BRUTE du HTML d'origine (provenance externe au module).
      const reference = sanitizeResult(computeAll(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-origine',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      // run = module TS extrait (sortie brute sanitisee, MEME normalisation).
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(computeTerzaghi(inputs)),
      );
      if (!result.equal) {
        const lignes = result.diffs
          .map(
            (d: { path: string; expected: unknown; actual: unknown; reason: string }) =>
              `  - ${d.path || '(racine)'} : origine=${JSON.stringify(d.expected)} ` +
              `module=${JSON.stringify(d.actual)} [${d.reason}]`,
          )
          .join('\n');
        throw new Error(
          `Ecart de PORTAGE sur "${fx.id}" (defaut d integration, a NOTRE charge) :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  for (const fx of horsDomaine) {
    it(`[${fx.id}] erreur de saisie IDENTIQUE origine/module — ${fx.description}`, () => {
      // Cas hors-domaine : le moteur renvoie { err: "...", ... } sans grandeur
      // numerique. Le golden-runner refuserait un `expected` sans feuille numerique
      // (anti faux-vert legitime) ; on compare donc directement le message d'erreur,
      // qui EST la sortie attendue de ce cas.
      const ref = computeAll(fx.input) as { err?: unknown };
      const mod = computeTerzaghi(fx.input) as { err?: unknown };
      expect(typeof ref.err).toBe('string');
      expect(mod.err).toBe(ref.err);
    });
  }

  // Liberation jsdom (apres definition des tests ; appel synchrone au teardown).
  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
