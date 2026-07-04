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

import { PIEUX_DEFAULT_COEFFS } from './contract.js';
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

  it('des coeffs client tous favorables NE changent PAS le verdict (ignores serveur)', () => {
    const normatif = runPieux(BASE);
    const manipule = runPieux({ ...BASE, coeffs: ATTACK_COEFFS });
    expect(normatif.ok && manipule.ok).toBe(true);
    if (!normatif.ok || !manipule.ok) return;
    // Le verdict + le taux gouvernant sont IDENTIQUES : la manipulation est sans effet.
    expect(manipule.output.allOk).toBe(normatif.output.allOk);
    expect(manipule.output.allOk).toBe(false);
    expect(manipule.output.tauxGouvernant).toBeCloseTo(normatif.output.tauxGouvernant, 6);
    expect(manipule.output.RcD).toBeCloseTo(normatif.output.RcD, 6);
  });
});
