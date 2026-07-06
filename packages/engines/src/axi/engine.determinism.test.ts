/**
 * DETERMINISME & PURETE (DOM-free) du module axisymetrique.
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance : un moteur pur (meme avec de
 *     l'algebre dense + quadratures) ne doit pas varier d'un iota entre deux appels.
 *  2. Purete DOM/IO : le code SOURCE du module (engine.ts/contract.ts) ne contient AUCUNE
 *     reference a `document`/`window`/`fetch`/horloge/hasard, ni iteration instable
 *     (`for..in`). Le `solveAxi` d'origine lisait la globale `state` + les champs de
 *     saisie ; tout cela a ete REMPLACE par un etat injecte a l'extraction.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI) : ils portent sur le
 * MODULE extrait, pas sur l'equivalence (cf. engine.equivalence.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeAxi } from './engine.js';
import { AXI_FIXTURES } from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('axi — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of AXI_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeAxi({ layers: fx.input.layers }, fx.input.o));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(computeAxi({ layers: fx.input.layers }, fx.input.o))).toBe(
          ref,
        );
      }
    });
  }

  it('ne MUTE pas l entree (2 appels sur le MEME objet -> meme resultat)', () => {
    const fx = AXI_FIXTURES.find((f) => f.id === 'q-plus-pc-combinees');
    expect(fx).toBeDefined();
    if (!fx) return;
    const first = JSON.stringify(computeAxi({ layers: fx.input.layers }, fx.input.o));
    const second = JSON.stringify(computeAxi({ layers: fx.input.layers }, fx.input.o));
    expect(second).toBe(first);
  });

  it('SMOKE : un cas nominal produit wc/wEdge/mrMax/pMax finis', () => {
    const fx = AXI_FIXTURES.find((f) => f.id === 'q-reparti-2couches');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeAxi({ layers: fx.input.layers }, fx.input.o) as Record<
      string,
      unknown
    >;
    expect(R.err).toBeUndefined();
    expect(Number.isFinite(R.wc as number)).toBe(true);
    expect(Number.isFinite(R.wEdge as number)).toBe(true);
    expect(Number.isFinite(R.mrMax as number)).toBe(true);
    expect(Number.isFinite(R.pMax as number)).toBe(true);
  });
});

describe('axi — garde du moteur exercee AU NIVEAU MOTEUR (avant schema)', () => {
  it('aucune couche -> erreur bornee « au moins une couche de sol »', () => {
    const r = computeAxi(
      { layers: [] },
      { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 120, Pc: 0, ne: 12, foundD: 0 },
    ) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/couche de sol/);
  });
});

describe('axi — purete DOM/IO (le module est DOM-free)', () => {
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
    const temoin = 'setTimeout(()=>{ doSolve(); },30);';
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
      const found = FORBIDDEN_IMPORTS.filter((re) => re.test(content)).map(
        (re) => re.source,
      );
      expect(found, `import d outillage de test dans ${file}`).toEqual([]);
    }
  });
});
