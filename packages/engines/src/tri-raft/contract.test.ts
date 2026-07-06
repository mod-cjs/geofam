/**
 * CONTRAT radier-tri — les SCHEMAS d'entree/sortie sont fail-closed.
 *
 * On teste directement les schemas Zod du contrat (l'index.ts de dispatch/projection est
 * cable par l'orchestrateur hors de ce lot) :
 *  - ENTREE : bornee, `.strict()` (rejet des champs inconnus), garde « au moins une
 *    charge » (fail-closed), materiau de plaque optionnel (repli opts) ;
 *  - SORTIE : whitelist STRICTE de DIAGNOSTICS. Aucune cle NODALE (w/p) ni de TOPOLOGIE
 *    DE MAILLAGE (P/tris/N/nt) n'est acceptee (DoD §8) : le schema `.strict()` REJETTE
 *    tout objet qui en contient. C'est la barriere primaire anti-fuite.
 */
import { describe, expect, it } from 'vitest';

import {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
} from './contract.js';
import { TRI_RAFT_FIXTURES } from './test-fixtures.js';

/** Cles d'intermediaires EF qui ne doivent JAMAIS etre acceptees en sortie. */
const FUITES_INTERDITES = ['w', 'p', 'P', 'tris', 'N', 'nt', 'pMax'];

/** Sortie client-safe MINIMALE valide (diagnostics seuls). */
const OUTPUT_OK = {
  erreur: null,
  warnings: [],
  wMax: 6.25,
  wMin: -1.1,
  diff: 7.35,
  reactionMax: 120.4,
  totalLoad: 1000,
  sumReact: 1000,
  nRaft: 1,
  z0: 0,
} as const;

describe('radier-tri — contrat ENTREE (bornee, strict, fail-closed)', () => {
  it('accepte tous les jeux de fixtures NOMINAUX', () => {
    for (const fx of TRI_RAFT_FIXTURES) {
      const parsed = TriRaftInputSchema.safeParse(fx.input);
      expect(parsed.success, `${fx.id} devrait etre valide`).toBe(true);
    }
  });

  it('REJETTE un modele sans aucune charge non nulle (fail-closed)', () => {
    const sansCharge = {
      rafts: [{ pts: TRI_RAFT_FIXTURES[0]!.input.rafts[0]!.pts, E: 32000, nu: 0.2, e: 0.4 }],
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      opts: { target: 2, e: 0.4, E: 32000, nu: 0.2 },
    };
    expect(TriRaftInputSchema.safeParse(sansCharge).success).toBe(false);
  });

  it('REJETTE un champ inconnu a la racine (.strict, anti-passthrough)', () => {
    const avecExtra = {
      ...TRI_RAFT_FIXTURES[0]!.input,
      champInconnu: 42,
    };
    expect(TriRaftInputSchema.safeParse(avecExtra).success).toBe(false);
  });

  it('REJETTE un champ inconnu dans opts (.strict)', () => {
    const base = TRI_RAFT_FIXTURES[0]!.input;
    const avecExtra = { ...base, opts: { ...base.opts, mesh: 1 } };
    expect(TriRaftInputSchema.safeParse(avecExtra).success).toBe(false);
  });

  it('accepte une plaque SANS materiau propre (repli opts) et applique les defauts de charges', () => {
    const sansMat = {
      rafts: [{ pts: TRI_RAFT_FIXTURES[0]!.input.rafts[0]!.pts }],
      pointLoads: [{ x: 3, y: 3, Fz: 1000 }],
      layers: [{ zBase: -10, E: 10, nu: 0.3 }],
      opts: { target: 2, e: 0.4, E: 32000, nu: 0.2 },
    };
    const parsed = TriRaftInputSchema.safeParse(sansMat);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // defauts appliques (arrays vides) par le schema
      expect(parsed.data.lineLoads).toEqual([]);
      expect(parsed.data.areaLoads).toEqual([]);
      expect(parsed.data.rafts[0]!.E).toBeUndefined();
    }
  });

  it('REJETTE une charge non finie (Fz = Infinity)', () => {
    const bad = {
      ...TRI_RAFT_FIXTURES[0]!.input,
      pointLoads: [{ x: 3, y: 3, Fz: Number.POSITIVE_INFINITY }],
    };
    expect(TriRaftInputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('radier-tri — contrat SORTIE (whitelist stricte, anti-fuite DoD §8)', () => {
  it('accepte une sortie de diagnostics MINIMALE valide', () => {
    expect(TriRaftOutputSchema.safeParse(OUTPUT_OK).success).toBe(true);
  });

  for (const cle of FUITES_INTERDITES) {
    it(`REJETTE la sortie si elle contient la cle interdite « ${cle} » (champ nodal/maillage)`, () => {
      const fuite = { ...OUTPUT_OK, [cle]: cle === 'nt' || cle === 'N' ? 128 : [1, 2, 3] };
      expect(TriRaftOutputSchema.safeParse(fuite).success).toBe(false);
    });
  }

  it('la verification MORD : la MEME sortie SANS cle interdite passe (anti faux-vert)', () => {
    // Preuve que le rejet ci-dessus vient bien de la cle interdite, pas d un autre defaut.
    expect(TriRaftOutputSchema.safeParse({ ...OUTPUT_OK }).success).toBe(true);
  });
});

describe('radier-tri — construction du contrat', () => {
  it('expose un id distinct du radier ACM', () => {
    expect(TRI_RAFT_ENGINE_ID).toBe('radier-tri');
    expect(triRaftContract.id).toBe('radier-tri');
  });
});
