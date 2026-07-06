/**
 * CONTRAT axisymetrique — la SORTIE est une whitelist stricte de DIAGNOSTICS : aucun champ
 * NODAL (r/w/p/Mr/Mt) ni discretisation (nn) ne peut fuiter (DoD §8).
 *
 * On verifie :
 *   1. la CONSTRUCTION du contrat (defineEngineContract) ne leve pas — les deux schemas
 *      sont whitelist-safe (fail-closed a la definition) ;
 *   2. l'ENTREE valide/borne (au moins une couche, au moins une charge non nulle) ;
 *   3. la SORTIE `.strict()` REJETTE tout champ non declare (les champs nodaux/methode
 *      d'un `R` brut ne passent JAMAIS le schema) ;
 *   4. sur un `R` BRUT (avec r/w/p/Mr/Mt), la projection champ-a-champ ne conserve QUE les
 *      diagnostics — aucun tableau nodal ne subsiste dans la serialisation.
 */
import { describe, expect, it } from 'vitest';

import {
  AXI_CONTRACT,
  AxiInputSchema,
  AxiOutputSchema,
  type AxiOutput,
} from './contract.js';
import { computeAxi } from './engine.js';
import { AXI_FIXTURES } from './test-fixtures.js';

/** Cles d'INTERMEDIAIRES EF qui ne doivent JAMAIS apparaitre dans la sortie client. */
const FUITES_INTERDITES = ['r', 'w', 'p', 'Mr', 'Mt', 'nn', 'sumReact', 'D', 'EI'];

describe('axi — contrat : construction whitelist-safe', () => {
  it('AXI_CONTRACT est defini avec l id kebab-case attendu', () => {
    expect(AXI_CONTRACT.id).toBe('axi-plaque');
    expect(AXI_CONTRACT.inputSchema).toBeDefined();
    expect(AXI_CONTRACT.outputSchema).toBeDefined();
  });
});

describe('axi — contrat : ENTREE bornee / fail-closed', () => {
  const nominal = AXI_FIXTURES.find((f) => f.id === 'q-reparti-2couches');

  it('accepte une entree nominale valide', () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    const parsed = AxiInputSchema.parse(nominal.input);
    expect(parsed.layers.length).toBeGreaterThanOrEqual(1);
    expect(parsed.o.R).toBeGreaterThan(0);
  });

  it('REJETTE une entree sans couche de sol (layers min 1)', () => {
    expect(() =>
      AxiInputSchema.parse({
        layers: [],
        o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 120, Pc: 0, ne: 12, foundD: 0 },
      }),
    ).toThrow();
  });

  it('REJETTE une entree sans charge (q=0 ET Pc=0) — fail-closed', () => {
    expect(() =>
      AxiInputSchema.parse({
        layers: [{ zBase: -10, E: 10, nu: 0.3 }],
        o: { R: 6, e: 0.4, E: 32000, nu: 0.2, q: 0, Pc: 0, ne: 12, foundD: 0 },
      }),
    ).toThrow();
  });

  it('applique les defauts d entree (q/Pc/ne/foundD) quand omis', () => {
    const parsed = AxiInputSchema.parse({
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      o: { R: 6, e: 0.4, E: 32000, nu: 0.2, Pc: 1000 },
    });
    expect(parsed.o.q).toBe(0);
    expect(parsed.o.ne).toBe(50);
    expect(parsed.o.foundD).toBe(0);
  });
});

describe('axi — contrat : SORTIE whitelist stricte (anti-fuite)', () => {
  it('accepte un objet de diagnostics propre', () => {
    const clean: AxiOutput = {
      wc: 1,
      wEdge: 0.5,
      wMax: 1,
      wMin: 0.5,
      mrMax: 10,
      mtMax: 8,
      pMax: 120,
      totalLoad: 1000,
      z0: 0,
    };
    expect(() => AxiOutputSchema.parse(clean)).not.toThrow();
  });

  for (const cle of FUITES_INTERDITES) {
    it(`REJETTE un champ NODAL/methode « ${cle} » (strict)`, () => {
      const withLeak = {
        wc: 1,
        wEdge: 0.5,
        wMax: 1,
        wMin: 0.5,
        mrMax: 10,
        mtMax: 8,
        pMax: 120,
        totalLoad: 1000,
        z0: 0,
        [cle]: cle === 'r' || cle === 'w' ? [0, 1, 2] : 3.14,
      };
      expect(() => AxiOutputSchema.parse(withLeak)).toThrow();
    });
  }

  it('la projection champ-a-champ d un R BRUT ne conserve QUE les diagnostics', () => {
    const fx = AXI_FIXTURES.find((f) => f.id === 'q-reparti-2couches');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computeAxi({ layers: fx.input.layers }, fx.input.o) as Record<
      string,
      unknown
    >;
    // Construction champ-a-champ (ce que fera le cablage/index) : uniquement les scalaires.
    const projected: AxiOutput = AxiOutputSchema.parse({
      wc: R.wc,
      wEdge: R.wEdge,
      wMax: R.wMax,
      wMin: R.wMin,
      mrMax: R.mrMax,
      mtMax: R.mtMax,
      pMax: R.pMax,
      totalLoad: R.totalLoad,
      z0: R.z0,
    });
    const serial = JSON.stringify(projected);
    // Aucune cle nodale / de methode ne subsiste.
    for (const cle of ['"r"', '"w"', '"p"', '"Mr"', '"Mt"', '"nn"', '"sumReact"']) {
      expect(serial.includes(cle)).toBe(false);
    }
    // Le brut, lui, PORTE bien ces intermediaires (preuve que le strip est necessaire).
    expect(Array.isArray(R.r)).toBe(true);
  });
});
