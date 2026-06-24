/**
 * DETERMINISME & PURETE (DOM-free) du module FASTLAB (#49-53, criteres 1 & 2).
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE.
 *  2. Purete DOM/IO : engine.ts/contract.ts/index.ts sans document/window/fetch/
 *     horloge/hasard/setTimeout/for..in. Les ~20 calc* d'origine lisaient le DOM +
 *     setTimeout (toast) ; tout cela a ete REMPLACE par un etat injecte / RETIRE.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent en CI).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeLabo } from './engine.js';
import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('labo — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of LABO_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeLabo(fx.input));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(computeLabo(fx.input))).toBe(ref);
      }
    });
  }

  it('SMOKE : l exemple DEMO du HTML classe bien en A2 (limon argileux)', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeLabo(fx.input) as Record<string, unknown>;
    const cls = R.cls as Record<string, unknown>;
    expect(cls.code).toBe('A2');
    // wL≈38, wP≈20, Ip≈18 (cf. commentaire DEMO du HTML).
    const D = R.D as Record<string, number>;
    expect(D.ip).toBeGreaterThan(12);
    expect(D.ip).toBeLessThanOrEqual(25);
  });

  it('SMOKE : runLabo expose les resultats + la classe (pipeline complet)', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.classe.code).toBe('A2');
    expect(Number.isFinite(env.output.wn as number)).toBe(true);
    expect(Number.isFinite(env.output.p80 as number)).toBe(true);
    expect(env.meta.engineId).toBe('labo-classification-gtr');
  });

  it('SMOKE : un echantillon vide -> classe indeterminee (pas de code)', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'indetermine-vide');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.classe.code).toBeNull();
  });
});

describe('labo — purete DOM/IO (le module est DOM-free)', () => {
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
    const temoin = "t._t=setTimeout(()=>t.classList.remove('show'),2200);";
    expect(/\bsetTimeout\s*\(/.test(temoin)).toBe(true);
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
