/**
 * DETERMINISME & PURETE (DOM-free) du module CALIBRAGE.
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance. Le tri par P doit donner un
 *     resultat STABLE (tri numerique stable sur cles distinctes).
 *  2. Purete DOM/IO : le code SOURCE (engine.ts/contract.ts) ne contient AUCUNE reference
 *     a `document`/`window`/`fetch`/horloge/hasard, ni iteration instable (`for..in`).
 *     La lecture de la globale `calibRows` a ete REMPLACEE par une entree injectee.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeCalibrage } from './engine.js';
import { PRESSIO_CALIBRAGE_FIXTURES } from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('calibrage — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of PRESSIO_CALIBRAGE_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeCalibrage(fx.input));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(computeCalibrage(fx.input))).toBe(ref);
      }
    });
  }

  it('le tri interne ne change pas d un appel a l autre (entree non triee)', () => {
    const fx = PRESSIO_CALIBRAGE_FIXTURES.find((f) => f.id === 'ordre-non-trie');
    expect(fx).toBeDefined();
    if (!fx) return;
    const a = JSON.stringify(computeCalibrage(fx.input));
    const b = JSON.stringify(computeCalibrage(fx.input));
    expect(b).toBe(a);
  });

  it('SMOKE : un cas nominal produit a_calib/R2/rms finis', () => {
    const fx = PRESSIO_CALIBRAGE_FIXTURES.find((f) => f.id === 'demo-origine-10-paliers');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeCalibrage(fx.input) as Record<string, unknown>;
    expect(R.err).toBeUndefined();
    expect(Number.isFinite(R.a_calib as number)).toBe(true);
    expect(Number.isFinite(R.R2 as number)).toBe(true);
    expect(Number.isFinite(R.rms as number)).toBe(true);
  });
});

describe('calibrage — garde du moteur exercee AU NIVEAU MOTEUR (avant schema)', () => {
  it('< 3 points -> erreur bornee « au moins 3 points »', () => {
    const r = computeCalibrage({
      rows: [
        { p: 2, v60: 1 },
        { p: 6, v60: 3 },
      ],
    }) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/3 points/);
  });
});

describe('calibrage — purete DOM/IO (le module est DOM-free)', () => {
  const SRC_FILES = ['engine.ts', 'contract.ts'];
  const FORBIDDEN: Array<{ id: string; re: RegExp }> = [
    { id: 'document.', re: /\bdocument\s*\./ },
    { id: 'window.', re: /\bwindow\s*\./ },
    { id: 'fetch(', re: /\bfetch\s*\(/ },
    { id: 'new Date()', re: /\bnew\s+Date\s*\(/ },
    { id: 'Date.now(', re: /\bDate\.now\s*\(/ },
    { id: 'Math.random(', re: /\bMath\.random\s*\(/ },
    { id: 'performance.now(', re: /\bperformance\s*\.\s*now\s*\(/ },
    { id: 'setTimeout(', re: /\bsetTimeout\s*\(/ },
    { id: 'for..in', re: /\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+in\b/ },
  ];

  for (const file of SRC_FILES) {
    it(`[${file}] ne contient aucune reference DOM/IO/horloge/hasard/setTimeout/for..in`, () => {
      const content = readFileSync(resolve(here, file), 'utf8');
      const found = FORBIDDEN.filter((p) => p.re.test(content)).map((p) => p.id);
      expect(found, `motifs interdits trouves dans ${file}`).toEqual([]);
    });
  }

  it('la verification MORD (test negatif) : un setTimeout( serait bien detecte', () => {
    const temoin = 'setTimeout(()=>{ drawCalibChart(); },100);';
    const re = /\bsetTimeout\s*\(/;
    expect(re.test(temoin)).toBe(true);
  });

  it('les fichiers de calcul N IMPORTENT PAS jsdom / fs / crypto (purete transitive)', () => {
    const FORBIDDEN_IMPORTS = [
      /['"]jsdom['"]/,
      /node:fs\b/,
      /\bfrom ['"]fs['"]/,
      /node:crypto\b/,
    ];
    for (const file of SRC_FILES) {
      const content = readFileSync(resolve(here, file), 'utf8');
      const found = FORBIDDEN_IMPORTS.filter((re) => re.test(content)).map((re) => re.source);
      expect(found, `import d outillage de test dans ${file}`).toEqual([]);
    }
  });
});
