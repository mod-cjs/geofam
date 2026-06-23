/**
 * Configuration Vitest de base, partagee par chaque package testable.
 *
 * Chaque package (`packages/shared`, `packages/engines`, ...) etend cette base
 * via `vitest.config.ts` afin que :
 *   - `pnpm test` (turbo -> `vitest run` par package) soit coherent partout ;
 *   - `pnpm test:cov` (ou `vitest run --coverage`) applique la PORTE DE
 *     COUVERTURE (DoD §9) : seuils PLANCHERS, `all: true` (le code neuf NON
 *     teste fait baisser la couverture -> filet anti-regression reel).
 *
 * Les seuils ne se declenchent QU'AVEC `--coverage` (donc pas sur le `test`
 * rapide de dev / pre-push ; ils gardent le gate complet et la CI). On les
 * remonte au fil du temps (ratchet), jamais on ne les baisse en douce. La
 * couverture reste NECESSAIRE mais NON SUFFISANTE -> cf. mutation testing.
 *
 * Note confidentialite (DoD 8) : ce fichier ne contient AUCUNE logique moteur ;
 * c est de la configuration d outillage de test, cote depot uniquement.
 */
import { defineConfig } from 'vitest/config';

const baseTest = {
  // Environnement Node : code partage et moteurs sont server-only, sans DOM.
  environment: 'node' as const,
  include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
  // Un test doit echouer pour la bonne raison : pas de fichier de test vide
  // qui "passe" en ne verifiant rien.
  passWithNoTests: false,
};

const baseCoverage = {
  provider: 'v8' as const,
  reportsDirectory: 'coverage',
  reporter: ['text-summary', 'text', 'lcov'],
  // `all: true` -> tout src/ compte, meme non importe par un test.
  all: true,
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
  // Planchers anti-regression (sous la mesure courante de @roadsen/shared :
  // ~92 % statements/lines, ~96 % branches, ~82 % functions). Ratchet vers le haut.
  thresholds: {
    statements: 85,
    branches: 88,
    functions: 75,
    lines: 85,
  },
};

/**
 * Fabrique une config Vitest pour un package. Fusion EN PROFONDEUR du bloc
 * `test` (et de `coverage`) : un override partiel ne doit pas ECRASER la base
 * (sinon environnement/include/couverture seraient perdus).
 * @param overrides surcouche specifique (ex. seuils de couverture moteurs).
 */
export function baseVitestConfig(overrides: Parameters<typeof defineConfig>[0] = {}) {
  const { test: testOverrides = {}, ...rest } = overrides as {
    test?: Record<string, unknown> & { coverage?: Record<string, unknown> };
  };
  const { coverage: coverageOverrides = {}, ...restTest } = testOverrides;
  return defineConfig({
    test: {
      ...baseTest,
      ...restTest,
      coverage: { ...baseCoverage, ...coverageOverrides },
    },
    ...rest,
  });
}
