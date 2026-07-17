/**
 * DETERMINISME & PURETE (DOM-free) du module pieux (#48, criteres 1 & 2).
 *
 *  1. Determinisme : meme entree -> meme sortie BRUTE, x100, en EGALITE STRICTE
 *     (JSON.stringify byte-a-byte). Pas de tolerance : un moteur pur ne doit pas
 *     varier d'un iota entre deux appels.
 *  2. Purete DOM/IO : le code SOURCE du module (engine.ts/contract.ts/index.ts) ne
 *     contient AUCUNE reference a `document`/`window`/`fetch`/horloge/hasard, ni
 *     iteration instable (`for..in`) sur des objets. C'est la preuve « grep vide » du
 *     critere 2 : le `compute()` d'origine etait couple au DOM (num('id'),
 *     $('id').value, state global, window._qceDetail) — tout cela a ete REMPLACE par
 *     un etat injecte a l'extraction.
 *
 * Ces tests ne dependent PAS du HTML source (ils tournent meme en CI) : ils portent
 * sur le MODULE extrait, pas sur l'equivalence (cf. engine.equivalence.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computePieux,
  computeDowndrag,
  computeBeton,
  computePortanceCurve,
} from './engine.js';
import {
  PIEUX_BETON_FIXTURES,
  PIEUX_DOWNDRAG_FIXTURES,
  PIEUX_FIXTURES,
} from './test-fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('pieux — determinisme (meme entree -> meme sortie x100, egalite stricte)', () => {
  for (const fx of PIEUX_FIXTURES) {
    it(`[${fx.id}] sortie identique sur 100 appels`, () => {
      const ref = JSON.stringify(computePieux(fx.input));
      for (let i = 0; i < 100; i++) {
        // Egalite STRICTE : aucune tolerance. Un ecart = non-determinisme.
        expect(JSON.stringify(computePieux(fx.input))).toBe(ref);
      }
    });
  }

  it('ne MUTE pas l entree (appels successifs sur le MEME objet identiques)', () => {
    // Anti-piege : la branche CPT clone le penetrogramme localement (pas de mutation
    // de state.cpt). On verifie qu'appeler 2x sur le MEME objet d'entree donne le
    // meme resultat (sinon une mutation cachee aurait change l'etat).
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'cpt-fore-da2');
    expect(fx).toBeDefined();
    if (!fx) return;
    const first = JSON.stringify(computePieux(fx.input));
    const second = JSON.stringify(computePieux(fx.input));
    expect(second).toBe(first);
  });
});

describe('pieux — COURBE DE PORTANCE déterministe (§8) — même entrée -> même sortie x100, égalité stricte', () => {
  for (const fx of PIEUX_FIXTURES) {
    it(`[${fx.id}] balayage de portance identique sur 100 appels`, () => {
      const ref = JSON.stringify(computePortanceCurve(fx.input));
      for (let i = 0; i < 100; i++) {
        // Égalité STRICTE : le balayage (portanceCore/portanceCaps sur une grille de D)
        // est purement arithmétique -> aucune dérive entre deux appels.
        expect(JSON.stringify(computePortanceCurve(fx.input))).toBe(ref);
      }
    });
  }

  it('le balayage de portance ne MUTE pas l entrée (pénétrogramme cloné ; 2 appels identiques)', () => {
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'cpt-fore-da2');
    expect(fx).toBeDefined();
    if (!fx) return;
    const cptAvant = JSON.stringify(fx.input.cpt);
    const first = JSON.stringify(computePortanceCurve(fx.input));
    const second = JSON.stringify(computePortanceCurve(fx.input));
    expect(second).toBe(first);
    // Le pénétrogramme d'entrée est INCHANGÉ (clone local, pas de régénération sur state).
    expect(JSON.stringify(fx.input.cpt)).toBe(cptAvant);
  });
});

describe('pieux — FROTTEMENT NÉGATIF déterministe (#94) — même entrée -> même sortie x100, égalité stricte', () => {
  for (const fx of PIEUX_DOWNDRAG_FIXTURES) {
    it(`[${fx.id}] downdrag identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeDowndrag(fx.input));
      for (let i = 0; i < 100; i++) {
        // Égalité STRICTE : aucune tolérance. La bissection (46 tours) et le marching
        // (nseg segments) sont purement arithmétiques -> aucune dérive entre 2 appels.
        expect(JSON.stringify(computeDowndrag(fx.input))).toBe(ref);
      }
    });
  }

  it('le downdrag ne MUTE pas l entrée (state.cpt cloné ; 2 appels identiques sur le même objet)', () => {
    // La branche CPT du downdrag lit un CLONE de state.cpt (pas de régénération ni de
    // mutation). On vérifie que 2 appels sur le MÊME objet d'entrée coïncident.
    const fx = PIEUX_DOWNDRAG_FIXTURES.find((f) => f.id === 'dd-auto-cpt-penetrogramme');
    expect(fx).toBeDefined();
    if (!fx) return;
    const cptAvant = JSON.stringify(fx.input.cpt);
    const first = JSON.stringify(computeDowndrag(fx.input));
    const second = JSON.stringify(computeDowndrag(fx.input));
    expect(second).toBe(first);
    // Le pénétrogramme d'entrée est INCHANGÉ après calcul (pas de mutation cachée).
    expect(JSON.stringify(fx.input.cpt)).toBe(cptAvant);
  });
});

describe('pieux — VÉRIFICATION BÉTON déterministe (#95) — même entrée -> même sortie x100, égalité stricte', () => {
  for (const fx of PIEUX_BETON_FIXTURES) {
    it(`[${fx.id}] béton identique sur 100 appels`, () => {
      const ref = JSON.stringify(computeBeton(fx.input));
      for (let i = 0; i < 100; i++) {
        // Égalité STRICTE : aucune tolérance. betonCheck est purement arithmétique
        // (tables Tableau 12, min/max) -> aucune dérive entre deux appels.
        expect(JSON.stringify(computeBeton(fx.input))).toBe(ref);
      }
    });
  }

  it('le béton ne MUTE pas l entrée (2 appels identiques sur le même objet)', () => {
    // computeBeton re-exécute computePieuxCore (branche CPT clonée) sans mutation de
    // l'entrée. 2 appels sur le MÊME objet doivent coïncider.
    const fx = PIEUX_BETON_FIXTURES.find((f) => f.id === 'bt-arme-comp-courant-fore');
    expect(fx).toBeDefined();
    if (!fx) return;
    const first = JSON.stringify(computeBeton(fx.input));
    const second = JSON.stringify(computeBeton(fx.input));
    expect(second).toBe(first);
  });
});

describe('pieux — gardes du moteur exercees AU NIVEAU MOTEUR (avant schema) — MINEUR-4 #48', () => {
  // La garde « profil vide » (engine.ts `!layers.length`) n'est PAS atteignable via
  // une fixture validee (contrat : layers.min(1)). On l'exerce ICI en appelant le
  // moteur DIRECTEMENT avec un etat profil-vide (le moteur tourne avant la validation
  // Zod du contrat) : il doit renvoyer une ERREUR bornee, pas crasher. Sans ce test,
  // la branche engine.ts du garde profil-vide ne serait JAMAIS couverte (faux-vert).
  function baseState(over: Record<string, unknown>): Record<string, unknown> {
    return {
      geom: { section: 'circ', g_B: 0.6 },
      g_z0: 0,
      g_D: 15,
      cat: 1,
      meth: 'pmt',
      da: 'da2',
      sens: 'comp',
      essais: 'non',
      c_G: 800,
      c_Q: 350,
      o_nappe: 3,
      o_nprofil: 1,
      o_surf: 2500,
      o_redis: 'non',
      grp: { grp_n: 1, grp_m: 1, grp_s: 0 },
      coeffs: {
        k_gG: 1.35,
        k_gQ: 1.5,
        k_gb: 1.1,
        k_gs: 1.1,
        k_gst: 1.15,
        k_psi2: 0.3,
        cr_b_b: 0.7,
        cr_b_s: 0.7,
        cr_f_b: 0.5,
        cr_f_s: 0.7,
        cr_car: 0.9,
        cr_qp: 1.1,
        cr_car_t: 1.1,
        cr_qp_t: 1.5,
      },
      layers: [{ soil: 'argile', th: 20, pl: 1, em: 10, gamma: 19 }],
      cpt: { step: 0.2, pts: [] },
      ...over,
    };
  }

  it('profil VIDE -> erreur bornee « Aucune couche de sol définie » (garde !layers.length)', () => {
    const r = computePieux(baseState({ layers: [] })) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/Aucune couche de sol/);
  });

  it('D <= z0 -> erreur bornee (garde de coherence des profondeurs)', () => {
    const r = computePieux(baseState({ g_z0: 10, g_D: 8 })) as Record<string, unknown>;
    expect(typeof r.err).toBe('string');
    expect(r.err).toMatch(/profondeur de base D/);
  });

  it('deterministe sur la garde profil vide (x20, egalite stricte)', () => {
    const ref = JSON.stringify(computePieux(baseState({ layers: [] })));
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(computePieux(baseState({ layers: [] })))).toBe(ref);
    }
  });
});

describe('pieux — purete DOM/IO (le module est DOM-free)', () => {
  // Fichiers de CALCUL du module (hors tests/fixtures/harnais qui, eux, lisent le FS).
  const SRC_FILES = ['engine.ts', 'contract.ts', 'index.ts'];
  // Motifs interdits dans un module moteur pur : DOM, reseau, horloge, hasard,
  // iteration d'objet a ordre potentiellement instable.
  const FORBIDDEN: Array<{ id: string; re: RegExp }> = [
    { id: 'document.', re: /\bdocument\s*\./ },
    { id: 'window.', re: /\bwindow\s*\./ },
    { id: 'fetch(', re: /\bfetch\s*\(/ },
    { id: 'new Date()', re: /\bnew\s+Date\s*\(/ },
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

  it('la verification MORD (test negatif) : un document. serait bien detecte', () => {
    // Anti faux-vert : prouve que le scan n'est pas inerte (le compute() d'origine
    // referencait massivement document. via num('id')/$('id').value).
    const temoin = "const v = document.getElementById('g_D').value;";
    const re = /\bdocument\s*\./;
    expect(re.test(temoin)).toBe(true);
  });

  // BONUS #6 (challenge #48) : interdire l'import TRANSITIF d'outillage de test (jsdom,
  // fs, crypto) depuis les fichiers de CALCUL importes par l'API. Le harnais
  // d'equivalence (jsdom/fs/crypto) ne doit JAMAIS etre tire par engine.ts/index.ts/
  // contract.ts. Sans cela, un `import` egare embarquerait jsdom dans le chemin serveur.
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
