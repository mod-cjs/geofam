/**
 * Tests — pieuxDescriptor.buildPayload : champs de couche manquants (MAJEUR-1).
 *
 * Avant ce correctif, `buildPayload` n'émettait par couche que { soil, th, pl, em }.
 * Le moteur downdrag exige `gamma` (poids volumique) pour calculer sigmaV(z).
 * Les méthodes CPT et c-φ exigent respectivement `qc`, `c`, `phi`.
 *
 * Ces tests sont RED tant que les champs ne sont pas émis par buildPayload.
 * Ils deviennent verts après le correctif (MAJEUR-1).
 *
 * ⚠️ DoD §8 — ce fichier N'IMPORTE PAS @roadsen/engines.
 */
import { describe, it, expect } from 'vitest';

import { findDescriptor } from '../../engine-descriptors';

const descriptor = findDescriptor('pieux');
if (!descriptor) throw new Error('descripteur pieux introuvable');

/** Flat minimal valide (couche 1 seule, méthode PMT). */
const BASE_FLAT: Record<string, unknown> = {
  projet: 'Test',
  pieu: '',
  geom_section: 'circulaire',
  geom_g_B: '0.6',
  g_z0: '0',
  g_D: '15',
  cat: '1',
  meth: 'pmt',
  da: 'da2',
  sens: 'comp',
  essais: 'moyen',
  c_G: '150',
  c_Q: '50',
  o_nappe: '100',
  o_nprofil: '1.5',
  o_surf: '0',
  o_redis: 'non',
  layer1_soil: 'argile',
  layer1_th: '10',
  layer1_pl: '0.6',
  layer1_em: '6',
};

describe('pieuxDescriptor.buildPayload — émission de gamma par couche (MAJEUR-1 downdrag)', () => {
  it(
    'given layer1_gamma renseigné, ' +
      'when buildPayload, then layers[0].gamma est un nombre fini',
    () => {
      const flat = { ...BASE_FLAT, layer1_gamma: '18' };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(payload.layers)).toBe(true);
      expect(payload.layers.length).toBeGreaterThan(0);
      const l0 = payload.layers[0];
      expect(typeof l0.gamma, 'gamma doit être un number').toBe('number');
      expect(Number.isFinite(l0.gamma as number)).toBe(true);
      expect(l0.gamma).toBeCloseTo(18);
    },
  );

  it(
    'given layer1_gamma absent (vide), ' +
      'when buildPayload, then layers[0].gamma est undefined (ne casse pas le moteur)',
    () => {
      const flat = { ...BASE_FLAT }; // pas de gamma
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(payload.layers[0].gamma).toBeUndefined();
    },
  );

  it(
    'given layer1_gamma et layer2_gamma, ' +
      'when buildPayload, then les deux couches ont gamma',
    () => {
      const flat: Record<string, unknown> = {
        ...BASE_FLAT,
        layer1_gamma: '18',
        layer1_soil: 'argile',
        layer1_th: '5',
        layer2_soil: 'sable',
        layer2_th: '5',
        layer2_pl: '',
        layer2_em: '',
        layer2_gamma: '20',
      };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(payload.layers).toHaveLength(2);
      expect(payload.layers[0].gamma).toBeCloseTo(18);
      expect(payload.layers[1].gamma).toBeCloseTo(20);
    },
  );
});

describe('pieuxDescriptor.buildPayload — émission de qc par couche (méthode CPT)', () => {
  it(
    'given layer1_qc renseigné et meth=cpt, ' +
      'when buildPayload, then layers[0].qc est un nombre fini',
    () => {
      const flat = { ...BASE_FLAT, meth: 'cpt', layer1_qc: '5.2' };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(typeof payload.layers[0].qc).toBe('number');
      expect(payload.layers[0].qc).toBeCloseTo(5.2);
    },
  );

  it('given layer1_qc absent, when buildPayload, then layers[0].qc est undefined', () => {
    const flat = { ...BASE_FLAT };
    const payload = descriptor.buildPayload(flat) as {
      layers: Array<Record<string, unknown>>;
    };
    expect(payload.layers[0].qc).toBeUndefined();
  });
});

describe('pieuxDescriptor.buildPayload — émission de c et phi par couche (méthode c-φ)', () => {
  it(
    'given layer1_c et layer1_phi renseignés et meth=cphi, ' +
      'when buildPayload, then layers[0].c et layers[0].phi sont des nombres finis',
    () => {
      const flat = {
        ...BASE_FLAT,
        meth: 'cphi',
        layer1_c: '15',
        layer1_phi: '28',
      };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(typeof payload.layers[0].c).toBe('number');
      expect(payload.layers[0].c).toBeCloseTo(15);
      expect(typeof payload.layers[0].phi).toBe('number');
      expect(payload.layers[0].phi).toBeCloseTo(28);
    },
  );

  it('given layer1_c et layer1_phi absents, when buildPayload, then undefined (pas de NaN)', () => {
    const flat = { ...BASE_FLAT };
    const payload = descriptor.buildPayload(flat) as {
      layers: Array<Record<string, unknown>>;
    };
    expect(payload.layers[0].c).toBeUndefined();
    expect(payload.layers[0].phi).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('NaN');
  });
});
