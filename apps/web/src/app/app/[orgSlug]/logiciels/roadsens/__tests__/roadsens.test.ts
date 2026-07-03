/**
 * Tests — page ROADSENS (logiciel dimensionnement chaussées)
 *
 * DoD §9 : given/when/then, chemins nominaux + bords.
 * DoD §8 : aucun import @roadsen/engines — fonctions purement display/payload.
 *
 * Portée :
 * - computeNE : formule NE publique AGEROUTE 2015 (display uniquement)
 * - neClass : classification NE
 * - buildBurmisterPayload : structure du payload API (clés, types)
 */

import { describe, it, expect } from 'vitest';

import { computeNE, neClass, buildBurmisterPayload } from '../page';

// ---------------------------------------------------------------------------
// computeNE — NE cumulé (formule AGEROUTE 2015 §3.2, affichage)
// ---------------------------------------------------------------------------

describe('computeNE', () => {
  it('given τ=0 returns NE = 365 × T × N × C × dir × tv', () => {
    // GIVEN : trafic sans croissance
    const traffic = { T: 150, C: 0.9, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    // WHEN
    const ne = computeNE(traffic);
    // THEN : cumul géométrique = N quand τ≈0
    expect(ne).toBeCloseTo(365 * 150 * 20 * 0.9 * 1.0 * 1.0, -2);
  });

  it('given τ=4%/an et N=20ans retourne un NE supérieur au cas sans croissance', () => {
    const trafficFlat = { T: 150, C: 0.9, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    const trafficGrow = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
    // WHEN
    const neFlat = computeNE(trafficFlat);
    const neGrow = computeNE(trafficGrow);
    // THEN : la croissance augmente le NE
    expect(neGrow).toBeGreaterThan(neFlat);
  });

  it('given dir=0.5 retourne la moitié du NE unidirectionnel', () => {
    const base = { T: 150, C: 1.0, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    const half = { T: 150, C: 1.0, N: 20, tau: 0, dir: 0.5, tv: 1.0 };
    // WHEN / THEN
    expect(computeNE(half)).toBeCloseTo(computeNE(base) / 2, 0);
  });

  it('retourne 0 si T=0', () => {
    const traffic = { T: 0, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 };
    expect(computeNE(traffic)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// neClass — classification du trafic
// ---------------------------------------------------------------------------

describe('neClass', () => {
  const cases: Array<[number, string]> = [
    [0.05e6, 'C1'],
    [0.1e6, 'C2'], // valeur limite : ≥ 0,1 → C2
    [0.3e6, 'C3'],
    [1e6, 'C4'],
    [3e6, 'C5'],
    [10e6, 'C6'],
    [30e6, 'C7'],
    [50e6, 'C8'],
    [100e6, '>C8'],
    [200e6, '>C8'],
  ];

  cases.forEach(([ne, expected]) => {
    it(`NE=${ne / 1e6}×10⁶ → classe ${expected}`, () => {
      expect(neClass(ne)).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// buildBurmisterPayload — structure du payload API
// ---------------------------------------------------------------------------

describe('buildBurmisterPayload', () => {
  const layers = [
    { id: 1, mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
    { id: 2, mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
    { id: 3, mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
  ];
  const pf = { cls: 'PF2', E: 50, nu: 0.35 };
  const traffic = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
  const load = { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' };

  it('contains layers array of correct length', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(payload.layers)).toBe(true);
    expect((payload.layers as unknown[]).length).toBe(3);
  });

  it('each layer has mat, E, nu, h fields', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const l0 = (payload.layers as Array<Record<string, unknown>>)[0];
    expect(l0).toHaveProperty('mat', 'BBSG1');
    expect(l0).toHaveProperty('E', 1512);
    expect(l0).toHaveProperty('nu', 0.45);
    expect(l0).toHaveProperty('h', 0.06);
  });

  it('subgrade contains E and nu', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const sg = payload.subgrade as Record<string, unknown>;
    expect(sg.E).toBe(50);
    expect(sg.nu).toBe(0.35);
    expect(sg.cls).toBe('PF2');
  });

  it('traffic fields are all present', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const tr = payload.traffic as Record<string, unknown>;
    expect(tr).toMatchObject({ T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 });
  });

  it('load.r is string "auto" when auto is selected', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.r).toBe('auto');
  });

  it('load.r is a number when a numeric choice is selected', () => {
    const loadNumeric = { ...load, r: '10' };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadNumeric) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(typeof ld.r).toBe('number');
    expect(ld.r).toBe(10);
  });

  it('does not contain any engine coefficient (e6, b, kc)', () => {
    // Garde DoD §8 : le payload ne doit pas transporter de coefficients de fatigue
    const payload = JSON.stringify(buildBurmisterPayload(layers, pf, traffic, load));
    expect(payload).not.toContain('"e6"');
    expect(payload).not.toContain('"kc"');
    expect(payload).not.toContain('"s6"');
  });
});
