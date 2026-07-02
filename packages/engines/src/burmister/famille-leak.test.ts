/**
 * FUITE #1 (issue #81, DoD §8) — le libelle `famille` embarque le DISCRIMINANT
 * CALCULE Kmix (ratio de rigidite h_lie_bit / h_lie_total).
 *
 * Le moteur emet une chaine ENRICHIE : « mixte (§4.4, K=0.62) », « semi-rigide
 * (§4.3, K=0.34<0,5) ». Le `§4.x` (guide LCPC-SETRA 1994) est PUBLIC ; le K chiffre
 * est un INTERMEDIAIRE de methode CONFIDENTIEL. La projection client-safe doit
 * NETTOYER `famille` en un libelle d'ALLOWLIST NU, sans « § », sans « K= », sans
 * decimale — sinon le PV scelle et l'affichage publieraient le ratio calcule.
 *
 * On NE TOUCHE PAS au moteur (science figee, equivalence-portage) : le nettoyage se
 * fait a la PROJECTION (sanitizeFamille + refine du schema de sortie). Ce test
 * verrouille l'allowlist fail-closed et son cablage sur le vrai pipeline runBurmister.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FAMILLES_STRUCTURE,
  FAMILLE_GENERIQUE,
  BurmisterOutputSchema,
  sanitizeFamille,
} from './contract.js';
import type * as EngineModule from './engine.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import { runBurmister } from './index.js';

/** Motif de fuite : un « K= <decimale> » (discriminant Kmix) OU un « § ». */
const DISCRIMINANT_KMIX = /K\s*=\s*-?[0-9]/;
const SECTION_OU_DECIMALE_SUFFIXE = /\(\s*§|K\s*=/;

describe('FUITE #1 — sanitizeFamille : allowlist fail-closed du libelle de famille', () => {
  it('PRECONDITION : les chaines BRUTES du moteur portent bien le discriminant (sinon test vide)', () => {
    // Ce que le moteur produit reellement (cf. engine.ts:632-658).
    expect('mixte (§4.4, K=0.62)').toMatch(DISCRIMINANT_KMIX);
    expect('semi-rigide (§4.3, K=0.34<0,5)').toMatch(DISCRIMINANT_KMIX);
  });

  it('nettoie chaque chaine brute connue en son libelle d ALLOWLIST NU (sans § ni K=)', () => {
    const cas: ReadonlyArray<[string, string]> = [
      ['inverse (§4.5)', 'inverse'],
      ['mixte (§4.4, K=0.62)', 'mixte'],
      ['semi-rigide (§4.3, K=0.34<0,5)', 'semi-rigide'],
      ['semi-rigide (§4.3)', 'semi-rigide'],
      ['souple à faible trafic (§4.2.2)', 'souple à faible trafic'],
      ['souple (§4.2)', 'souple'],
      ['bitumineuse épaisse (§4.2)', 'bitumineuse épaisse'],
      ['granulaire', 'granulaire'],
    ];
    for (const [brut, attendu] of cas) {
      const propre = sanitizeFamille(brut);
      expect(propre, `nettoyage de « ${brut} »`).toBe(attendu);
      expect(propre).not.toMatch(SECTION_OU_DECIMALE_SUFFIXE);
      expect(propre).not.toMatch(/[0-9]/);
    }
  });

  it('« souple à faible trafic » est distingue de « souple » (prefixe le plus long)', () => {
    // Anti faux-vert : sans l ordre prefixe-long-d abord, « souple à faible trafic »
    // retomberait par erreur sur « souple ».
    expect(sanitizeFamille('souple à faible trafic (§4.2.2)')).toBe(
      'souple à faible trafic',
    );
    expect(sanitizeFamille('souple (§4.2)')).toBe('souple');
  });

  it('SENTINELLE fail-closed : une chaine CORROMPUE retombe sur le generique, jamais le brut', () => {
    // Chaine adversaire portant un intermediaire confidentiel arbitraire.
    const corrompu = 'bitumineuse (§ confidentiel kc=1.3)';
    const propre = sanitizeFamille(corrompu);
    expect(propre).toBe(FAMILLE_GENERIQUE);
    // Aucune trace du brut : ni §, ni kc, ni la decimale.
    expect(propre).not.toContain('§');
    expect(propre).not.toContain('kc');
    expect(propre).not.toContain('K=');
    expect(propre).not.toContain('1.3');
  });

  it('SENTINELLE fail-closed : entree non-chaine → generique', () => {
    expect(sanitizeFamille(undefined)).toBe(FAMILLE_GENERIQUE);
    expect(sanitizeFamille(null)).toBe(FAMILLE_GENERIQUE);
    expect(sanitizeFamille({ K: 0.62 })).toBe(FAMILLE_GENERIQUE);
    expect(sanitizeFamille(42)).toBe(FAMILLE_GENERIQUE);
  });

  it('le schema de sortie REFUSE (refine) un libelle hors allowlist (defense en profondeur)', () => {
    // Meme si sanitizeFamille etait contourne, projectEngineOutput rejetterait un
    // libelle porteur du discriminant → fail-closed (jamais de fuite silencieuse).
    const base = {
      erreur: null,
      warnings: [],
      conforme: true,
      NE: 1e6,
      epaisseurLiee: 0.16,
      epaisseurTotale: 0.41,
      ornierage: { valeur: 300, admissible: 500, ok: true },
    };
    expect(() =>
      BurmisterOutputSchema.parse({ ...base, famille: 'mixte (§4.4, K=0.62)' }),
    ).toThrow();
    // Un libelle d allowlist NU passe.
    expect(() =>
      BurmisterOutputSchema.parse({ ...base, famille: 'mixte' }),
    ).not.toThrow();
    // Chaque libelle d allowlist est accepte.
    for (const fam of FAMILLES_STRUCTURE) {
      expect(() => BurmisterOutputSchema.parse({ ...base, famille: fam })).not.toThrow();
    }
  });

  it('PIPELINE REEL : runBurmister n expose JAMAIS le discriminant sur les fixtures', () => {
    for (const fx of BURMISTER_FIXTURES) {
      const env = runBurmister(fx.input);
      if (!env.ok) continue;
      const fam = env.output.famille;
      expect(fam, `fuite discriminant sur fixture ${fx.id}`).not.toMatch(
        SECTION_OU_DECIMALE_SUFFIXE,
      );
      // La famille exposee est TOUJOURS un libelle d allowlist (ou le generique / vide).
      const autorises: string[] = [...FAMILLES_STRUCTURE, FAMILLE_GENERIQUE, ''];
      expect(autorises, `famille hors allowlist sur ${fx.id} : « ${fam} »`).toContain(
        fam,
      );
    }
  });

  it('PIPELINE REEL : la fixture MIXTE (K calcule) ressort « mixte » NU, sans K=', async () => {
    // Le moteur, sur une structure mixte, calcule Kmix et l accole au libelle brut.
    // On force ce cas via mock pour prouver que le pipeline le nettoie, quel que soit
    // le K calcule (ici 0.62). Le BRUT injecte fuit (anti faux-vert), la projection non.
    const FAMILLE_BRUTE = 'mixte (§4.4, K=0.62)';
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeBurmister: () => ({
          PASS: true,
          passZ: true,
          NE: 3e6,
          fam: FAMILLE_BRUTE,
          H_bit: 0.18,
          H_tot: 0.5,
          ez: 300,
          ezA: 500,
          hasBit: true,
          sig: 0,
          et: 100,
          etA: 200,
          passT: true,
          etReq: true,
        }),
      };
    });
    const { runBurmister: runMocked } = await import('./index.js');
    expect(FAMILLE_BRUTE).toMatch(DISCRIMINANT_KMIX); // le brut fuit bien
    const fx0 = BURMISTER_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.famille).toBe('mixte');
    expect(JSON.stringify(env.output)).not.toContain('K=');
    expect(JSON.stringify(env.output)).not.toContain('§4.4');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });
});
