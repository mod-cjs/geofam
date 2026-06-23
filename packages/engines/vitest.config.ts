/**
 * Vitest — package @roadsen/engines (moteurs de calcul, COTE SERVEUR UNIQUEMENT).
 *
 * Le package porte desormais le REGISTRE versionne des moteurs (incrément #37)
 * et son test de coherence hash -> il y a de VRAIS tests : passWithNoTests
 * revient au defaut (false) de la base partagee (un run vide redevient une
 * erreur, pas un faux-vert).
 *
 * DES qu un moteur de CALCUL est extrait : couverture elevee exigee
 * (cf. packages/engines/README.md), golden tests issus des cas-tests STARFIRE,
 * et le temoin de determinisme (packages/shared/tests/determinism.witness.test.ts)
 * qui scanne ce package. Les seuils de couverture ci-dessous seront actives a
 * ce moment-la (le registre seul est de la metadonnee, pas de la science a
 * couvrir massivement).
 */
import { baseVitestConfig } from '../../vitest.shared.js';

export default baseVitestConfig({
  // A activer avec les premiers moteurs de calcul extraits :
  // test: { coverage: { thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 } } },
});
