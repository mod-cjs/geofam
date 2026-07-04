/**
 * Tests — page CASAGRANDE (pieux, NF P 94-262 / EC7).
 * DoD §9 : given/when/then. DoD §8 : buildCasaPayload PUR, entrées bornées +
 * coefficients partiels EC7 PUBLICS (aucun facteur de calage moteur).
 */

import { describe, it, expect } from 'vitest';

import { buildCasaPayload, type CasaForm } from '../page';

function form(over: Partial<CasaForm> = {}): CasaForm {
  return {
    projet: 'Ouvrage P3',
    cat: 1, section: 'circ', gB: '0.6', gD: '12', gz0: '0',
    meth: 'pmt', da: 'da2', sens: 'comp', essais: 'non',
    cG: '900', cQ: '300', nappe: '2', nprofil: '1', surf: '0', redis: 'non',
    grpN: '1', grpM: '1', grpS: '0',
    layers: [{ soil: 'argile', th: '6', pl: '0.8', em: '8', qc: '', c: '', phi: '', gamma: '' }],
    betonOn: false, fck: '25', arm: 'arme', k3: '1.0',
    ...over,
  };
}

describe('buildCasaPayload — structure & types', () => {
  it('g_D et g_z0 sont au top-level (hors geom) et numériques', () => {
    const p = buildCasaPayload(form({ gD: '15', gz0: '1.2' }));
    expect(p.g_D).toBe(15);
    expect(p.g_z0).toBe(1.2);
    expect((p.geom as Record<string, unknown>).g_B).toBe(0.6);
    expect('g_D' in (p.geom as object)).toBe(false);
  });

  it('convertit les nombres (virgule tolérée) et omet les champs de couche vides', () => {
    const p = buildCasaPayload(form({ gB: '0,8', layers: [{ soil: 'sable', th: '10', pl: '1.5', em: '', qc: '', c: '', phi: '', gamma: '' }] }));
    expect((p.geom as Record<string, unknown>).g_B).toBe(0.8);
    expect(p.layers).toEqual([{ soil: 'sable', th: 10, pl: 1.5 }]); // em/qc/c/phi/gamma vides -> absents
  });

  it('inclut le béton seulement si activé', () => {
    expect('beton' in buildCasaPayload(form({ betonOn: false }))).toBe(false);
    expect(buildCasaPayload(form({ betonOn: true, fck: '30' })).beton).toEqual({ b_fck: 30, arm: 'arme', k3: '1.0' });
  });

  it('cpt vide + grp par défaut fournis (schéma strict satisfait)', () => {
    const p = buildCasaPayload(form());
    expect(p.cpt).toEqual({ step: 0.2, pts: [] });
    expect(p.grp).toEqual({ grp_n: 1, grp_m: 1, grp_s: 0 });
  });
});

describe('buildCasaPayload — DoD §8', () => {
  it('les coefficients sont les valeurs EC7 publiques (NA DA2), pas du calage caché', () => {
    const c = buildCasaPayload(form()).coeffs as Record<string, number>;
    expect(c.k_gG).toBe(1.35);
    expect(c.k_gQ).toBe(1.5);
    expect(c.cr_car).toBe(0.9);
  });

  it('ne produit aucune grandeur de RÉSULTAT (Rd, Rb, taux, portance…)', () => {
    const p = buildCasaPayload(form());
    for (const forbidden of ['Rd', 'Rbk', 'RbK', 'Rsk', 'taux', 'qp', 'kp', 'Fd', 'verdict', 'rows']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
