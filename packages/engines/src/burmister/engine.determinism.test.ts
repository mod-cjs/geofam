/**
 * DETERMINISME & PURETE (DOM-free) du module burmister (#46, criteres 1 & 2).
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance : un moteur pur ne doit pas
 *     varier d'un iota entre deux appels.
 *  2. Purete DOM/IO : le code SOURCE du module (engine.ts/contract.ts/index.ts)
 *     ne contient AUCUNE reference a `document`/`window`/`fetch`/horloge/hasard,
 *     ni iteration instable (`for..in`) sur des objets. C'est la preuve « grep
 *     vide » exigee par le critere 1 (couplage DOM retire).
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI) : ils
 * portent sur le MODULE extrait, pas sur l'equivalence (cf. engine.equivalence.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeBurmister } from './engine.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('burmister — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of BURMISTER_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeBurmister(fx.input));
      for (let i = 0; i < 100; i++) {
        // Egalite STRICTE : aucune tolerance. Un ecart = non-determinisme.
        expect(JSON.stringify(computeBurmister(fx.input))).toBe(ref);
      }
    });
  }
});

describe('burmister — purete DOM/IO (le module est DOM-free)', () => {
  // Fichiers de CALCUL du module (hors tests/fixtures/harnais qui, eux, lisent le FS).
  const SRC_FILES = ['engine.ts', 'contract.ts', 'index.ts'];
  // Motifs interdits dans un module moteur pur : DOM, reseau, horloge, hasard,
  // iteration d'objet a ordre potentiellement instable.
  const FORBIDDEN: Array<{ id: string; re: RegExp }> = [
    { id: 'document.', re: /\bdocument\s*\./ },
    { id: 'window.', re: /\bwindow\s*\./ },
    { id: 'fetch(', re: /\bfetch\s*\(/ },
    { id: 'new Date()', re: /\bnew\s+Date\s*\(\s*\)/ },
    { id: 'Date.now(', re: /\bDate\.now\s*\(/ },
    { id: 'Math.random(', re: /\bMath\.random\s*\(/ },
    { id: 'performance.now', re: /\bperformance\s*\.\s*now\s*\(/ },
    { id: 'for..in', re: /\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+in\b/ },
  ];

  for (const file of SRC_FILES) {
    it(`[${file}] ne contient aucune reference DOM/IO/horloge/hasard/for..in`, () => {
      const content = readFileSync(resolve(here, file), 'utf8');
      const found = FORBIDDEN.filter((p) => p.re.test(content)).map((p) => p.id);
      expect(found, `motifs interdits trouves dans ${file}`).toEqual([]);
    });
  }

  it('la verification MORD (test negatif) : un motif DOM serait bien detecte', () => {
    // Anti faux-vert : prouve que le grep n'est pas inerte.
    const temoin = 'const x = document.getElementById("a");';
    const re = /\bdocument\s*\./;
    expect(re.test(temoin)).toBe(true);
  });
});
