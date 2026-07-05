/**
 * Securite (audit adverse) — coefficients partiels AUTORITATIFS serveur.
 *
 * FAILLE trouvee (HAUTE) : `coeffs` (facteurs partiels de securite EC7) etait
 * client-fourni et borne trop largement. Un client API pouvait envoyer des coeffs
 * tous favorables DANS les bornes (k_gG=0, cr_* aux extremes) et faire passer un
 * pieu grossierement NON CONFORME (taux 6,7 -> 0,2 ; allOk False -> True), scellable
 * dans un PV — alors que le front CASAGRANDE fige les valeurs normatives.
 *
 * Correctif Phase 1 : le serveur IGNORE les coeffs client et applique les valeurs
 * NORMATIVES (PIEUX_DEFAULT_COEFFS). La manipulation devient sans effet : le verdict
 * est celui du calcul normatif, quel que soit le `coeffs` envoye.
 */

import { describe, it, expect } from 'vitest';

import { PIEUX_DEFAULT_COEFFS, PieuxInputSchema } from './contract.js';
import { runPieux } from './index.js';

// Pieu volontairement SOUS-DIMENSIONNE (charge elevee / resistance modeste) : FAIL normatif.
const BASE = {
  pieu: 'P1',
  geom: { section: 'circ', g_B: 0.6 },
  g_D: 8,
  g_z0: 0,
  cat: 1,
  meth: 'pmt',
  da: 'da2',
  sens: 'comp',
  essais: 'non',
  c_G: 2500,
  c_Q: 800,
  o_nappe: 500,
  o_nprofil: 1,
  o_surf: 0,
  o_redis: 'non',
  grp: { grp_n: 1, grp_m: 1, grp_s: 0 },
  coeffs: { ...PIEUX_DEFAULT_COEFFS },
  layers: [{ soil: 'sable', th: 10, pl: 1.2, em: 12 }],
  cpt: { step: 0.2, pts: [] },
} as const;

// Coeffs tous FAVORABLES, mais chacun dans les bornes du schema (l'exploit).
const ATTACK_COEFFS = {
  k_gG: 0,
  k_gQ: 0,
  k_gb: 0.1,
  k_gs: 0.1,
  k_gst: 0.1,
  k_psi2: 0,
  cr_b_b: 2,
  cr_b_s: 2,
  cr_f_b: 2,
  cr_f_s: 2,
  cr_car: 0.1,
  cr_qp: 0.1,
  cr_car_t: 0.1,
  cr_qp_t: 0.1,
};

describe('pieux — coeffs de securite autoritatifs serveur (anti-falsification)', () => {
  it('le pieu de reference est NON CONFORME avec les coeffs normatifs', () => {
    const env = runPieux(BASE);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.allOk).toBe(false);
  });

  it('des coeffs client NON NORMATIFS sont REJETES a l entree (400, fail-closed)', () => {
    // Rejet EXPLICITE au schema : l'input scelle ne peut donc jamais contenir de coeffs
    // non normatifs -> invariant « scelle = calcule » (pas d'override silencieux).
    expect(() => runPieux({ ...BASE, coeffs: ATTACK_COEFFS })).toThrow();
    const r = PieuxInputSchema.safeParse({ ...BASE, coeffs: ATTACK_COEFFS });
    expect(r.success).toBe(false);
  });

  it('les coeffs NORMATIFS passent et l input parse conserve exactement PIEUX_DEFAULT_COEFFS', () => {
    const parsed = PieuxInputSchema.parse(BASE) as { coeffs: typeof PIEUX_DEFAULT_COEFFS };
    expect(parsed.coeffs).toEqual(PIEUX_DEFAULT_COEFFS);
  });

  // SENTINELLE DE COUPLAGE FRONT/BACK (revue de verification) : le front CASAGRANDE ne peut
  // PAS importer ce schema (frontiere DoD §8) -> il DUPLIQUE les 14 valeurs en dur. Le refine
  // exige desormais l'egalite EXACTE : toute divergence ferait echouer TOUT calcul pieux en
  // prod (400) sans qu'aucun typecheck ne le voie. On FIGE ici les 14 valeurs normatives :
  // si elles changent, ce test ROUGE force a repercuter le changement dans le descripteur
  // front (apps/web/src/lib/engine-descriptors.ts, coeffs CASAGRANDE).
  it('les 14 coeffs normatifs sont FIGES (miroir a maintenir avec le front CASAGRANDE)', () => {
    expect(PIEUX_DEFAULT_COEFFS).toEqual({
      k_gG: 1.35, k_gQ: 1.5, k_gb: 1.1, k_gs: 1.1, k_gst: 1.15, k_psi2: 0.3,
      cr_b_b: 0.7, cr_b_s: 0.7, cr_f_b: 0.5, cr_f_s: 0.7,
      cr_car: 0.9, cr_qp: 1.1, cr_car_t: 1.1, cr_qp_t: 1.5,
    });
  });

  // GOLDEN-MASTER sur runPieux (chemin REELLEMENT servi : parse + coeffs autoritatifs +
  // frottement negatif). L'equivalence-portage ne teste que computePieux -> ce sentinelle
  // fige le verdict/taux/RcD du chemin serveur (regression). Valeurs a co-valider expert.
  it('runPieux : sortie servie figee (sentinelle de non-regression)', () => {
    const env = runPieux(BASE);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.allOk).toBe(false);
    expect(env.output.tauxGouvernant).toBeCloseTo(6.7423, 3);
    expect(env.output.RcD).toBeCloseTo(678.5517, 3);
  });
});
