/**
 * Securite (audit adverse) — bornage des coefficients de fatigue imposables.
 *
 * FAILLE trouvee (HAUTE, confirmee prod) : `r` (risque %), `sh` (Sh, cm) et `ks`
 * (coefficient de discontinuite) sont imposables par le client ('auto' ou valeur)
 * et pilotent la deformation admissible de fatigue -> le VERDICT `conforme`. La
 * branche numerique n'avait AUCUNE borne (`z.number().finite()`) : `ks=1000` gonflait
 * l'admissible x1000 -> une chaussee NON conforme devenait CONFORME (faux PASS scelle
 * dans un PV). On borne desormais r/sh/ks a des plages physiques LCPC saines.
 *
 * NB : contrairement a pieux, ROADSENS EXPOSE ces choix (ingenieur) -> on ne les rend
 * pas autoritatifs serveur ; on les BORNE. Plages exactes a confirmer par l'expert.
 */

import { describe, it, expect } from 'vitest';

import { BurmisterInputSchema } from './contract.js';

const withLoad = (over: Record<string, unknown>) => ({
  layers: [{ mat: 'GB3', E: 9000, nu: 0.35, h: 0.18 }],
  subgrade: { cls: 'PF3', E: 120, nu: 0.35 },
  traffic: { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 },
  load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto', ...over },
});

describe('burmister — bornage r/sh/ks (anti-falsification verdict)', () => {
  it('accepte auto + valeurs LCPC legitimes (fixtures)', () => {
    expect(BurmisterInputSchema.safeParse(withLoad({})).success).toBe(true);
    expect(BurmisterInputSchema.safeParse(withLoad({ r: 10, sh: 2.5, ks: 0.95 })).success).toBe(true);
    expect(BurmisterInputSchema.safeParse(withLoad({ r: 1.0 })).success).toBe(true);
  });

  it('REJETTE ks=1000 (exploit : admissible fatigue x1000)', () => {
    expect(BurmisterInputSchema.safeParse(withLoad({ ks: 1000 })).success).toBe(false);
  });
  it('REJETTE r=99.99 (risque absurde)', () => {
    expect(BurmisterInputSchema.safeParse(withLoad({ r: 99.99 })).success).toBe(false);
  });
  it('REJETTE r/sh/ks negatifs', () => {
    expect(BurmisterInputSchema.safeParse(withLoad({ r: -50 })).success).toBe(false);
    expect(BurmisterInputSchema.safeParse(withLoad({ sh: -1 })).success).toBe(false);
    expect(BurmisterInputSchema.safeParse(withLoad({ ks: -0.5 })).success).toBe(false);
  });
});
