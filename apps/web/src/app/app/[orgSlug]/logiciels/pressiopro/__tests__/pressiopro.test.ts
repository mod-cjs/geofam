/**
 * Tests — page PressioPro (pressiomètre Ménard).
 * DoD §9 : given/when/then. DoD §8 : buildPressioProPayload PUR = essai borné,
 * aucune grandeur de résultat (pL/EM/catégorie viennent du serveur).
 */

import { describe, it, expect } from 'vitest';

import { buildPressioProPayload, type PressioProForm } from '../page';

function form(over: Partial<PressioProForm> = {}): PressioProForm {
  return {
    projet: 'Sondage BH-01', label: 'BH-01 / 3,0 m',
    a: '0.5', Ph: '0', Pe: '0', V0: '535', k0: '0.5',
    gamma: '19', nappe: '0',
    rows: [
      { p: '2', v15: '90', v30: '95', v60: '100' },
      { p: '4', v15: '130', v30: '135', v60: '140' },
      { p: '6', v15: '175', v30: '182', v60: '189' },
      { p: '8', v15: '230', v30: '245', v60: '262' },
    ],
    ...over,
  };
}

describe('buildPressioProPayload — structure', () => {
  it('mappe params (appareillage) et paliers en nombres', () => {
    const p = buildPressioProPayload(form());
    expect(p.params).toEqual({ a: 0.5, Ph: 0, Pe: 0, V0: 535, k0: 0.5 });
    expect(p.gamma).toBe(19);
    expect(p.rows).toEqual([
      { p: 2, v15: 90, v30: 95, v60: 100 },
      { p: 4, v15: 130, v30: 135, v60: 140 },
      { p: 6, v15: 175, v30: 182, v60: 189 },
      { p: 8, v15: 230, v30: 245, v60: 262 },
    ]);
  });

  it('V0/k0 par défaut si champ vide ; label borné à 40 car.', () => {
    const p = buildPressioProPayload(form({ V0: '', k0: '', label: 'x'.repeat(60) }));
    const params = p.params as Record<string, number>;
    expect(params.V0).toBe(535);
    expect(params.k0).toBe(0.5);
    expect((p.label as string).length).toBe(40);
  });
});

describe('buildPressioProPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT (pL/EM/catégorie côté serveur)', () => {
    const p = buildPressioProPayload(form());
    for (const forbidden of ['pL', 'pLNette', 'EM', 'ratioEMpL', 'categorieLibelle', 'alpha', 'sigH0']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
