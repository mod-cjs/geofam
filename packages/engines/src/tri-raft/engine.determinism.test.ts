/**
 * DETERMINISME & PURETE (DOM-free) du module radier triangulaire.
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance : un moteur pur (meme avec de
 *     l'algebre dense) ne doit pas varier d'un iota entre deux appels.
 *  2. Gardes du moteur exercees AU NIVEAU MOTEUR (avant tout schema).
 *  3. Purete DOM/IO : le code SOURCE du module (engine.ts/contract.ts) ne contient
 *     AUCUNE reference a `document`/`window`/`fetch`/horloge/hasard, ni iteration
 *     instable (`for..in`). Le `solveTriRaft` d'origine etait couple a la globale `state`
 *     + rendu ; tout cela a ete REMPLACE par un etat injecte a l'extraction.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI) : ils portent
 * sur le MODULE extrait, pas sur l'equivalence (cf. engine.equivalence.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeTriRaft } from './engine.js';
import { TRI_RAFT_FIXTURES } from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('radier-tri — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of TRI_RAFT_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeTriRaft(fx.input, fx.input.opts));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(computeTriRaft(fx.input, fx.input.opts))).toBe(ref);
      }
    });
  }

  it('ne MUTE pas l entree (2 appels sur le MEME objet -> meme resultat)', () => {
    const fx = TRI_RAFT_FIXTURES.find((f) => f.id === 'deux-plaques');
    expect(fx).toBeDefined();
    if (!fx) return;
    const first = JSON.stringify(computeTriRaft(fx.input, fx.input.opts));
    const second = JSON.stringify(computeTriRaft(fx.input, fx.input.opts));
    expect(second).toBe(first);
  });

  it('SMOKE : un cas nominal produit wMax/wMin/sumReact finis (pas d erreur)', () => {
    const fx = TRI_RAFT_FIXTURES.find((f) => f.id === 'carre-charge-centree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeTriRaft(fx.input, fx.input.opts) as Record<string, unknown>;
    expect(R.err).toBeUndefined();
    expect(Number.isFinite(R.wMax as number)).toBe(true);
    expect(Number.isFinite(R.wMin as number)).toBe(true);
    expect(Number.isFinite(R.sumReact as number)).toBe(true);
    // equilibre statique : Σ reaction ≈ Σ charge (couplage sol-plaque)
    const total = R.totalLoad as number;
    const react = R.sumReact as number;
    expect(Math.abs(react - total) / Math.max(1, Math.abs(total))).toBeLessThan(1e-6);
  });
});

describe('radier-tri — gardes du moteur exercees AU NIVEAU MOTEUR (avant schema)', () => {
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
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      ...over,
    };
  }

  const OPTS = { target: 2, e: 0.4, E: 32000, nu: 0.2 };

  it('aucune couche -> erreur bornee « au moins une couche de sol »', () => {
    const r = computeTriRaft(baseState({ layers: [] }), OPTS) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/couche de sol/);
  });

  it('aucune plaque -> erreur bornee « Aucune plaque dans le modèle »', () => {
    const r = computeTriRaft(baseState({ rafts: [] }), OPTS) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/Aucune plaque/);
  });

  it('maillage trop fin (>1200 nœuds) -> erreur bornee « Maillage trop fin »', () => {
    const bigRaft = [
      {
        pts: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 12 },
          { x: 0, y: 12 },
        ],
        E: 32000,
        nu: 0.2,
        e: 0.4,
      },
    ];
    const r = computeTriRaft(baseState({ rafts: bigRaft }), {
      ...OPTS,
      target: 0.05,
    }) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/Maillage trop fin/);
  });
});

describe('radier-tri — purete DOM/IO (le module est DOM-free)', () => {
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
      const found = FORBIDDEN_IMPORTS.filter((re) => re.test(content)).map((re) => re.source);
      expect(found, `import d outillage de test dans ${file}`).toEqual([]);
    }
  });
});
