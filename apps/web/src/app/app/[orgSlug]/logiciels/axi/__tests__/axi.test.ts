/**
 * Tests — page Axisymétrique (axi, plaque annulaire / radier circulaire EF).
 * DoD §9 : given/when/then. DoD §8 : buildAxiPayload PUR = entrée bornée
 * uniquement (aucun champ nodal radial/résultat).
 */

import { describe, it, expect } from 'vitest';

import { buildAxiPayload, type AxiForm } from '../page';

function form(over: Partial<AxiForm> = {}): AxiForm {
  return {
    projet: 'Dallage D1',
    layers: [{ zBase: '-10', E: '15', nu: '0.33' }],
    R: '6', e: '0.4', E: '30000', nu: '0.2',
    q: '120', Pc: '0', ne: '50', foundD: '',
    ...over,
  };
}

describe('buildAxiPayload — structure', () => {
  it('construit o avec R/e/E/nu (nombres)', () => {
    const p = buildAxiPayload(form());
    const o = p.o as Record<string, unknown>;
    expect(o.R).toBe(6);
    expect(o.e).toBe(0.4);
    expect(o.E).toBe(30000);
    expect(o.nu).toBe(0.2);
    expect(o.q).toBe(120);
  });

  it('layers mappés en nombres', () => {
    const p = buildAxiPayload(form());
    expect(p.layers).toEqual([{ zBase: -10, E: 15, nu: 0.33 }]);
  });

  it('omet Pc/ne/foundD si vides ; les inclut sinon', () => {
    const p1 = buildAxiPayload(form({ Pc: '', ne: '', foundD: '' }));
    const o1 = p1.o as Record<string, unknown>;
    expect(o1.Pc).toBeUndefined();
    expect(o1.ne).toBeUndefined();
    expect(o1.foundD).toBeUndefined();
    const p2 = buildAxiPayload(form({ Pc: '500', ne: '80', foundD: '2' }));
    const o2 = p2.o as Record<string, unknown>;
    expect(o2.Pc).toBe(500);
    expect(o2.ne).toBe(80);
    expect(o2.foundD).toBe(2);
  });
});

describe('buildAxiPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT ni champ nodal radial', () => {
    const p = buildAxiPayload(form());
    for (const forbidden of ['wc', 'wEdge', 'wMax', 'wMin', 'mrMax', 'mtMax', 'pMax', 'r', 'w', 'Mr', 'Mt', 'nn']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
