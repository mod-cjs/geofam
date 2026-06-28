import { defineConfig } from 'vitest/config';

/**
 * Config Vitest AUTO-CONTENUE pour Stryker (mutation testing).
 *
 * Stryker copie le package dans un sandbox isolé ; la `vitest.config.ts`
 * normale importe `../../vitest.shared.ts` (hors package) -> non résoluble dans
 * le sandbox. Cette config NE dépend de RIEN d'externe. Pas de couverture ici
 * (Stryker gère sa propre analyse `perTest`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Uniquement les tests sous src/ (ceux des modules mutés : engine-io, golden).
    // On EXCLUT tests/** (témoin de déterminisme/skeletons) : ces tests dépendent
    // de la disposition du monorepo et cassent dans le sandbox isolé de Stryker —
    // ils ne couvrent pas les modules mutés, donc hors périmètre mutation.
    include: ['src/**/*.{test,spec}.ts'],
    passWithNoTests: false,
  },
});
