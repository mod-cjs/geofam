/**
 * SQUELETTE (skip visible) — Equivalence moteur : module TS extrait <-> HTML d origine.
 *
 * Etat : EN ATTENTE. L extraction des moteurs (HTML GeoSuite -> module TS pur)
 * est menee par `integrateur-moteurs`. Tant qu aucun moteur n est extrait, ce
 * test ne peut RIEN verifier de reel -> il est `.skip` (visible dans le rapport),
 * jamais un test creux qui passerait en vert sans assertion.
 *
 * Quand le 1er moteur arrive, ce squelette devient :
 *   1. charger les cas-tests STARFIRE (la spec) ;
 *   2. pour chaque cas : executer le module extrait ET lire la sortie de
 *      reference (valeur produite par le HTML d origine, figee) ;
 *   3. expectGolden(sortieModule, sortieReference, { toleranceByPath: ... })
 *      avec la TOLERANCE SERREE convenue module<->origine (a documenter par cas).
 *
 * Outils prets : `expectGolden` (packages/shared/src/testing/golden.assert).
 * Dependance externe : valeurs de reference HTML + matrice de cas-tests STARFIRE
 * (non encore versionnees dans le depot).
 */
import { describe, it } from 'vitest';

describe('Equivalence module<->HTML (chaussees, fondations, ...)', () => {
  it.skip(
    'TODO[#equivalence-moteurs] chaque cas-test STARFIRE : module == HTML (tolerance serree convenue) ' +
      '— bloque sur : extraction moteur (integrateur-moteurs) + valeurs de reference HTML + matrice cas-tests',
    () => {
      // Volontairement vide : un skip doit rester un skip, pas un faux-vert.
      // Activation : remplacer .skip par l implementation golden ci-dessus.
    },
  );
});
