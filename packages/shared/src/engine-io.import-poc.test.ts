/**
 * C3 — le contrat d I/O est importable par le front ET le back SANS tirer
 * @roadsen/engines.
 *
 * Preuve a deux niveaux :
 *  1) Import reel du module contrat (ici, en environnement Node de test) : il
 *     se charge sans dependance moteur. Si le module importait un moteur,
 *     ce simple import echouerait (le package @roadsen/engines n est pas une
 *     dependance de @roadsen/shared).
 *  2) Analyse STATIQUE du graphe de fichiers du contrat : aucun specifier
 *     `@roadsen/engines` (ni chemin packages/engines) n y apparait. C est la
 *     garantie utile cote front, ou un import moteur serait une fuite (DoD 8)
 *     et est deja bloque par le garde-fou ESLint no-restricted-imports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Import reel (niveau 1) : prouve que le module se charge sans moteur.
import * as contrat from './engine-io.js';
import * as reference from './engine-io.reference.js';

const here = dirname(fileURLToPath(import.meta.url));

// Fichiers composant la couche CONTRAT (ce que le front importerait). DERIVE
// du dossier (anti-desynchro avec une liste figee) : tout `engine-io*.ts` hors
// test, plus le barrel `index.ts`. Un nouveau fichier de contrat est ainsi
// couvert automatiquement.
const FICHIERS_CONTRAT = [
  ...readdirSync(here).filter(
    (f) =>
      f.startsWith('engine-io') &&
      f.endsWith('.ts') &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.spec.ts'),
  ),
  'index.ts',
];

/**
 * On ne grepe PAS le texte brut (la doc du module cite legitimement
 * "@roadsen/engines" pour expliquer l interdit). On extrait les SPECIFIERS
 * d import/export reels et on verifie qu aucun ne pointe vers un moteur.
 */
const SPECIFIERS_INTERDITS = [/@roadsen\/engines/, /packages\/engines/];

/** Extrait les specifiers de `import ... from '...'`, `export ... from '...'`. */
function specifiersImportes(source: string): string[] {
  const re = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  // import('...') dynamiques eventuels :
  const reDyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reDyn.exec(source)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

describe('C3 — contrat importable sans @roadsen/engines', () => {
  it('le module contrat se charge (import reel reussi, sans moteur)', () => {
    expect(typeof contrat.defineEngineContract).toBe('function');
    expect(reference.referenceEngineContract.id).toBe('reference');
  });

  it('aucun IMPORT du contrat ne pointe vers @roadsen/engines (analyse statique)', () => {
    for (const fichier of FICHIERS_CONTRAT) {
      const source = readFileSync(join(here, fichier), 'utf8');
      for (const specifier of specifiersImportes(source)) {
        for (const motif of SPECIFIERS_INTERDITS) {
          expect(
            motif.test(specifier),
            `${fichier} importe ${specifier} (interdit : ${motif})`,
          ).toBe(false);
        }
      }
    }
  });
});
