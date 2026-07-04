/**
 * Tests — page GEOPLAQUE (radier, EF / EC7 annexe H).
 * DoD §9 : given/when/then. DoD §8 : buildGeoplaquePayload PUR = géométrie du
 * modèle bornée uniquement, aucun champ nodal/résultat.
 */

import { describe, it, expect } from 'vitest';

import { buildGeoplaquePayload, type GeoplaqueForm } from '../page';

function form(over: Partial<GeoplaqueForm> = {}): GeoplaqueForm {
  return {
    projet: 'Radier R1',
    pts: [{ x: '0', y: '0' }, { x: '6', y: '0' }, { x: '6', y: '6' }, { x: '0', y: '6' }],
    E: '30000', nu: '0.2', e: '0.4',
    layers: [{ zBase: '10', E: '8', nu: '0.33' }],
    mesh: '0.5', decol: false, qLim: '',
    pointLoads: [], lineLoads: [], areaLoads: [{ x1: '0', y1: '0', x2: '6', y2: '6', q: '50', on: 'raft' }], pointSprings: [],
    ...over,
  };
}

describe('buildGeoplaquePayload — structure', () => {
  it('construit un raft avec sommets, module, épaisseur (nombres)', () => {
    const p = buildGeoplaquePayload(form());
    const rafts = p.rafts as Array<Record<string, unknown>>;
    expect(rafts).toHaveLength(1);
    expect(rafts[0].E).toBe(30000);
    expect(rafts[0].e).toBe(0.4);
    expect(rafts[0].pts).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }]);
  });

  it('charge répartie mappée avec support raft/soil', () => {
    const p = buildGeoplaquePayload(form());
    expect(p.areaLoads).toEqual([{ x1: 0, y1: 0, x2: 6, y2: 6, q: 50, on: 'raft' }]);
  });

  it('omet Mx/My des charges ponctuelles si vides', () => {
    const p = buildGeoplaquePayload(form({ pointLoads: [{ x: '3', y: '3', Fz: '500', Mx: '', My: '10' }] }));
    expect(p.pointLoads).toEqual([{ x: 3, y: 3, Fz: 500, My: 10 }]);
  });

  it('opts : maillage + décollement ; qLim omis si vide', () => {
    expect(buildGeoplaquePayload(form()).opts).toEqual({ mesh: 0.5, decol: false });
    expect(buildGeoplaquePayload(form({ qLim: '200', decol: true })).opts).toEqual({ mesh: 0.5, decol: true, qLim: 200 });
  });
});

describe('buildGeoplaquePayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT ni champ nodal', () => {
    const p = buildGeoplaquePayload(form());
    for (const forbidden of ['wMax', 'betaGov', 'w', 'nodeX', 'nodeY', 'champDeflexion', 'vals', 'ki', 'kj', 'slope']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
