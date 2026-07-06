/**
 * EQUIVALENCE-PORTAGE deformations planes : module TS extrait <-> HTML d'origine (jsdom).
 *
 * @science-unsigned — prouve le PORTAGE (le module reproduit l'origine), PAS la
 * justesse scientifique (kit cas-tests STARFIRE indisponible). MJ-6 : pas de prod sans
 * conformite.
 *
 * Methode : pour chaque jeu d'entrees, on pilote le HTML d'ORIGINE via jsdom (on
 * renseigne `state.layers` et on appelle `solvePlaneStrain(opts)` directement — voir
 * loadOriginalCompute) ET le module TS, et on compare les resultats BRUTS `R` (tous
 * champs : X/w/p/M/V + scalaires) a une tolerance de portage SERREE (rel 1e-9). Le
 * harnais golden @roadsen/shared est l'arbitre (anti auto-reference : provenance !=
 * module sous test).
 *
 * C'est l'arbitre ABSOLU sur l'algebre dense (poutre, souplesse nn×nn, solveDense LU,
 * inv). Transcription VERBATIM cote module -> memes operations, meme ordre -> memes
 * flottants sur le MEME runtime V8.
 *
 * NORMALISATION : le resultat HTML traverse un aller-retour JSON (typed arrays -> objets
 * indexes, Infinity/NaN -> null). On impose au module la MEME serialisation
 * (jsonRoundTrip) pour comparer a perimetre identique.
 *
 * GATE LOCAL : les sources moteur sont HORS depot git. En CI elles sont absentes ->
 * SKIP BRUYANT (jamais un faux-vert). « 0 cas execute » localement serait un echec.
 */
import type { GoldenCase } from '@roadsen/shared/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computePlaneStrain } from './engine.js';
import {
  jsonRoundTrip,
  loadOriginalCompute,
  planeStrainRegistrySha256,
  planeStrainSourceAvailable,
  planeStrainSourceSha256,
  sanitizeResult,
} from './equivalence-harness.js';
import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'plane-strain';
/** Tolerance de PORTAGE serree : module et origine sont le MEME code, on vise l'egalite. */
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = planeStrainSourceAvailable();

describe('deformations planes — equivalence-portage module <-> HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      'AVERTISSEMENT : source GEOPLAQUE_V10.html ABSENTE ' +
      '(03-Moteurs-client/ hors depot git). L equivalence-portage N A PAS ete verifiee ' +
      '— gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();

  const cmpFixtures = PLANE_STRAIN_FIXTURES.filter((f) => !f.horsDomaine);
  const horsDomaine = PLANE_STRAIN_FIXTURES.filter((f) => f.horsDomaine);

  it('compare AU MOINS 6 jeux d entrees nominaux/bornes (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(6);
  });

  it('couvre au moins un cas HORS-DOMAINE', () => {
    expect(horsDomaine.length).toBeGreaterThanOrEqual(1);
  });

  // Le SHA-256 de la source testee doit etre EXACTEMENT celui scelle au registre.
  it('le SHA-256 de la source testee == sha256 scelle au registre (pas un autre moteur)', () => {
    expect(planeStrainSourceSha256()).toBe(planeStrainRegistrySha256());
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] module == origine (rel ${PORTAGE_TOLERANCE.rel}) — ${fx.description}`, () => {
      const reference = sanitizeResult(computeHtml(fx.input));
      const testCase: GoldenCase = {
        id: fx.id,
        description: fx.description,
        provenance: 'HTML-origine',
        inputs: fx.input,
        expected: reference,
        defaultTolerance: { ...PORTAGE_TOLERANCE },
      };
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) => {
        const inp = inputs as (typeof PLANE_STRAIN_FIXTURES)[number]['input'];
        return sanitizeResult(jsonRoundTrip(computePlaneStrain(inp, inp.opts)));
      });
      if (!result.equal) {
        const lignes = result.diffs
          .slice(0, 20)
          .map(
            (d: { path: string; expected: unknown; actual: unknown; reason: string }) =>
              `  - ${d.path || '(racine)'} : origine=${JSON.stringify(d.expected)} ` +
              `module=${JSON.stringify(d.actual)} [${d.reason}]`,
          )
          .join('\n');
        throw new Error(
          `Ecart de PORTAGE sur "${fx.id}" (defaut d integration, a NOTRE charge) ` +
            `[${result.diffs.length} diff] :\n${lignes}`,
        );
      }
      expect(result.equal).toBe(true);
    });
  }

  for (const fx of horsDomaine) {
    it(`[${fx.id}] resultat IDENTIQUE origine/module — ${fx.description}`, () => {
      const ref = sanitizeResult(computeHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computePlaneStrain(fx.input, fx.input.opts)));
      expect(mod).toEqual(ref);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
