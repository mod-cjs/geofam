/**
 * EQUIVALENCE-PORTAGE pieux : module TS extrait <-> HTML d'origine (jsdom).
 *
 * @science-unsigned — prouve le PORTAGE (le module reproduit l'origine), PAS la
 * justesse scientifique (kit cas-tests STARFIRE indisponible, #36). MJ-6 : pas de
 * prod sans conformite.
 *
 * Methode : pour chaque jeu d'entrees, on pilote le HTML d'ORIGINE via jsdom
 * (reference, provenance 'HTML-origine' — voir loadOriginalCompute pour le mecanisme
 * de pilotage du `compute()` non-pur : interception de renderResults, neutralisation
 * du rendu/dessin) ET le module TS, et on compare les resultats BRUTS `R` (tous
 * champs, intermediaires compris : detail de frottement par couche, facteurs de
 * portance, courbe de tassement...) a une tolerance de portage SERREE (rel 1e-9). Le
 * harnais golden @roadsen/shared est l'arbitre (anti auto-reference : provenance !=
 * module sous test).
 *
 * NORMALISATION : le resultat HTML traverse un aller-retour JSON (eval renvoie une
 * chaine). On impose au module la MEME serialisation (jsonRoundTrip) pour comparer a
 * perimetre identique (Infinity/NaN -> null, undefined/fonctions omis) — sinon ce
 * serait un FAUX ecart.
 *
 * GATE LOCAL : les sources moteur sont HORS depot git (03-Moteurs-client). En CI elles
 * sont absentes -> SKIP BRUYANT (jamais un faux-vert). « 0 cas execute » localement
 * (sources presentes mais aucun cas) serait un echec : on l'assert.
 */
import type { GoldenCase } from '@roadsen/shared/src/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/src/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computePieux } from './engine.js';
import {
  jsonRoundTrip,
  loadOriginalCompute,
  pieuxRegistrySha256,
  pieuxSourceAvailable,
  pieuxSourceSha256,
  sanitizeResult,
} from './equivalence-harness.js';
import { PIEUX_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'fondation-profonde-pieux';
/** Tolerance de PORTAGE serree : module et origine sont le MEME code, on vise l'egalite. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = pieuxSourceAvailable();

describe('pieux — equivalence-portage module <-> HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#48] AVERTISSEMENT : source casagrande_V5.html ABSENTE ' +
      '(03-Moteurs-client/ hors depot git). L equivalence-portage N A PAS ete verifiee ' +
      '— gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  // On charge le moteur d'origine UNE fois (jsdom couteux). cleanup en fin de suite.
  const { computeHtml, cleanup } = loadOriginalCompute();

  // Filet anti faux-vert : on EXIGE >=10 cas effectivement compares.
  const cmpFixtures = PIEUX_FIXTURES.filter((f) => !f.horsDomaine);
  const horsDomaine = PIEUX_FIXTURES.filter((f) => f.horsDomaine);

  it('compare AU MOINS 10 jeux d entrees nominaux/bornes (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('couvre au moins un cas HORS-DOMAINE', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  // MINEUR-1 (#48) : la source testee doit etre EXACTEMENT celle scellee au registre
  // (sinon on prouve l'equivalence contre un autre moteur que celui scelle au PV). Le
  // mismatch est un ECHEC DUR (loadOriginalCompute throw deja) ; on l'assert ici de
  // facon EXPLICITE et lisible.
  it('le SHA-256 de la source testee == sha256 scelle au registre (pas un autre moteur)', () => {
    expect(pieuxSourceSha256()).toBe(pieuxRegistrySha256());
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      // REFERENCE : objet `R` BRUT du HTML d'origine (provenance externe au module).
      const reference = sanitizeResult(computeHtml(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-origine',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      // run = module TS extrait. MEME normalisation (jsonRoundTrip puis sanitize) que
      // la reference (qui a deja traverse un JSON via eval).
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(jsonRoundTrip(computePieux(inputs))),
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
    it(`[${fx.id}] resultat IDENTIQUE origine/module — ${fx.description}`, () => {
      // Cas hors-domaine : le HTML rend `renderResults({err:...})` (capture par le
      // harnais) ; le module renvoie aussi `{ err }`. On compare le resultat complet
      // (sanitise) : il doit etre IDENTIQUE des deux cotes.
      const ref = sanitizeResult(computeHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computePieux(fx.input)));
      expect(mod).toEqual(ref);
    });
  }

  // Liberation jsdom (apres definition des tests ; appel synchrone au teardown).
  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
