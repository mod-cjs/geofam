/**
 * EQUIVALENCE-PORTAGE FASTLAB : module TS extrait <-> HTML d'origine (jsdom).
 *
 * @science-unsigned — prouve le PORTAGE (le module reproduit l'origine), PAS la
 * justesse scientifique (kit STARFIRE #36). MJ-6 : pas de prod sans conformite.
 *
 * Methode : pour chaque jeu d'entrees, on pilote le HTML d'ORIGINE via jsdom (remplit
 * les champs .save + globales de mode, appelle recalc(), capture { D, cls } —
 * voir loadOriginalCompute) ET le module TS, et on compare les resultats BRUTS (tout
 * `D` : wn/p80/Ip/VBS/wOPN/CBR/Cc/Cs/... + la classification : code GTR, chemin de
 * decision, warnings) a une tolerance de portage SERREE (rel 1e-9) ET egalite stricte
 * des LIBELLES (code/path/warn). Le harnais golden @roadsen/shared est l'arbitre.
 *
 * NORMALISATION : aller-retour JSON des deux cotes (jsonRoundTrip) — perimetre identique.
 *
 * GATE LOCAL : sources hors depot git -> SKIP BRUYANT en CI (jamais un faux-vert).
 */
import type { GoldenCase } from '@roadsen/shared/src/testing/golden-case.js';
import { runGoldenCase } from '@roadsen/shared/src/testing/golden-runner.js';
import { describe, expect, it } from 'vitest';

import { computeLabo } from './engine.js';
import {
  jsonRoundTrip,
  laboRegistrySha256,
  laboSourceAvailable,
  laboSourceSha256,
  loadOriginalCompute,
  sanitizeResult,
} from './equivalence-harness.js';
import { LABO_FIXTURES } from './test-fixtures.js';

const MODULE_UNDER_TEST = 'labo-classification-gtr';
const PORTAGE_TOLERANCE = { rel: 1e-9, abs: 1e-12 } as const;

const SOURCE_OK = laboSourceAvailable();

describe('labo — equivalence-portage module <-> HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[#49-53] AVERTISSEMENT : source FASTLAB7.html ABSENTE (03-Moteurs-client/ hors depot ' +
      'git). L equivalence-portage N A PAS ete verifiee — gate LOCAL uniquement. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence-portage NON verifiee (source absente) — ${msg}`, () => {
      /* volontairement skip : source hors depot */
    });
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();

  // Cas NUMERIQUES (>=1 grandeur calculee) -> golden-runner (tolerance signee). Les cas
  // INDETERMINES (echantillon vide : D tout-null, classe sans code = aucun nombre) sont
  // refuses par le filet anti-faux-vert du golden-runner ; on les compare separement par
  // egalite structurelle stricte (origine == module), exactement comme les hors-domaine
  // des autres moteurs.
  const cmpFixtures = LABO_FIXTURES.filter((f) => !f.indetermine);
  const indetermines = LABO_FIXTURES.filter((f) => f.indetermine);

  it('compare AU MOINS 10 jeux d entrees numeriques (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('couvre au moins un cas INDETERMINE (echantillon non classable)', () => {
    expect(indetermines.length).toBeGreaterThanOrEqual(1);
  });

  it('le SHA-256 de la source testee == sha256 scelle au registre (pas un autre moteur)', () => {
    expect(laboSourceSha256()).toBe(laboRegistrySha256());
  });

  for (const fx of indetermines) {
    it(`[${fx.id}] resultat IDENTIQUE origine/module — ${fx.description}`, () => {
      const ref = sanitizeResult(computeHtml(fx.input));
      const mod = sanitizeResult(jsonRoundTrip(computeLabo(fx.input)));
      expect(mod).toEqual(ref);
    });
  }

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
      const result = runGoldenCase(testCase, MODULE_UNDER_TEST, (inputs: unknown) =>
        sanitizeResult(jsonRoundTrip(computeLabo(inputs))),
      );
      if (!result.equal) {
        const lignes = result.diffs
          .slice(0, 25)
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

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
