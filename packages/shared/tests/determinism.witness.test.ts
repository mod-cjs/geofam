/**
 * TEMOIN DE DETERMINISME DES MOTEURS (cœur de la conformite a venir).
 *
 * Ce test scanne le code SOURCE reel de @roadsen/engines et ECHOUE si un moteur
 * introduit une source connue de non-determinisme (Date.now(), Math.random(),
 * new Date() sans argument, process.env, hrtime, randomUUID/randomBytes...).
 *
 * Pourquoi ici (packages/shared) et pas dans packages/engines :
 *   - on ne fait AUCUN import du code moteur (scan filesystem) -> zero risque
 *     de confidentialite (DoD 8) et zero couplage ;
 *   - le temoin tourne meme quand engines est encore vide (socle) : il passe
 *     alors trivialement, et se DURCIT automatiquement des qu un moteur arrive.
 *
 * Echappement : une ligne legitimement non "pure" (ex. horodatage d un log hors
 * calcul) doit porter le commentaire `determinism-allow: <justification>`. C est
 * un acte conscient, trace en revue, pas un contournement silencieux.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  scanForNonDeterminism,
  formatDeterminismHits,
} from '../src/testing/determinism-scan.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/shared/tests -> packages/engines/src
const ENGINES_SRC = resolve(here, '..', '..', 'engines', 'src');

describe('Temoin de determinisme @roadsen/engines', () => {
  it('le repertoire moteurs est localisable', () => {
    // Garde-fou anti faux-vert : si le chemin est faux, le scan renverrait []
    // (repertoire inexistant) et passerait sans rien verifier. On exige que la
    // cible existe (le socle cree deja packages/engines/src).
    expect(existsSync(ENGINES_SRC)).toBe(true);
  });

  it('aucun code moteur n introduit de non-determinisme', () => {
    const hits = scanForNonDeterminism(ENGINES_SRC);
    if (hits.length > 0) {
      throw new Error(
        `NON-DETERMINISME detecte dans @roadsen/engines (un moteur DOIT etre pur) :\n` +
          formatDeterminismHits(hits) +
          `\n\nCorrige le moteur, ou justifie explicitement par un commentaire ` +
          `'determinism-allow: <raison>' si la ligne est hors calcul.`,
      );
    }
    expect(hits).toEqual([]);
  });
});
