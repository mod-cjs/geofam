/**
 * Tests — page Radier triangulaire (tri-raft, maillage DKT / EF).
 * DoD §9 : given/when/then. DoD §8 : buildTriRaftPayload PUR = géométrie du
 * modèle bornée uniquement (aucun champ nodal/topologie de maillage).
 */

import { describe, it, expect } from 'vitest';

import { buildTriRaftPayload, type TriRaftForm } from '../page';

function form(over: Partial<TriRaftForm> = {}): TriRaftForm {
  return {
    projet: 'Radier T1',
    pts: [{ x: '0', y: '0' }, { x: '6', y: '0' }, { x: '6', y: '6' }, { x: '0', y: '6' }],
    layers: [{ zBase: '-10', E: '15', nu: '0.33' }],
    target: '1.0', e: '0.5', E: '30000', nu: '0.2', q: '', foundD: '',
    pointLoads: [], lineLoads: [], areaLoads: [{ x1: '0', y1: '0', x2: '6', y2: '6', q: '50', on: 'raft' }],
    ...over,
  };
}

describe('buildTriRaftPayload — structure', () => {
  it('construit un raft avec sommets seuls (matériau replié sur opts, sans E/nu/e)', () => {
    const p = buildTriRaftPayload(form());
    const rafts = p.rafts as Array<Record<string, unknown>>;
    expect(rafts).toHaveLength(1);
    expect(rafts[0].pts).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }]);
    expect(rafts[0].E).toBeUndefined();
    expect(rafts[0].nu).toBeUndefined();
    expect(rafts[0].e).toBeUndefined();
  });

  it('opts : target/e/E/nu (nombres), q/foundD omis si vides', () => {
    const opts = buildTriRaftPayload(form()).opts as Record<string, unknown>;
    expect(opts.target).toBe(1.0);
    expect(opts.e).toBe(0.5);
    expect(opts.E).toBe(30000);
    expect(opts.nu).toBe(0.2);
    expect(opts.q).toBeUndefined();
    expect(opts.foundD).toBeUndefined();
    const opts2 = buildTriRaftPayload(form({ q: '30', foundD: '1' })).opts as Record<string, unknown>;
    expect(opts2.q).toBe(30);
    expect(opts2.foundD).toBe(1);
  });

  it('charge répartie mappée avec support raft/soil', () => {
    const p = buildTriRaftPayload(form());
    expect(p.areaLoads).toEqual([{ x1: 0, y1: 0, x2: 6, y2: 6, q: 50, on: 'raft' }]);
  });

  it('charges ponctuelles : Fz seul (pas de Mx/My — divergence documentée du solveur)', () => {
    const p = buildTriRaftPayload(form({ pointLoads: [{ x: '3', y: '3', Fz: '500' }] }));
    expect(p.pointLoads).toEqual([{ x: 3, y: 3, Fz: 500 }]);
  });

  it('layers mappés en nombres', () => {
    const p = buildTriRaftPayload(form());
    expect(p.layers).toEqual([{ zBase: -10, E: 15, nu: 0.33 }]);
  });
});

describe('buildTriRaftPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT ni champ nodal/topologie de maillage', () => {
    const p = buildTriRaftPayload(form());
    for (const forbidden of ['wMax', 'wMin', 'reactionMax', 'nRaft', 'P', 'tris', 'N', 'nt', 'w', 'p']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
