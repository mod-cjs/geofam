/**
 * DETERMINISME & PURETE (DOM-free) du module radier (#54, criteres 1 & 2).
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance : un moteur pur (meme avec de
 *     l'algebre dense) ne doit pas varier d'un iota entre deux appels.
 *  2. Purete DOM/IO : le code SOURCE du module (engine.ts/contract.ts/index.ts) ne
 *     contient AUCUNE reference a `document`/`window`/`fetch`/horloge/hasard, ni
 *     iteration instable (`for..in`) sur des objets. Le `solveModel` d'origine etait
 *     couple a la globale `state` + chrono d'affichage ; tout cela a ete REMPLACE par
 *     un etat injecte a l'extraction.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI) : ils portent
 * sur le MODULE extrait, pas sur l'equivalence (cf. engine.equivalence.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeRadier } from './engine.js';
import { RADIER_FIXTURES } from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('radier — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of RADIER_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeRadier(fx.input, fx.input.opts));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(computeRadier(fx.input, fx.input.opts))).toBe(ref);
      }
    });
  }

  it('ne MUTE pas l entree (2 appels sur le MEME objet -> meme resultat)', () => {
    const fx = RADIER_FIXTURES.find((f) => f.id === 'deux-plaques-inter');
    expect(fx).toBeDefined();
    if (!fx) return;
    const first = JSON.stringify(computeRadier(fx.input, fx.input.opts));
    const second = JSON.stringify(computeRadier(fx.input, fx.input.opts));
    expect(second).toBe(first);
  });

  it('SMOKE : un cas nominal produit un diag avec wMax/diff/betaGov finis', () => {
    const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-charge-centree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeRadier(fx.input, fx.input.opts) as Record<string, unknown>;
    expect(R.err).toBeUndefined();
    const diag = R.diag as Record<string, unknown>;
    expect(diag).toBeTruthy();
    expect(Number.isFinite(diag.wMax as number)).toBe(true);
    expect(Number.isFinite(diag.diff as number)).toBe(true);
    expect(Number.isFinite(diag.betaGov as number)).toBe(true);
  });
});

describe('radier — gardes du moteur exercees AU NIVEAU MOTEUR (avant schema)', () => {
  function baseState(over: Record<string, unknown>): Record<string, unknown> {
    return {
      rafts: [
        {
          pts: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 6 },
            { x: 0, y: 6 },
          ],
          E: 32000,
          nu: 0.2,
          e: 0.4,
        },
      ],
      pointLoads: [{ x: 3, y: 3, Fz: 1000 }],
      lineLoads: [],
      areaLoads: [],
      pointSprings: [],
      lineSprings: [],
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      ...over,
    };
  }

  it('aucune plaque -> erreur bornee « Aucune plaque a calculer »', () => {
    const r = computeRadier(baseState({ rafts: [] }), { mesh: 1 }) as Record<
      string,
      unknown
    >;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/Aucune plaque/);
  });

  it('aucune couche -> erreur bornee « au moins une couche de sol »', () => {
    const r = computeRadier(baseState({ layers: [] }), { mesh: 1 }) as Record<
      string,
      unknown
    >;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/couche de sol/);
  });

  it('maillage trop fin (>1500 nœuds) -> erreur bornee', () => {
    // h = max(0.3, mesh) : le pas est plancher a 0,3 m. Une grande plaque 16×16 a
    // mesh=0,2 (-> floor 0,3) donne 54×54 ≈ 2916 nœuds > 1500 -> garde « trop fin ».
    const bigRaft = [
      {
        pts: [
          { x: 0, y: 0 },
          { x: 16, y: 0 },
          { x: 16, y: 16 },
          { x: 0, y: 16 },
        ],
        E: 32000,
        nu: 0.2,
        e: 0.4,
      },
    ];
    const r = computeRadier(baseState({ rafts: bigRaft }), { mesh: 0.2 }) as Record<
      string,
      unknown
    >;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/Maillage trop fin/);
  });
});

describe('radier — purete DOM/IO (le module est DOM-free)', () => {
  const SRC_FILES = ['engine.ts', 'contract.ts', 'index.ts'];
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
    // Anti faux-vert : le doSolve() d'origine utilisait setTimeout(...,30) + performance.now.
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
