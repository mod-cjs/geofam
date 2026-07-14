/**
 * CONTRAT deformations planes — l'ENTREE est bornee/fail-closed et la SORTIE est une
 * whitelist stricte de DIAGNOSTICS : aucun champ NODAL ni topologie de maillage ne
 * fuit (DoD §8).
 *
 * On verifie :
 *   - l'ENTREE valide les fixtures nominales et REFUSE un modele sans charge ;
 *   - la SORTIE `.strict()` STRIPPE tout intermediaire EF (X/w/p/M/V/nn/dx/iters),
 *     a tout niveau, en ne gardant que les diagnostics declares (dont `EI` = rigidite D,
 *     desormais EXPOSEE — ADR 0014).
 */
import { describe, expect, it } from 'vitest';

import {
  PlaneStrainInputSchema,
  PlaneStrainOutputSchema,
  planeStrainContract,
  PLANE_STRAIN_ENGINE_ID,
} from './contract.js';
import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

/** Cles d'INTERMEDIAIRES EF qui ne doivent JAMAIS apparaitre dans la sortie client.
 * `EI` (rigidite D) n'y est PLUS : exposee (ADR 0014). `dx`/`nn`/`iters` restent SERVEUR. */
const FUITES_INTERDITES = ['X', 'w', 'p', 'M', 'V', 'nn', 'dx', 'iters'];

function collectKeys(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
}

describe('contrat deformations planes — ENTREE bornee/fail-closed', () => {
  it('le contrat expose l identifiant kebab-case', () => {
    expect(PLANE_STRAIN_ENGINE_ID).toBe('plane-strain');
    expect(planeStrainContract.id).toBe('plane-strain');
  });

  for (const fx of PLANE_STRAIN_FIXTURES.filter((f) => !f.horsDomaine)) {
    it(`[${fx.id}] entree valide accepte`, () => {
      const parsed = PlaneStrainInputSchema.safeParse(fx.input);
      expect(
        parsed.success,
        parsed.success ? '' : JSON.stringify(parsed.error.issues),
      ).toBe(true);
    });
  }

  it('REFUSE un modele sans aucune charge (fail-closed)', () => {
    const r = PlaneStrainInputSchema.safeParse({
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      opts: { Bw: 6, E: 32000, nu: 0.2, e: 0.4 },
    });
    expect(r.success).toBe(false);
  });

  it('REFUSE un champ inconnu dans opts (strict)', () => {
    const r = PlaneStrainInputSchema.safeParse({
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      opts: { Bw: 6, E: 32000, nu: 0.2, e: 0.4, q: 50, kWink: 5000 },
    });
    expect(r.success).toBe(false);
  });
});

describe('contrat deformations planes — SORTIE whitelist (aucun champ nodal ne fuit)', () => {
  /** Un objet de DIAGNOSTICS propre (aucun champ nodal) : forme client-safe attendue. */
  const cleanDiag = {
    erreur: null,
    warnings: [],
    wMax: 6.25,
    wMin: 1.1,
    diff: 5.15,
    mMax: 120,
    mMin: -80,
    pMax: 45,
    totalLoad: 300,
    sumReact: 300,
    z0: 0,
    decolN: 0,
    // Rigidite de flexion D = EI — champ EXPOSE (ADR 0014), requis par la whitelist.
    EI: 1.7e7,
  };

  /** La MEME sortie mais porteuse d'intermediaires EF (topologie de maillage). `EI` n'y
   * figure PLUS comme fuite : c'est un diagnostic expose (le pas `dx`/le maillage `nn`
   * restent, eux, interdits). */
  const rawWithLeaks = {
    ...cleanDiag,
    X: [0, 1, 2, 3],
    w: { 0: 1, 1: 2 },
    p: { 0: 10, 1: 20 },
    M: { 0: 5 },
    V: { 0: 3 },
    nn: 61,
    dx: 0.1,
    iters: 1,
  };

  it('la sortie STRICT REJETTE toute fuite de champ nodal/topologie (anti-passthrough)', () => {
    // `.strict()` ne « strippe » pas silencieusement : il ECHOUE si un champ nodal
    // subsiste, forcant la couche de projection amont a construire un objet propre.
    const parsed = PlaneStrainOutputSchema.safeParse(rawWithLeaks);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = JSON.stringify(parsed.error.issues);
      for (const forbidden of FUITES_INTERDITES) {
        expect(msg.includes(forbidden), `fuite « ${forbidden} » non signalee`).toBe(true);
      }
    }
  });

  it('la sortie ACCEPTE une forme de diagnostics propre et n expose aucune cle interdite', () => {
    const projected = PlaneStrainOutputSchema.parse(cleanDiag) as Record<string, unknown>;
    const keys = new Set<string>();
    collectKeys(projected, keys);
    for (const forbidden of FUITES_INTERDITES) {
      expect(keys.has(forbidden), `cle interdite « ${forbidden} » presente`).toBe(false);
    }
    expect(projected.wMax).toBe(6.25);
    expect(projected.mMax).toBe(120);
    expect(projected.decolN).toBe(0);
  });

  it('le test MORD : une sortie contenant « w » comme cle serait detectee', () => {
    const keys = new Set<string>();
    collectKeys({ w: { 0: 1 } }, keys);
    expect(keys.has('w')).toBe(true);
  });
});
