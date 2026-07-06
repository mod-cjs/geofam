/**
 * Tests — page Déformations planes (plane-strain, coupe 2D / EF).
 * DoD §9 : given/when/then. DoD §8 : buildPlaneStrainPayload PUR = entrée bornée
 * uniquement (aucun champ nodal/résultat).
 */

import { describe, it, expect } from 'vitest';

import { buildPlaneStrainPayload, type PlaneStrainForm } from '../page';

function form(over: Partial<PlaneStrainForm> = {}): PlaneStrainForm {
  return {
    projet: 'Coupe C1',
    layers: [{ zBase: '-10', E: '15', nu: '0.33' }],
    Bw: '10', e: '0.5', E: '30000', nu: '0.2',
    foundD: '', ne: '60', q: '100', decol: false,
    loads: [],
    ...over,
  };
}

describe('buildPlaneStrainPayload — structure', () => {
  it('construit opts avec Bw/e/E/nu/décollement (nombres)', () => {
    const p = buildPlaneStrainPayload(form());
    const opts = p.opts as Record<string, unknown>;
    expect(opts.Bw).toBe(10);
    expect(opts.e).toBe(0.5);
    expect(opts.E).toBe(30000);
    expect(opts.nu).toBe(0.2);
    expect(opts.decol).toBe(false);
    expect(opts.q).toBe(100);
  });

  it('layers mappés en nombres', () => {
    const p = buildPlaneStrainPayload(form());
    expect(p.layers).toEqual([{ zBase: -10, E: 15, nu: 0.33 }]);
  });

  it('omet foundD/ne si vides ; les inclut sinon', () => {
    expect((buildPlaneStrainPayload(form()).opts as Record<string, unknown>).foundD).toBeUndefined();
    const p2 = buildPlaneStrainPayload(form({ foundD: '1.5', ne: '80' }));
    const opts2 = p2.opts as Record<string, unknown>;
    expect(opts2.foundD).toBe(1.5);
    expect(opts2.ne).toBe(80);
  });

  it('charges linéiques : filtre les P nulles/vides, mappe x/P en nombres', () => {
    const p = buildPlaneStrainPayload(form({ loads: [{ x: '5', P: '800' }, { x: '2', P: '' }] }));
    expect((p.opts as Record<string, unknown>).loads).toEqual([{ x: 5, P: 800 }]);
  });

  it('omet loads si aucune charge linéique valide', () => {
    const p = buildPlaneStrainPayload(form({ loads: [{ x: '2', P: '0' }] }));
    expect((p.opts as Record<string, unknown>).loads).toBeUndefined();
  });
});

describe('buildPlaneStrainPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT ni champ nodal', () => {
    const p = buildPlaneStrainPayload(form());
    for (const forbidden of ['wMax', 'wMin', 'mMax', 'mMin', 'decolN', 'X', 'w', 'M', 'V', 'nn', 'EI', 'iters']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
