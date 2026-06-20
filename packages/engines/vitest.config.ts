/**
 * Vitest — package @roadsen/engines (moteurs de calcul, COTE SERVEUR UNIQUEMENT).
 *
 * Etat actuel : le package est un emplacement prepare ; l extraction des moteurs
 * (HTML -> module TS pur) est menee par `integrateur-moteurs` + `qa-test`.
 * Tant qu aucun moteur n est extrait, il n y a pas encore de test unitaire ICI
 * -> passWithNoTests = true (un run vide est honnete, pas un faux-vert).
 *
 * DES qu un moteur arrive : couverture elevee exigee (cf. packages/engines/README.md),
 * golden tests issus des cas-tests STARFIRE, et le temoin de determinisme
 * (packages/shared/tests/determinism.witness.test.ts) qui scanne ce package.
 *
 * Quand les premiers golden tests existeront, basculer passWithNoTests a false
 * et activer les seuils de couverture ci-dessous (commentes pour l instant).
 */
import { baseVitestConfig } from '../../vitest.shared.js';

export default baseVitestConfig({
  test: {
    passWithNoTests: true,
    // A activer avec les premiers moteurs extraits :
    // coverage: { thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 } },
  },
});
