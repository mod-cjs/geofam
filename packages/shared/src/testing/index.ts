/**
 * Boite a outils de test ROADSEN (server-only, AUCUN symbole moteur).
 *
 * - golden             : comparateur generique champ-a-champ, tolerance parametrable.
 * - golden-case        : lecteur/validateur de cas-tests (Zod), provenance + anti-auto-ref.
 * - tolerance-profiles : profils de tolerance nommes reutilisables (ex. FEM).
 * - golden-runner      : execute un cas (entrees -> moteur -> comparaison).
 * - golden.assert      : pont Vitest (`expectGolden`) — a importer seulement en test.
 * - determinism-scan   : temoin de (non-)determinisme des moteurs.
 *
 * A NE PAS importer depuis apps/web : c est de l outillage serveur/test.
 */
export * from './golden.js';
export * from './golden-case.js';
export * from './tolerance-profiles.js';
export * from './golden-runner.js';
export * from './determinism-scan.js';
// golden.assert importe `vitest` (devDep) : a importer directement dans les tests
// via le sous-chemin public (`@roadsen/shared/testing/golden.assert.js`), pas via
// cet index runtime.
