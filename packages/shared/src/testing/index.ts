/**
 * Boite a outils de test ROADSEN (server-only, AUCUN symbole moteur).
 *
 * - golden            : comparateur generique champ-a-champ, tolerance parametrable.
 * - golden.assert     : pont Vitest (`expectGolden`) — a importer seulement en test.
 * - determinism-scan  : temoin de (non-)determinisme des moteurs.
 *
 * A NE PAS importer depuis apps/web : c est de l outillage serveur/test.
 */
export * from './golden.js';
export * from './determinism-scan.js';
// golden.assert importe `vitest` (devDep) : a importer directement dans les tests
// (`@roadsen/shared/src/testing/golden.assert`), pas via cet index runtime.
