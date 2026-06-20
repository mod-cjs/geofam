/**
 * Configuration Vitest de base, partagee par chaque package testable.
 *
 * Chaque package (`packages/shared`, `packages/engines`, ...) etend cette base
 * via `vitest.config.ts` afin que :
 *   - `pnpm test` (turbo -> `vitest run` par package) soit coherent partout ;
 *   - `pnpm test -- --coverage` (job CI "unit") produise un rapport par package
 *     dans le dossier coverage/ de chaque package (deja ignore par .gitignore,
 *     et capture comme artefact CI).
 *
 * Note confidentialite (DoD 8) : ce fichier ne contient AUCUNE logique moteur ;
 * c est de la configuration d outillage de test, cote depot uniquement.
 */
import { defineConfig } from 'vitest/config';

/**
 * Fabrique une config Vitest pour un package.
 * @param overrides surcouche specifique (ex. seuils de couverture moteurs).
 */
export function baseVitestConfig(overrides: Parameters<typeof defineConfig>[0] = {}) {
  return defineConfig({
    test: {
      // Environnement Node : les moteurs et le code partage sont server-only,
      // sans DOM. Aucun test ne doit dependre du navigateur.
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
      // Un test doit echouer pour la bonne raison : pas de fichier de test vide
      // qui "passe" en ne verifiant rien.
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage',
        reporter: ['text', 'lcov'],
        // Couverture mesuree sur le code source uniquement.
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
      },
    },
    ...overrides,
  });
}
